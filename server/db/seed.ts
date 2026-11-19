import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { DEFAULT_MARKUP_MATRIX, dueDateFor, resolvePartPrice } from '../../shared/calc';
import type { PaymentTerms } from '../../shared/constants';
import { loadWorkOrder } from '../services/core';
import { openDb, type DB } from './client';
import * as s from './schema';

export const DEMO_PASSWORD = 'waymore123';

/* Deterministic PRNG so the demo data is the same every time. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

const VIN_CHARS = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789';
const VIN_VALUES: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};
const VIN_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

/** Build a VIN with a valid check digit (position 9). */
function makeVin(rand: () => number, wmi: string, year: number) {
  const yearCodes = 'ABCDEFGHJKLMNPRSTVWXY123456789';
  const yc = yearCodes[(year - 2010 + 30) % 30];
  const chars = [...wmi];
  while (chars.length < 8) chars.push(VIN_CHARS[Math.floor(rand() * 23)]);
  chars.push('0', yc, VIN_CHARS[Math.floor(rand() * 23)]);
  while (chars.length < 17) chars.push(String(Math.floor(rand() * 10)));
  const sum = chars.reduce((a, c, i) => a + (/\d/.test(c) ? Number(c) : VIN_VALUES[c]) * VIN_WEIGHTS[i], 0);
  const check = sum % 11;
  chars[8] = check === 10 ? 'X' : String(check);
  return chars.join('');
}

const daysAgo = (n: number, hour = 8, minute = 0) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(hour, minute, 0, 0);
  return d;
};

/* ------------------------------- Catalog -------------------------------- */

const VENDORS = [
  { name: 'Midwest Heavy Truck Supply', contactName: 'Rick Dombrowski', phone: '(815) 555-0141', email: 'orders@midwestheavy.example', accountNumber: 'MHT-22817' },
  { name: 'Interstate Brake & Clutch', contactName: 'Angela Fry', phone: '(630) 555-0177', email: 'sales@interstatebrake.example', accountNumber: 'IBC-0937' },
  { name: 'Prairie Filter & Lube', contactName: 'Sam Okafor', phone: '(309) 555-0102', email: 'sam@prairiefilter.example', accountNumber: 'PFL-5521' },
  { name: 'Great Lakes Tire & Wheel', contactName: 'Jenny Lindqvist', phone: '(312) 555-0166', email: 'fleet@gltirewheel.example', accountNumber: 'GLT-1180' },
  { name: 'Northline Electrical Distributors', contactName: 'Victor Huang', phone: '(708) 555-0123', email: 'counter@northline.example', accountNumber: 'NED-7740' },
];

// [partNumber, description, manufacturer, category, vendorIdx, costCents, qty, reorderPoint, reorderQty, bin, markupPct?]
const PARTS: [string, string, string, string, number, number, number, number, number, string, number?][] = [
  ['LF-9080', 'Lube oil filter, full-flow spin-on', 'Ironline', 'Filters', 2, 2185, 24, 10, 24, 'A-01'],
  ['FF-5488', 'Fuel filter, secondary', 'Ironline', 'Filters', 2, 2640, 18, 8, 24, 'A-02'],
  ['FS-1040', 'Fuel/water separator', 'Ironline', 'Filters', 2, 4190, 14, 6, 12, 'A-03'],
  ['AF-2611', 'Air filter, primary radial seal', 'Ironline', 'Filters', 2, 8875, 7, 4, 8, 'A-04'],
  ['CF-1330', 'Cabin air filter', 'Ironline', 'Filters', 2, 1420, 3, 4, 10, 'A-05'],
  ['DEF-F18', 'DEF dosing pump filter', 'Ironline', 'Filters', 2, 3350, 6, 3, 6, 'A-06'],
  ['OIL-1540-G', 'Engine oil 15W-40 CK-4 (gal)', 'DuraHaul', 'Fluids', 2, 1395, 220, 110, 165, 'BULK-1'],
  ['COOL-ELC-G', 'Extended life coolant 50/50 (gal)', 'DuraHaul', 'Fluids', 2, 1050, 85, 30, 55, 'BULK-2'],
  ['DEF-25', 'Diesel exhaust fluid 2.5 gal', 'DuraHaul', 'Fluids', 2, 1299, 40, 12, 24, 'BULK-3'],
  ['GRS-EP2', 'EP2 chassis grease, 14 oz cartridge', 'DuraHaul', 'Fluids', 2, 649, 48, 12, 24, 'A-10'],
  ['HUB-OIL-Q', 'Synthetic hub oil 75W-90 (qt)', 'DuraHaul', 'Fluids', 2, 1189, 26, 12, 24, 'A-11'],
  ['BS-4707Q', 'Brake shoe kit 16.5x7 4707Q, w/ hardware', 'StopTek', 'Brakes', 1, 6890, 12, 8, 16, 'B-01'],
  ['BD-3600A', 'Brake drum 16.5x7 3600A', 'StopTek', 'Brakes', 1, 11250, 6, 4, 8, 'B-02'],
  ['SA-ASA5', 'Automatic slack adjuster 5.5"', 'StopTek', 'Brakes', 1, 6475, 8, 4, 8, 'B-03'],
  ['BC-3030', 'Brake chamber 30/30 long stroke', 'StopTek', 'Brakes', 1, 7890, 5, 4, 6, 'B-04'],
  ['AD-CART', 'Air dryer cartridge, coalescing', 'StopTek', 'Air System', 1, 7425, 4, 3, 6, 'B-05'],
  ['AD-PURGE', 'Air dryer purge valve kit', 'StopTek', 'Air System', 1, 5610, 2, 2, 4, 'B-06'],
  ['GH-1/2-24', 'Air brake gladhand hose 1/2" x 24"', 'StopTek', 'Air System', 1, 1875, 10, 4, 10, 'B-07'],
  ['WS-370', 'Wheel seal, drive/trailer axle', 'Roadmaster Pro', 'Wheel End', 0, 3240, 16, 8, 16, 'C-01'],
  ['BRG-SET', 'Wheel bearing set (inner/outer)', 'Roadmaster Pro', 'Wheel End', 0, 5985, 6, 4, 8, 'C-02'],
  ['TIRE-295-S', 'Steer tire 295/75R22.5 16PR', 'Roadway Tire', 'Tires', 3, 38900, 6, 4, 8, 'T-01'],
  ['TIRE-11R-D', 'Drive tire 11R22.5 16PR', 'Roadway Tire', 'Tires', 3, 34500, 8, 8, 16, 'T-02'],
  ['TIRE-TRL', 'Trailer tire 295/75R22.5 recap', 'Roadway Tire', 'Tires', 3, 17900, 10, 8, 16, 'T-03'],
  ['VS-TR575', 'Valve stem, TR575', 'Roadway Tire', 'Tires', 3, 289, 60, 20, 50, 'T-04'],
  ['NOX-OUT-13', 'NOx sensor, SCR outlet', 'DuraHaul', 'Aftertreatment', 0, 41500, 0, 1, 2, 'D-01'],
  ['NOX-IN-13', 'NOx sensor, SCR inlet', 'DuraHaul', 'Aftertreatment', 0, 41500, 1, 1, 2, 'D-02'],
  ['DPF-GSK', 'DPF clamp & gasket kit', 'DuraHaul', 'Aftertreatment', 0, 6690, 4, 2, 4, 'D-03'],
  ['EGR-TEMP', 'EGR temperature sensor', 'DuraHaul', 'Aftertreatment', 0, 9840, 2, 1, 2, 'D-04'],
  ['HOSE-URAD', 'Upper radiator hose, silicone', 'Roadmaster Pro', 'Cooling', 0, 8960, 3, 2, 3, 'E-01'],
  ['CLAMP-TB', 'T-bolt hose clamp 2.5"', 'Roadmaster Pro', 'Cooling', 0, 485, 30, 10, 25, 'E-02'],
  ['WP-ISX', 'Water pump assembly', 'Roadmaster Pro', 'Cooling', 0, 32400, 1, 1, 1, 'E-03'],
  ['STR-39MT', 'Starter motor 12V, gear reduction', 'Voltrix', 'Electrical', 4, 42800, 2, 1, 2, 'F-01'],
  ['ALT-160', 'Alternator 160A brushless', 'Voltrix', 'Electrical', 4, 38750, 2, 1, 2, 'F-02'],
  ['BAT-31', 'Battery group 31, 925 CCA', 'Voltrix', 'Electrical', 4, 15990, 9, 6, 12, 'F-03'],
  ['LED-MKR-A', 'LED marker/clearance lamp, amber', 'Voltrix', 'Lighting', 4, 795, 40, 15, 40, 'F-10'],
  ['LED-STT', 'LED stop/turn/tail lamp 4"', 'Voltrix', 'Lighting', 4, 2450, 14, 8, 16, 'F-11'],
  ['NB-7WAY', '7-way nose box w/ circuit breakers', 'Voltrix', 'Lighting', 4, 6875, 3, 2, 4, 'F-12'],
  ['PIG-7WAY', '7-way trailer pigtail, 15 ft', 'Voltrix', 'Lighting', 4, 4590, 4, 3, 6, 'F-13'],
  ['WB-22', 'Wiper blade 22" heavy duty', 'Voltrix', 'Cab', 4, 1150, 4, 6, 12, 'F-20'],
  ['AC-COND', 'A/C condenser assembly', 'Roadmaster Pro', 'HVAC', 0, 46800, 1, 1, 1, 'G-01'],
  ['AC-R134', 'Refrigerant R-134a (lb)', 'Roadmaster Pro', 'HVAC', 0, 1350, 30, 10, 30, 'G-02'],
  ['MF-SHOP', 'Mud flap 24x30 w/ logo blank', 'Roadmaster Pro', 'Body', 0, 2290, 12, 6, 12, 'H-01'],
  ['RF-OILF', 'Reefer unit oil filter', 'Ironline', 'Reefer', 2, 1890, 6, 4, 8, 'A-20'],
  ['RF-FUELF', 'Reefer unit fuel filter', 'Ironline', 'Reefer', 2, 1640, 6, 4, 8, 'A-21'],
];

