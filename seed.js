// Adds sample data so you can try the app. Safe to skip for real use.
import { openDb } from './db.js';

const db = openDb();
if (db.prepare('SELECT COUNT(*) AS n FROM customers').get().n > 0) {
  console.log('Database already has data; not seeding.');
  process.exit(0);
}
const ins = (sql, ...p) => Number(db.prepare(sql).run(...p).lastInsertRowid);
db.prepare(`UPDATE settings SET shop_name = 'Waymore Truck & Trailer Repair', labor_rate = 155, tax_rate_pct = 7 WHERE id = 1`).run();
const c1 = ins(`INSERT INTO customers (name, contact, phone, email) VALUES ('Rivera Hauling LLC', 'Ana Rivera', '555-201-4410', 'dispatch@example.com')`);
const c2 = ins(`INSERT INTO customers (name, contact, phone) VALUES ('Northside Concrete', 'Dale Pruitt', '555-339-0187')`);
const u1 = ins(`INSERT INTO units (customer_id, unit_number, year, make, model, vin, mileage) VALUES (?, '104', '2019', 'Freightliner', 'Cascadia', '3AKJHHDR5KSXXXXXX', 482110)`, c1);
ins(`INSERT INTO units (customer_id, unit_number, year, make, model, mileage) VALUES (?, '221', '2021', 'Peterbilt', '579', 301442)`, c1);
ins(`INSERT INTO units (customer_id, unit_number, year, make, model, mileage) VALUES (?, 'M-7', '2017', 'Mack', 'Granite', 198004)`, c2);
ins(`INSERT INTO technicians (name, pin) VALUES ('Mike Torres', '1111')`);
ins(`INSERT INTO technicians (name, pin) VALUES ('Jess Allen', '2222')`);
for (const [pn, d, v, cost, qty, re] of [
  ['DF-1150', 'Fuel filter', 'FleetPride', 18.4, 12, 4],
  ['LF-9009', 'Oil filter', 'FleetPride', 22.15, 10, 4],
  ['BP-4707', 'Brake shoe kit 4707Q', 'TruckPro', 64.9, 6, 4],
  ['BC-3000', 'Brake chamber 30/30', 'TruckPro', 48.0, 2, 3],
  ['OIL-15W40', '15W-40 oil (gal)', 'Local', 14.25, 55, 20],
]) ins(`INSERT INTO parts (part_number, description, vendor, cost, qty_on_hand, reorder_at) VALUES (?,?,?,?,?,?)`, pn, d, v, cost, qty, re);
const wo = ins(`INSERT INTO work_orders (customer_id, unit_id, status, mileage) VALUES (?, ?, 'approved', 482110)`, c1, u1);
ins(`INSERT INTO jobs (work_order_id, complaint, estimated_hours) VALUES (?, 'PM service A', 1.5)`, wo);
ins(`INSERT INTO jobs (work_order_id, complaint, estimated_hours) VALUES (?, 'Driver reports air leak at rear axle', 1)`, wo);
console.log('Sample data added. Tech PINs: Mike 1111, Jess 2222.');