/* ------------------------------ Customers ------------------------------- */

interface UnitSpec {
  unitNumber: string;
  type: string;
  year: number;
  make: string;
  model: string;
  engine?: string;
  wmi: string;
  mileage?: number;
  engineHours?: number;
}

const tractor = (n: string, year: number, make: string, model: string, engine: string, wmi: string, mileage: number): UnitSpec => ({
  unitNumber: n,
  type: 'tractor',
  year,
  make,
  model,
  engine,
  wmi,
  mileage,
  engineHours: Math.round(mileage / 38),
});
const trailer = (n: string, year: number, make: string, model: string, wmi: string, type = 'trailer'): UnitSpec => ({
  unitNumber: n,
  type,
  year,
  make,
  model,
  wmi,
  ...(type === 'reefer' ? { engineHours: 6000 + (year % 7) * 1100 } : {}),
});

const CUSTOMERS: {
  name: string;
  account: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  terms: PaymentTerms;
  taxExempt?: boolean;
  laborRateCents?: number;
  partsMarkupPct?: number;
  requiresPo?: boolean;
  notes?: string;
  contacts: [string, string, string, string][];
  units: UnitSpec[];
}[] = [
  {
    name: 'Ridgeline Freight Lines',
    account: 'C-1001',
    phone: '(815) 555-0190',
    email: 'maintenance@ridgelinefreight.example',
    address: '2201 Industrial Dr',
    city: 'Joliet',
    state: 'IL',
    zip: '60436',
    terms: 'net30',
    laborRateCents: 13500,
    requiresPo: true,
    notes: 'National account. PO required on every invoice. Call Gary before any job over $2,500.',
    contacts: [
      ['Gary Halvorsen', 'Maintenance Manager', '(815) 555-0191', 'gary.h@ridgelinefreight.example'],
      ['Tina Morales', 'Accounts Payable', '(815) 555-0192', 'ap@ridgelinefreight.example'],
    ],
    units: [
      tractor('RFL-412', 2021, 'Freightliner', 'Cascadia 126', 'Detroit DD15', '3AKJHHDR', 412_880),
      tractor('RFL-415', 2021, 'Freightliner', 'Cascadia 126', 'Detroit DD15', '3AKJHHDR', 398_140),
      tractor('RFL-433', 2022, 'Freightliner', 'Cascadia 126', 'Detroit DD15', '3AKJHHDR', 301_550),
      tractor('RFL-451', 2023, 'Freightliner', 'Cascadia 116', 'Detroit DD13', '3AKJHLDV', 188_020),
      trailer('RFL-T5302', 2019, 'Wabash', 'DuraPlate 53ft', '1JJV532D'),
      trailer('RFL-T5318', 2020, 'Wabash', 'DuraPlate 53ft', '1JJV532D'),
    ],
  },
  {
    name: 'Prairie State Foods Distribution',
    account: 'C-1002',
    phone: '(630) 555-0110',
    email: 'fleet@prairiestatefoods.example',
    address: '880 Commerce Pkwy',
    city: 'Aurora',
    state: 'IL',
    zip: '60504',
    terms: 'net15',
    contacts: [
      ['Denise Kowal', 'Fleet Coordinator', '(630) 555-0111', 'dkowal@prairiestatefoods.example'],
      ['Ray Banner', 'Transportation Director', '(630) 555-0115', 'rbanner@prairiestatefoods.example'],
    ],
    units: [
      tractor('PSF-21', 2020, 'Volvo', 'VNL 760', 'Volvo D13', '4V4NC9EH', 455_300),
      tractor('PSF-24', 2022, 'Volvo', 'VNL 660', 'Volvo D13', '4V4NC9EH', 241_870),
      trailer('PSF-R88', 2021, 'Utility', '3000R Reefer 53ft', '1UYVS253', 'reefer'),
      trailer('PSF-R91', 2022, 'Utility', '3000R Reefer 53ft', '1UYVS253', 'reefer'),
      { unitNumber: 'PSF-B7', type: 'straight_truck', year: 2019, make: 'International', model: 'MV607 26ft Box', engine: 'Cummins B6.7', wmi: '3HAEUMML', mileage: 187_420, engineHours: 6980 },
    ],
  },
  {
    name: 'Kessler Construction Co.',
    account: 'C-1003',
    phone: '(708) 555-0150',
    email: 'equipment@kesslerconstruction.example',
    address: '15 Quarry Rd',
    city: 'Lemont',
    state: 'IL',
    zip: '60439',
    terms: 'net30',
    partsMarkupPct: 30,
    contacts: [['Bill Kessler Jr.', 'Owner', '(708) 555-0151', 'bill@kesslerconstruction.example']],
    units: [
      { unitNumber: 'K-DT3', type: 'straight_truck', year: 2018, make: 'Mack', model: 'Granite GR64F Dump', engine: 'Mack MP8', wmi: '1M2GR4GC', mileage: 142_600, engineHours: 9_850 },
      { unitNumber: 'K-DT5', type: 'straight_truck', year: 2020, make: 'Kenworth', model: 'T880 Dump', engine: 'PACCAR MX-13', wmi: '1NKZX4TX', mileage: 98_240, engineHours: 6_120 },
      tractor('K-HL1', 2017, 'Peterbilt', '389', 'Cummins X15', '1XPXD49X', 521_900),
      trailer('K-LB2', 2015, 'Fontaine', 'Magnitude 55H Lowboy', '13N25330'),
    ],
  },
  {
    name: 'Lakeshore Transit Authority',
    account: 'C-1004',
    phone: '(312) 555-0170',
    email: 'garage@lakeshoretransit.example',
    address: '500 W Harrison St',
    city: 'Chicago',
    state: 'IL',
    zip: '60607',
    terms: 'net45',
    taxExempt: true,
    notes: 'Municipal — tax exempt (certificate on file, exp. 12/2027).',
    contacts: [['Monique Turner', 'Fleet Superintendent', '(312) 555-0171', 'mturner@lakeshoretransit.example']],
    units: [
      { unitNumber: 'LTA-1207', type: 'bus', year: 2019, make: 'Gillig', model: 'Low Floor 40ft', engine: 'Cummins L9', wmi: '15GGD271', mileage: 288_400, engineHours: 14_200 },
      { unitNumber: 'LTA-1211', type: 'bus', year: 2019, make: 'Gillig', model: 'Low Floor 40ft', engine: 'Cummins L9', wmi: '15GGD271', mileage: 276_950, engineHours: 13_640 },
      { unitNumber: 'LTA-P33', type: 'bus', year: 2022, make: 'Ford', model: 'E-450 Paratransit', engine: 'Ford 7.3L', wmi: '1FDFE4FN', mileage: 61_300, engineHours: 3_100 },
    ],
  },
  {
    name: 'Hartley Brothers Trucking',
    account: 'C-1005',
    phone: '(815) 555-0133',
    email: 'dispatch@hartleybros.example',
    address: '42 County Line Rd',
    city: 'Morris',
    state: 'IL',
    zip: '60450',
    terms: 'due_on_receipt',
    contacts: [
      ['Dale Hartley', 'Owner', '(815) 555-0134', 'dale@hartleybros.example'],
      ['Carla Hartley', 'Office', '(815) 555-0135', 'office@hartleybros.example'],
    ],
    units: [
      tractor('HB-07', 2016, 'Kenworth', 'W900L', 'Cummins ISX15', '1XKWD49X', 688_450),
      tractor('HB-09', 2019, 'Peterbilt', '579', 'PACCAR MX-13', '1XPBD49X', 452_310),
      trailer('HB-F14', 2018, 'Great Dane', 'Freedom Flatbed 48ft', '1GRDM962'),
    ],
  },
  {
    name: 'Summit Fuel & Propane',
    account: 'C-1006',
    phone: '(630) 555-0188',
    email: 'ops@summitfuel.example',
    address: '7 Tank Farm Rd',
    city: 'Naperville',
    state: 'IL',
    zip: '60563',
    terms: 'net30',
    contacts: [['Owen Pratt', 'Safety & Compliance', '(630) 555-0189', 'opratt@summitfuel.example']],
    units: [
      { unitNumber: 'SF-T1', type: 'straight_truck', year: 2021, make: 'Freightliner', model: 'M2 106 Propane Bobtail', engine: 'Cummins L9', wmi: '1FVACXFC', mileage: 74_200, engineHours: 4_410 },
      { unitNumber: 'SF-T2', type: 'straight_truck', year: 2017, make: 'International', model: 'HV507 Fuel Tanker', engine: 'Cummins L9', wmi: '1HTEUMML', mileage: 166_780, engineHours: 8_920 },
    ],
  },
  {
    name: 'Blue Heron Logistics',
    account: 'C-1007',
    phone: '(847) 555-0120',
    email: 'maint@blueheronlogistics.example',
    address: '1900 Busse Rd',
    city: 'Elk Grove Village',
    state: 'IL',
    zip: '60007',
    terms: 'net30',
    contacts: [['Priscilla Huang', 'Maintenance Lead', '(847) 555-0121', 'phuang@blueheronlogistics.example']],
    units: [
      tractor('BH-301', 2023, 'International', 'LT625', 'Cummins X15', '3HSDZAPR', 154_700),
      tractor('BH-302', 2023, 'International', 'LT625', 'Cummins X15', '3HSDZAPR', 149_320),
      tractor('BH-305', 2020, 'Mack', 'Anthem 64T', 'Mack MP8', '1M1AN4GY', 389_610),
      trailer('BH-T44', 2021, 'Hyundai Translead', 'HT CompositeVan 53ft', '3H3V532C'),
    ],
  },
  {
    name: 'Walk-in / Owner-Operators',
    account: 'C-1099',
    phone: '(815) 555-0100',
    email: null as unknown as string,
    address: '',
    city: 'Joliet',
    state: 'IL',
    zip: '60436',
    terms: 'due_on_receipt',
    notes: 'Cash & card customers. Collect payment before release.',
    contacts: [['Front counter', 'Shop', '(815) 555-0100', '']],
    units: [tractor('OO-JM', 2015, 'Freightliner', 'Coronado', 'Detroit DD15', '1FUJGLDR', 812_400)],
  },
];

/* --------------------------- Job templates ------------------------------ */

type JobTpl = {
  title: string;
  complaint: string;
  cause: string;
  correction: string;
  hours: number;
  parts: [string, number][];
  forTypes?: string[];
};

const JOBS: Record<string, JobTpl> = {
  pmA: {
    title: 'PM-A service',
    complaint: 'Unit due for PM-A service per maintenance schedule.',
    cause: 'Scheduled preventive maintenance.',
    correction:
      'Changed engine oil and filter, replaced fuel filters, lubed chassis and fifth wheel, checked all fluid levels, inspected brakes, tires, lights and belts. Reset service reminder.',
    hours: 2.0,
    parts: [['OIL-1540-G', 11], ['LF-9080', 1], ['FF-5488', 1], ['FS-1040', 1], ['GRS-EP2', 2]],
    forTypes: ['tractor', 'straight_truck', 'bus'],
  },
  dot: {
    title: 'Annual DOT inspection',
    complaint: 'Annual federal (FMCSA) periodic inspection due.',
    cause: 'Regulatory requirement.',
    correction: 'Performed annual inspection per 49 CFR 396.17. Unit passed; decal applied and report filed.',
    hours: 1.0,
    parts: [],
  },
  brakes: {
    title: 'Drive axle brake reline',
    complaint: 'Driver reports pulling under braking; brakes found out of adjustment at roadside check.',
    cause: 'Drive axle linings worn below 1/4 in.; drums heat-checked beyond limit.',
    correction: 'Replaced brake shoes and hardware on both drive axles, replaced 2 drums and 2 automatic slack adjusters. Adjusted and road tested.',
    hours: 4.5,
    parts: [['BS-4707Q', 4], ['BD-3600A', 2], ['SA-ASA5', 2]],
    forTypes: ['tractor', 'straight_truck'],
  },
  airLeak: {
    title: 'Diagnose & repair air leak',
    complaint: 'Air pressure bleeds down overnight; compressor cycling frequently.',
    cause: 'Air dryer purge valve leaking; desiccant cartridge saturated.',
    correction: 'Replaced air dryer cartridge and purge valve kit. Leak-down test passed (< 2 psi/min).',
    hours: 1.5,
    parts: [['AD-CART', 1], ['AD-PURGE', 1]],
    forTypes: ['tractor', 'straight_truck', 'bus'],
  },
  nox: {
    title: 'Aftertreatment derate — check engine light',
    complaint: 'Check engine light on, engine derated. Driver reports reduced power.',
    cause: 'Fault code for SCR outlet NOx sensor circuit; sensor reading out of range.',
    correction: 'Replaced SCR outlet NOx sensor, performed parked regeneration, cleared codes and verified repair on road test.',
    hours: 2.5,
    parts: [['NOX-OUT-13', 1]],
    forTypes: ['tractor'],
  },
  trlLights: {
    title: 'Repair trailer lighting',
    complaint: 'Multiple marker lamps and left turn signal inoperative.',
    cause: 'Corroded terminals in nose box; four marker lamps failed.',
    correction: 'Replaced 7-way nose box and 4 LED marker lamps. Verified all circuits.',
    hours: 1.2,
    parts: [['NB-7WAY', 1], ['LED-MKR-A', 4]],
    forTypes: ['trailer', 'reefer'],
  },
  steerTires: {
    title: 'Replace steer tires',
    complaint: 'Steer tires measured at 4/32 tread depth.',
    cause: 'Normal wear; below company 5/32 minimum.',
    correction: 'Mounted and balanced 2 new steer tires with new valve stems. Torqued to spec and logged re-torque.',
    hours: 1.0,
    parts: [['TIRE-295-S', 2], ['VS-TR575', 2]],
    forTypes: ['tractor', 'straight_truck'],
  },
  coolant: {
    title: 'Repair coolant leak',
    complaint: 'Coolant puddle under front of truck; low coolant light.',
    cause: 'Upper radiator hose cracked at thermostat housing.',
    correction: 'Replaced upper radiator hose and clamps, refilled coolant, pressure tested cooling system — no leaks.',
    hours: 1.8,
    parts: [['HOSE-URAD', 1], ['CLAMP-TB', 2], ['COOL-ELC-G', 3]],
    forTypes: ['tractor', 'straight_truck', 'bus'],
  },
  starter: {
    title: 'No-start — replace starter',
    complaint: 'Truck clicks but will not crank.',
    cause: 'Batteries tested good; voltage drop test shows failed starter solenoid/motor.',
    correction: 'Replaced starter motor. Verified cranking amps and cable connections.',
    hours: 2.0,
    parts: [['STR-39MT', 1]],
    forTypes: ['tractor', 'straight_truck'],
  },
  wheelSeal: {
    title: 'Replace leaking wheel seal',
    complaint: 'Oil on inside of wheel at roadside inspection.',
    cause: 'Wheel seal failed; bearings serviceable.',
    correction: 'Replaced wheel seal, cleaned and inspected bearings, refilled hub oil, adjusted endplay to spec.',
    hours: 1.5,
    parts: [['WS-370', 1], ['HUB-OIL-Q', 1]],
  },
  reeferPm: {
    title: 'Reefer unit PM',
    complaint: 'Reefer unit due for engine-hour PM.',
    cause: 'Scheduled maintenance.',
    correction: 'Changed reefer oil and filters, checked belts, cleaned condenser, ran pre-trip — unit holding setpoint.',
    hours: 2.0,
    parts: [['RF-OILF', 1], ['RF-FUELF', 1], ['OIL-1540-G', 3]],
    forTypes: ['reefer'],
  },
  ac: {
    title: 'A/C not cooling',
    complaint: 'Cab A/C blowing warm air.',
    cause: 'Low refrigerant; dye test shows leak at condenser core.',
    correction: 'Replaced condenser, evacuated and recharged system with R-134a, verified vent temp 42°F.',
    hours: 3.0,
    parts: [['AC-COND', 1], ['AC-R134', 4]],
    forTypes: ['tractor', 'bus'],
  },
  batteries: {
    title: 'Replace batteries',
    complaint: 'Slow cranking in cold weather.',
    cause: 'Load test: 2 of 3 batteries failed.',
    correction: 'Replaced all 3 batteries as a matched set, cleaned terminals and applied protectant.',
    hours: 0.8,
    parts: [['BAT-31', 3]],
    forTypes: ['tractor', 'straight_truck'],
  },
  trlPm: {
    title: 'Trailer PM & brake adjustment',
    complaint: 'Trailer due for scheduled PM.',
    cause: 'Scheduled preventive maintenance.',
    correction: 'Inspected and adjusted brakes, checked hub oil, lubed landing gear, inspected lights, tires, doors and floor.',
    hours: 1.5,
    parts: [['HUB-OIL-Q', 2], ['GRS-EP2', 1]],
    forTypes: ['trailer', 'reefer'],
  },
};

const DOT_SECTIONS = [
  { section: 'Brake system', items: ['Service brakes', 'Parking brake', 'Brake drums/rotors', 'Brake hoses & tubing', 'Low pressure warning device', 'Tractor protection valve', 'Air compressor', 'Brake adjustment (pushrod stroke)'] },
  { section: 'Coupling devices', items: ['Fifth wheel', 'Pintle hooks', 'Safety devices (chains/cables)'] },
  { section: 'Exhaust & fuel', items: ['Exhaust system — no leaks under cab', 'Fuel tanks & lines secure, no leaks'] },
  { section: 'Lighting', items: ['Headlamps', 'Tail, stop & turn lamps', 'Clearance & marker lamps', 'Reflectors & conspicuity tape'] },
  { section: 'Steering & suspension', items: ['Steering wheel free play', 'Steering column & gear box', 'Pitman arm, drag link, tie rods', 'Springs, hangers & U-bolts', 'Torque/radius arms'] },
  { section: 'Frame & body', items: ['Frame members — no cracks', 'Cab & body components secure', 'Safe loading — no load shift hazards'] },
  { section: 'Tires, wheels & rims', items: ['Tread depth (4/32 steer, 2/32 other)', 'Tire condition & inflation', 'Wheels, rims & lock rings', 'Fasteners — none loose or missing'] },
  { section: 'Cab', items: ['Windshield glazing', 'Windshield wipers & washers', 'Horn', 'Mirrors'] },
];

const PM_SECTIONS = [
  { section: 'Engine', items: ['Engine oil & filter changed', 'Fuel filters changed', 'Air filter restriction', 'Belts & tensioner', 'Coolant level & SCA/freeze point', 'Leaks (oil/fuel/coolant)'] },
  { section: 'Chassis', items: ['Chassis lubed', 'Fifth wheel lubed', 'Driveline U-joints', 'Brake lining thickness', 'Air system leak-down'] },
  { section: 'Electrical', items: ['Battery load test', 'Charging voltage', 'All exterior lamps'] },
  { section: 'Tires', items: ['Tread depth all positions', 'Inflation pressures', 'Wheel nut indicators'] },
];

const TRAILER_SECTIONS = [
  { section: 'Running gear', items: ['Brake adjustment', 'Brake linings', 'Hub oil levels', 'Wheel seals', 'Suspension & air bags'] },
  { section: 'Body', items: ['Doors, hinges & seals', 'Floor & cross members', 'Landing gear operation & lube', 'Kingpin & upper coupler'] },
  { section: 'Electrical & tires', items: ['Lights & ABS lamp', '7-way receptacle', 'Tire tread & inflation', 'Mud flaps'] },
];

/* ================================ Seeder ================================ */

export function seed(db: DB) {
  const rand = rng(20261119);
  const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
  const hash = bcrypt.hashSync(DEMO_PASSWORD, 10);

  db.insert(s.shopSettings)
    .values({
      name: 'Waymore Diesel & Fleet Service',
      address: '1450 Route 53',
      city: 'Joliet',
      state: 'IL',
      zip: '60435',
      phone: '(815) 555-0199',
      email: 'service@waymore-demo.example',
      defaultLaborRateCents: 14500,
      partsTaxRatePct: 8.25,
      laborTaxRatePct: 0,
      shopSuppliesPct: 5,
      shopSuppliesCapCents: 7500,
      shopSuppliesBase: 'labor',
      shopSuppliesTaxable: false,
      markupMatrix: JSON.stringify(DEFAULT_MARKUP_MATRIX),
      invoiceFooter: 'Thank you for your business! Warranty: 12 months / 100,000 miles on parts and labor unless otherwise noted.',
    })
    .run();

  const mkUser = (name: string, email: string, role: (typeof s.users.$inferInsert)['role'], phone?: string) =>
    db.insert(s.users).values({ name, email, role, phone, passwordHash: hash }).returning().get();
  const admin = mkUser('Dana Reyes', 'admin@waymore.dev', 'admin', '(815) 555-0180');
  const writer = mkUser('Marcus Webb', 'writer@waymore.dev', 'service_writer', '(815) 555-0181');
  const writer2 = mkUser('Alicia Grant', 'alicia@waymore.dev', 'service_writer', '(815) 555-0182');
  const parts = mkUser('Kevin Brandt', 'parts@waymore.dev', 'parts_manager', '(815) 555-0183');
  const techs = [
    mkUser('Luis Ortega', 'tech@waymore.dev', 'technician', '(815) 555-0184'),
    mkUser('Jada Price', 'jada@waymore.dev', 'technician', '(815) 555-0185'),
    mkUser('Tom Kowalski', 'tom@waymore.dev', 'technician', '(815) 555-0186'),
    mkUser('Priya Nair', 'priya@waymore.dev', 'technician', '(815) 555-0187'),
  ];
  // Per-tech speed factor (actual / book time) to make the productivity report interesting.
  const techSpeed = [0.85, 1.0, 1.2, 0.95];
  void admin;
  void parts;

  const vendorIds = VENDORS.map((v) => db.insert(s.vendors).values(v).returning().get().id);
  const partByNumber = new Map<string, typeof s.parts.$inferSelect>();
  for (const [partNumber, description, manufacturer, category, vIdx, costCents, qty, rp, rq, bin, markupPct] of PARTS) {
    const p = db
      .insert(s.parts)
      .values({
        partNumber,
        description,
        manufacturer,
        category,
        vendorId: vendorIds[vIdx],
        costCents,
        markupPct: markupPct ?? null,
        qtyOnHand: qty,
        reorderPoint: rp,
        reorderQty: rq,
        binLocation: bin,
        taxable: true,
      })
      .returning()
      .get();
    partByNumber.set(partNumber, p);
  }

  const dotTpl = db.insert(s.inspectionTemplates).values({ name: 'Annual DOT Inspection', description: 'FMCSA periodic inspection (49 CFR 396.17 / Appendix G)', sections: JSON.stringify(DOT_SECTIONS) }).returning().get();
  const pmTpl = db.insert(s.inspectionTemplates).values({ name: 'PM-A Checklist (Power Unit)', description: 'Standard preventive maintenance checklist', sections: JSON.stringify(PM_SECTIONS) }).returning().get();
  db.insert(s.inspectionTemplates).values({ name: 'Trailer PM Checklist', description: 'Dry van / reefer / flatbed trailers', sections: JSON.stringify(TRAILER_SECTIONS) }).run();

  type UnitRow = typeof s.units.$inferSelect;
  const allUnits: (UnitRow & { customerName: string })[] = [];
  const customerRows: (typeof s.customers.$inferSelect)[] = [];
  const pmByUnit = new Map<number, (typeof s.pmSchedules.$inferSelect)[]>();

  for (const c of CUSTOMERS) {
    const cust = db
      .insert(s.customers)
      .values({
        name: c.name,
        accountNumber: c.account,
        phone: c.phone,
        email: c.email || null,
        billingAddress: c.address || null,
        billingCity: c.city,
        billingState: c.state,
        billingZip: c.zip,
        paymentTerms: c.terms,
        taxExempt: c.taxExempt ?? false,
        laborRateCents: c.laborRateCents ?? null,
        partsMarkupPct: c.partsMarkupPct ?? null,
        requiresPo: c.requiresPo ?? false,
        notes: c.notes ?? null,
      })
      .returning()
      .get();
    customerRows.push(cust);
    c.contacts.forEach(([name, title, phone, email], i) =>
      db.insert(s.contacts).values({ customerId: cust.id, name, title, phone, email: email || null, isPrimary: i === 0 }).run(),
    );
    for (const u of c.units) {
      const unit = db
        .insert(s.units)
        .values({
          customerId: cust.id,
          unitNumber: u.unitNumber,
          vin: makeVin(rand, u.wmi, u.year),
          year: u.year,
          make: u.make,
          model: u.model,
          type: u.type,
          engine: u.engine ?? null,
          mileage: u.mileage ?? null,
          engineHours: u.engineHours ?? null,
          licensePlate: `P ${Math.floor(100000 + rand() * 899999)}`,
        })
        .returning()
        .get();
      allUnits.push({ ...unit, customerName: cust.name });

      // PM schedules: whichever-comes-first intervals.
      const pms: (typeof s.pmSchedules.$inferInsert)[] = [];
      const lastDot = daysAgo(Math.floor(30 + rand() * 360)).toISOString().slice(0, 10);
      pms.push({ unitId: unit.id, name: 'Annual DOT inspection', intervalDays: 365, lastDoneAt: lastDot });
      if (unit.mileage != null) {
        const interval = unit.type === 'bus' ? 6000 : 25000;
        const since = Math.floor(rand() * interval * 1.1);
        pms.push({
          unitId: unit.id,
          name: 'PM-A (oil & filters, chassis lube)',
          intervalDays: 120,
          intervalMiles: interval,
          lastDoneAt: daysAgo(Math.floor(15 + rand() * 110)).toISOString().slice(0, 10),
          lastDoneMiles: unit.mileage - since,
          lastDoneHours: unit.engineHours != null ? Math.round(unit.engineHours - since / 38) : null,
        });
      }
      if (unit.type === 'reefer' && unit.engineHours) {
        pms.push({ unitId: unit.id, name: 'Reefer engine PM', intervalHours: 1500, lastDoneHours: unit.engineHours - Math.floor(rand() * 1600) });
      }
      if (unit.type === 'trailer' || unit.type === 'reefer') {
        pms.push({ unitId: unit.id, name: 'Trailer PM & brake adjust', intervalDays: 180, lastDoneAt: daysAgo(Math.floor(20 + rand() * 190)).toISOString().slice(0, 10) });
      }
      pmByUnit.set(unit.id, pms.map((p) => db.insert(s.pmSchedules).values(p).returning().get()));
    }
  }

  /* ----------------------------- Work orders ----------------------------- */

  const settings = db.select().from(s.shopSettings).get()!;
  let woSeq = 10001;
  let invSeq = 50001;

  function createWo(opts: {
    unit: (typeof allUnits)[number];
    jobs: { key: keyof typeof JOBS; status?: 'pending' | 'approved' | 'declined'; tech?: number; done?: boolean }[];
    createdDaysAgo: number;
    priority?: 'low' | 'normal' | 'high' | 'down';
    summary?: string;
    stage: 'estimate' | 'estimate_sent' | 'approved' | 'in_progress' | 'waiting_parts' | 'complete' | 'invoiced';
    clockedInNow?: number; // tech index currently clocked onto the first line
    paid?: 'full' | 'partial' | 'none';
    writerId?: number;
  }) {
    const cust = customerRows.find((c) => c.id === opts.unit.customerId)!;
    const created = daysAgo(opts.createdDaysAgo, 7, Math.floor(rand() * 50));
    const mileageIn = opts.unit.mileage != null ? Math.max(0, opts.unit.mileage - Math.floor(opts.createdDaysAgo * 420)) : null;
    const wo = db
      .insert(s.workOrders)
      .values({
        number: `WO-${woSeq++}`,
        customerId: cust.id,
        unitId: opts.unit.id,
        status: 'estimate',
        priority: opts.priority ?? 'normal',
        summary: opts.summary ?? opts.jobs.map((j) => JOBS[j.key].title).join(', '),
        poNumber: cust.requiresPo ? `PO-RFL-${Math.floor(70000 + rand() * 9999)}` : null,
        mileageIn,
        engineHoursIn: opts.unit.engineHours != null ? Math.max(0, Math.round(opts.unit.engineHours - opts.createdDaysAgo * 9)) : null,
        serviceWriterId: opts.writerId ?? writer.id,
        createdAt: created.toISOString(),
        promisedAt: new Date(created.getTime() + 2 * 86_400_000).toISOString().slice(0, 10),
      })
      .returning()
      .get();

    const isDone = ['complete', 'invoiced'].includes(opts.stage);
    const started = !['estimate', 'estimate_sent', 'approved'].includes(opts.stage);
    const laborRate = cust.laborRateCents ?? settings.defaultLaborRateCents;
    const pmList = pmByUnit.get(opts.unit.id) ?? [];

    opts.jobs.forEach((j, idx) => {
      const tpl = JOBS[j.key];
      const lineStatus = j.status ?? (opts.stage.startsWith('estimate') ? 'pending' : 'approved');
      const techIdx = j.tech ?? Math.floor(rand() * techs.length);
      const pm =
        j.key === 'pmA' ? pmList.find((p) => p.name.startsWith('PM-A')) :
        j.key === 'dot' ? pmList.find((p) => p.name.startsWith('Annual DOT')) :
        j.key === 'reeferPm' ? pmList.find((p) => p.name.startsWith('Reefer')) :
        j.key === 'trlPm' ? pmList.find((p) => p.name.startsWith('Trailer PM')) : undefined;
      const lineDone = j.done ?? (isDone && lineStatus === 'approved');
      const line = db
        .insert(s.workOrderLines)
        .values({
          workOrderId: wo.id,
          sortOrder: idx,
          title: tpl.title,
          complaint: tpl.complaint,
          cause: started || isDone ? tpl.cause : null,
          correction: lineDone ? tpl.correction : null,
          status: lineStatus,
          laborHours: tpl.hours,
          laborRateCents: laborRate,
          technicianId: opts.stage.startsWith('estimate') ? null : techs[techIdx].id,
          done: lineDone,
          pmScheduleId: pm?.id ?? null,
        })
        .returning()
        .get();
      for (const [pn, qty] of tpl.parts) {
        const part = partByNumber.get(pn)!;
        const price = resolvePartPrice({
          costCents: part.costCents,
          partMarkupPct: part.markupPct,
          customerMarkupPct: cust.partsMarkupPct,
          matrix: DEFAULT_MARKUP_MATRIX,
        });
        db.insert(s.workOrderParts)
          .values({
            lineId: line.id,
            partId: part.id,
            partNumber: part.partNumber,
            description: part.description,
            quantity: qty,
            unitCostCents: part.costCents,
            unitPriceCents: price.priceCents,
            taxable: part.taxable,
          })
          .run();
      }
      // Labor time
      if (lineStatus === 'approved' && (started || isDone)) {
        const actualHours = tpl.hours * techSpeed[techIdx] * (0.85 + rand() * 0.3);
        const workDay = Math.max(0, opts.createdDaysAgo - 1);
        const start = daysAgo(workDay, 8 + idx * 2, Math.floor(rand() * 40));
        if (lineDone) {
          // split into two sessions for realism
          const first = actualHours * 0.6;
          const s1End = new Date(start.getTime() + first * 3_600_000);
          const s2Start = new Date(s1End.getTime() + 45 * 60_000);
          const s2End = new Date(s2Start.getTime() + (actualHours - first) * 3_600_000);
          db.insert(s.timeEntries).values({ lineId: line.id, technicianId: techs[techIdx].id, startedAt: start.toISOString(), endedAt: s1End.toISOString() }).run();
          db.insert(s.timeEntries).values({ lineId: line.id, technicianId: techs[techIdx].id, startedAt: s2Start.toISOString(), endedAt: s2End.toISOString() }).run();
        } else if (opts.clockedInNow === techIdx && idx === 0) {
          const st = new Date(Date.now() - (40 + Math.floor(rand() * 60)) * 60_000);
          db.insert(s.timeEntries).values({ lineId: line.id, technicianId: techs[techIdx].id, startedAt: st.toISOString(), endedAt: null }).run();
        } else if (started) {
          const end = new Date(start.getTime() + actualHours * 0.4 * 3_600_000);
          db.insert(s.timeEntries).values({ lineId: line.id, technicianId: techs[techIdx].id, startedAt: start.toISOString(), endedAt: end.toISOString() }).run();
        }
      }
    });

    const status = opts.stage === 'estimate_sent' ? 'estimate' : opts.stage;
    const completedAt = isDone ? daysAgo(Math.max(0, opts.createdDaysAgo - 1), 16, 30).toISOString() : null;
    db.update(s.workOrders)
      .set({
        status,
        completedAt,
        ...(opts.stage === 'estimate_sent'
          ? { authToken: `demo${wo.id}${Math.floor(rand() * 1e9).toString(36)}xxxxxxxxxxxx`.slice(0, 24), authSentAt: new Date(created.getTime() + 3_600_000).toISOString() }
          : {}),
        ...(!opts.stage.startsWith('estimate')
          ? { authorizedAt: new Date(created.getTime() + 2 * 3_600_000).toISOString(), authorizedBy: pick(CUSTOMERS.find((c) => c.name === cust.name)!.contacts)[0] + ' (phone)' }
          : {}),
      })
      .where(eq(s.workOrders.id, wo.id))
      .run();

    if (opts.stage === 'invoiced') {
      const full = loadWorkOrder(db, wo.id);
      const t = full.approvedTotals;
      const issued = new Date(completedAt!);
      const inv = db
        .insert(s.invoices)
        .values({
          number: `INV-${invSeq++}`,
          workOrderId: wo.id,
          customerId: cust.id,
          issuedAt: issued.toISOString(),
          dueAt: dueDateFor(issued, cust.paymentTerms).toISOString(),
          laborCents: t.laborCents,
          partsCents: t.partsCents,
          partsCostCents: t.partsCostCents,
          shopSuppliesCents: t.shopSuppliesCents,
          taxCents: t.taxCents,
          totalCents: t.totalCents,
        })
        .returning()
        .get();
      db.update(s.workOrders).set({ invoicedAt: issued.toISOString() }).where(eq(s.workOrders.id, wo.id)).run();
      const paid = opts.paid ?? 'full';
      if (paid !== 'none') {
        const amount = paid === 'full' ? t.totalCents : Math.round(t.totalCents / 2);
        const method = cust.paymentTerms === 'due_on_receipt' ? pick(['card', 'cash', 'fleet_card']) : pick(['check', 'ach']);
        db.insert(s.payments)
          .values({
            invoiceId: inv.id,
            amountCents: amount,
            method,
            reference: method === 'check' ? `#${Math.floor(10000 + rand() * 80000)}` : method === 'ach' ? `ACH-${Math.floor(rand() * 1e6)}` : null,
            receivedAt: new Date(Math.min(Date.now(), issued.getTime() + Math.floor(rand() * 25) * 86_400_000)).toISOString(),
            userId: writer.id,
          })
          .run();
      }
    }
    return wo;
  }

  const unitsOf = (type: string[]) => allUnits.filter((u) => type.includes(u.type));
  const jobKeysFor = (u: (typeof allUnits)[number]) =>
    (Object.keys(JOBS) as (keyof typeof JOBS)[]).filter((k) => !JOBS[k].forTypes || JOBS[k].forTypes!.includes(u.type));

  // ~6 months of invoiced history.
  for (let i = 0; i < 46; i++) {
    const unit = pick(allUnits);
    const keys = jobKeysFor(unit);
    const n = 1 + Math.floor(rand() * 3);
    const chosen = [...new Set(Array.from({ length: n }, () => pick(keys)))];
    const ago = 175 - Math.floor(i * 3.6) - Math.floor(rand() * 3);
    const declineOne = chosen.length > 1 && rand() < 0.2;
    createWo({
      unit,
      jobs: chosen.map((key, idx) => ({ key, status: declineOne && idx === chosen.length - 1 ? 'declined' : 'approved' })),
      createdDaysAgo: Math.max(4, ago),
      stage: 'invoiced',
      paid: ago < 20 ? (rand() < 0.5 ? 'none' : 'partial') : ago < 90 && i % 4 === 1 ? 'none' : 'full',
      writerId: rand() < 0.6 ? writer.id : writer2.id,
    });
  }

  // Current shop floor.
  const u = (num: string) => allUnits.find((x) => x.unitNumber === num)!;
  createWo({ unit: u('RFL-412'), jobs: [{ key: 'brakes' }, { key: 'airLeak' }], createdDaysAgo: 1, stage: 'estimate_sent', priority: 'high', summary: 'Brakes pulling; air leak — driver waiting' });
  createWo({ unit: u('PSF-21'), jobs: [{ key: 'pmA' }, { key: 'dot' }, { key: 'steerTires' }], createdDaysAgo: 0, stage: 'estimate', summary: 'PM-A + annual DOT, quote steer tires' });
  createWo({ unit: u('BH-301'), jobs: [{ key: 'pmA', tech: 0 }, { key: 'dot', tech: 0 }], createdDaysAgo: 0, stage: 'in_progress', clockedInNow: 0, summary: 'Scheduled PM-A & DOT' });
  createWo({ unit: u('K-DT3'), jobs: [{ key: 'coolant', tech: 1 }, { key: 'batteries', tech: 1 }], createdDaysAgo: 1, stage: 'in_progress', clockedInNow: 1, priority: 'down', summary: 'Coolant leak — unit down at job site' });
  createWo({ unit: u('HB-09'), jobs: [{ key: 'nox', tech: 2 }], createdDaysAgo: 2, stage: 'waiting_parts', priority: 'high', summary: 'Derate — NOx sensor on order' });
  createWo({ unit: u('PSF-R88'), jobs: [{ key: 'reeferPm', tech: 3 }, { key: 'trlLights', tech: 3 }], createdDaysAgo: 1, stage: 'approved', summary: 'Reefer PM, lights out' });
  createWo({ unit: u('LTA-1207'), jobs: [{ key: 'ac', tech: 2 }, { key: 'pmA', tech: 2 }], createdDaysAgo: 3, stage: 'complete', summary: 'A/C warm; PM-A' });
  createWo({ unit: u('SF-T2'), jobs: [{ key: 'dot', tech: 1 }, { key: 'airLeak', tech: 1 }, { key: 'starter', status: 'declined' }], createdDaysAgo: 2, stage: 'complete', summary: 'Annual DOT + air leak (starter quoted, declined)' });
  createWo({ unit: u('RFL-T5302'), jobs: [{ key: 'trlPm', tech: 3 }, { key: 'wheelSeal', tech: 3 }], createdDaysAgo: 1, stage: 'in_progress', summary: 'Trailer PM; wheel seal leaking RR' });
  createWo({ unit: u('HB-07'), jobs: [{ key: 'starter' }, { key: 'batteries' }], createdDaysAgo: 0, stage: 'estimate', priority: 'high', summary: 'No-start, towed in' });

  // Notes, a customer-visible note, and an inspection in progress.
  const wos = db.select().from(s.workOrders).all();
  const inProg = wos.find((w) => w.status === 'in_progress')!;
  db.insert(s.notes).values({ workOrderId: inProg.id, userId: techs[0].id, body: 'Found minor oil seep at rear main — monitor at next PM. Customer notified.', customerVisible: true }).run();
  db.insert(s.notes).values({ workOrderId: inProg.id, userId: writer.id, body: 'Driver waiting in lounge. Promise time 3pm.' }).run();
  const dotResults: Record<string, { result: string; note?: string }> = {};
  DOT_SECTIONS.slice(0, 4).forEach((sec, si) => sec.items.forEach((_, ii) => (dotResults[`${si}.${ii}`] = { result: 'pass' })));
  dotResults['3.2'] = { result: 'repaired', note: 'Replaced 1 amber marker lamp on cab' };
  db.insert(s.inspections).values({ workOrderId: inProg.id, templateId: dotTpl.id, technicianId: techs[0].id, results: JSON.stringify(dotResults), mileage: inProg.mileageIn }).run();
  const completeWo = wos.find((w) => w.status === 'complete')!;
  const pmRes: Record<string, { result: string; note?: string }> = {};
  PM_SECTIONS.forEach((sec, si) => sec.items.forEach((_, ii) => (pmRes[`${si}.${ii}`] = { result: 'pass' })));
  pmRes['2.0'] = { result: 'fail', note: 'Battery #2 at 9.1V under load — recommend replacement (quoted separately).' };
  db.insert(s.inspections).values({ workOrderId: completeWo.id, templateId: pmTpl.id, technicianId: techs[2].id, status: 'complete', results: JSON.stringify(pmRes), completedAt: new Date().toISOString(), mileage: completeWo.mileageIn }).run();

  // One open PO for the backordered NOx sensor, one draft auto-reorder.
  const po = db.insert(s.purchaseOrders).values({ number: 'PO-3001', vendorId: vendorIds[0], status: 'ordered', notes: 'Rush — for WO on HB-09', createdById: parts.id, orderedAt: daysAgo(2, 10).toISOString() }).returning().get();
  db.insert(s.purchaseOrderLines).values({ purchaseOrderId: po.id, partId: partByNumber.get('NOX-OUT-13')!.id, quantity: 2, unitCostCents: 41500 }).run();
  const po2 = db.insert(s.purchaseOrders).values({ number: 'PO-3002', vendorId: vendorIds[4], status: 'draft', createdById: parts.id }).returning().get();
  db.insert(s.purchaseOrderLines).values({ purchaseOrderId: po2.id, partId: partByNumber.get('WB-22')!.id, quantity: 12, unitCostCents: 1150 }).run();
}

export function seedIfEmpty(db: DB) {
  const any = db.select({ id: s.users.id }).from(s.users).limit(1).get();
  if (!any) {
    console.log('[waymore] Empty database — loading demo data…');
    seed(db);
    console.log(`[waymore] Demo data loaded. Sign in as admin@waymore.dev / ${DEMO_PASSWORD}`);
  }
}

// `npm run db:seed` / `npm run db:reset`
if (import.meta.url === `file://${process.argv[1]}`) {
  const db = openDb();
  seedIfEmpty(db);
}
