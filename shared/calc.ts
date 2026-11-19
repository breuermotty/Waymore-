import { type Cents, pctOf } from './money';
import type { LineStatus, PaymentTerms } from './constants';

/* ------------------------------------------------------------------ */
/* Parts markup                                                        */
/* ------------------------------------------------------------------ */

/**
 * A tier of the shop's markup matrix. A part whose cost is <= upToCents gets markupPct.
 * The last tier should have upToCents = null (applies to everything above).
 */
export interface MarkupTier {
  upToCents: number | null;
  markupPct: number;
}

export const DEFAULT_MARKUP_MATRIX: MarkupTier[] = [
  { upToCents: 1_000, markupPct: 100 },
  { upToCents: 5_000, markupPct: 60 },
  { upToCents: 20_000, markupPct: 40 },
  { upToCents: 100_000, markupPct: 30 },
  { upToCents: null, markupPct: 20 },
];

export function markupPctForCost(costCents: Cents, matrix: MarkupTier[]): number {
  const sorted = [...matrix].sort((a, b) => (a.upToCents ?? Infinity) - (b.upToCents ?? Infinity));
  for (const tier of sorted) {
    if (tier.upToCents === null || costCents <= tier.upToCents) return tier.markupPct;
  }
  return sorted.length ? sorted[sorted.length - 1].markupPct : 0;
}

export function applyMarkup(costCents: Cents, markupPct: number): Cents {
  return costCents + pctOf(costCents, markupPct);
}

/**
 * Resolve the sell price of a part. Precedence:
 *   1. a fixed list price on the part
 *   2. a markup % set on the part
 *   3. a markup % negotiated with the customer
 *   4. the shop's tiered markup matrix
 */
export function resolvePartPrice(opts: {
  costCents: Cents;
  listPriceCents?: Cents | null;
  partMarkupPct?: number | null;
  customerMarkupPct?: number | null;
  matrix: MarkupTier[];
}): { priceCents: Cents; markupPct: number; source: 'list' | 'part' | 'customer' | 'matrix' } {
  const { costCents } = opts;
  if (opts.listPriceCents != null && opts.listPriceCents > 0) {
    const pct = costCents > 0 ? Math.round(((opts.listPriceCents - costCents) / costCents) * 10000) / 100 : 0;
    return { priceCents: opts.listPriceCents, markupPct: pct, source: 'list' };
  }
  if (opts.partMarkupPct != null) {
    return { priceCents: applyMarkup(costCents, opts.partMarkupPct), markupPct: opts.partMarkupPct, source: 'part' };
  }
  if (opts.customerMarkupPct != null) {
    return {
      priceCents: applyMarkup(costCents, opts.customerMarkupPct),
      markupPct: opts.customerMarkupPct,
      source: 'customer',
    };
  }
  const pct = markupPctForCost(costCents, opts.matrix);
  return { priceCents: applyMarkup(costCents, pct), markupPct: pct, source: 'matrix' };
}

/* ------------------------------------------------------------------ */
/* Labor time                                                          */
/* ------------------------------------------------------------------ */

export interface TimeEntryLike {
  startedAt: string | number | Date;
  endedAt?: string | number | Date | null;
}

const toMs = (d: string | number | Date) => (d instanceof Date ? d.getTime() : new Date(d).getTime());

/** Minutes for one clock-in/clock-out. Open entries run until `now`. Never negative. */
export function entryMinutes(e: TimeEntryLike, now: Date = new Date()): number {
  const start = toMs(e.startedAt);
  const end = e.endedAt != null ? toMs(e.endedAt) : now.getTime();
  return Math.max(0, (end - start) / 60_000);
}

/** Total clocked hours across entries, rounded to 2 decimals (0.01h = 36s). */
export function totalClockedHours(entries: TimeEntryLike[], now: Date = new Date()): number {
  const mins = entries.reduce((s, e) => s + entryMinutes(e, now), 0);
  return Math.round((mins / 60) * 100) / 100;
}

/**
 * Technician efficiency: hours billed (flagged) vs hours actually clocked.
 * 100% = finished exactly in book time. Returns null when nothing has been clocked.
 */
export function efficiencyPct(billedHours: number, clockedHours: number): number | null {
  if (clockedHours <= 0) return null;
  return Math.round((billedHours / clockedHours) * 1000) / 10;
}

/* ------------------------------------------------------------------ */
/* Work order / invoice totals                                         */
/* ------------------------------------------------------------------ */

export interface TotalsPart {
  quantity: number;
  unitPriceCents: Cents;
  unitCostCents?: Cents;
  taxable: boolean;
}

export interface TotalsLine {
  status: LineStatus;
  laborHours: number;
  laborRateCents: Cents;
  parts: TotalsPart[];
}

export interface ShopFeeSettings {
  partsTaxRatePct: number;
  laborTaxRatePct: number; // 0 when labor is not taxable in the shop's jurisdiction
  shopSuppliesPct: number;
  shopSuppliesCapCents: Cents; // 0 = no cap
  shopSuppliesBase: 'labor' | 'labor_parts';
  shopSuppliesTaxable: boolean;
}

export interface Totals {
  laborCents: Cents;
  partsCents: Cents;
  partsCostCents: Cents;
  taxablePartsCents: Cents;
  shopSuppliesCents: Cents;
  subtotalCents: Cents;
  taxCents: Cents;
  totalCents: Cents;
  /** Value of declined lines, for reporting "lost" work. */
  declinedCents: Cents;
}

export function lineLaborCents(l: Pick<TotalsLine, 'laborHours' | 'laborRateCents'>): Cents {
  return Math.round(l.laborHours * l.laborRateCents);
}

export function partExtCents(p: Pick<TotalsPart, 'quantity' | 'unitPriceCents'>): Cents {
  return Math.round(p.quantity * p.unitPriceCents);
}

export function lineTotalCents(l: TotalsLine): Cents {
  return lineLaborCents(l) + l.parts.reduce((s, p) => s + partExtCents(p), 0);
}

/**
 * Compute totals for a work order / estimate / invoice.
 * Declined lines are excluded. Pending lines are included (an estimate shows its full value).
 */
export function computeTotals(
  lines: TotalsLine[],
  fees: ShopFeeSettings,
  opts: { taxExempt?: boolean } = {},
): Totals {
  let laborCents = 0;
  let partsCents = 0;
  let partsCostCents = 0;
  let taxablePartsCents = 0;
  let declinedCents = 0;

  for (const line of lines) {
    if (line.status === 'declined') {
      declinedCents += lineTotalCents(line);
      continue;
    }
    laborCents += lineLaborCents(line);
    for (const p of line.parts) {
      const ext = partExtCents(p);
      partsCents += ext;
      partsCostCents += Math.round(p.quantity * (p.unitCostCents ?? 0));
      if (p.taxable) taxablePartsCents += ext;
    }
  }

  const base = fees.shopSuppliesBase === 'labor_parts' ? laborCents + partsCents : laborCents;
  let shopSuppliesCents = pctOf(base, fees.shopSuppliesPct);
  if (fees.shopSuppliesCapCents > 0) shopSuppliesCents = Math.min(shopSuppliesCents, fees.shopSuppliesCapCents);

  let taxCents = 0;
  if (!opts.taxExempt) {
    const partsTaxBase = taxablePartsCents + (fees.shopSuppliesTaxable ? shopSuppliesCents : 0);
    // Compute in fractional cents and round once to avoid double rounding.
    const rawTax = (partsTaxBase * fees.partsTaxRatePct) / 100 + (laborCents * fees.laborTaxRatePct) / 100;
    taxCents = Math.round(rawTax + 1e-9);
  }

  const subtotalCents = laborCents + partsCents + shopSuppliesCents;
  return {
    laborCents,
    partsCents,
    partsCostCents,
    taxablePartsCents,
    shopSuppliesCents,
    subtotalCents,
    taxCents,
    totalCents: subtotalCents + taxCents,
    declinedCents,
  };
}

/* ------------------------------------------------------------------ */
/* Invoices & payments                                                 */
/* ------------------------------------------------------------------ */

const TERMS_DAYS: Record<PaymentTerms, number> = {
  due_on_receipt: 0,
  net15: 15,
  net30: 30,
  net45: 45,
  net60: 60,
};

export function dueDateFor(issued: Date, terms: PaymentTerms): Date {
  const d = new Date(issued.getTime());
  d.setUTCDate(d.getUTCDate() + (TERMS_DAYS[terms] ?? 0));
  return d;
}

export type InvoiceStatus = 'unpaid' | 'partial' | 'paid' | 'void';

export function invoiceBalance(
  totalCents: Cents,
  paymentsCents: Cents[],
  voided = false,
): { paidCents: Cents; balanceCents: Cents; status: InvoiceStatus } {
  const paidCents = paymentsCents.reduce((s, p) => s + p, 0);
  const balanceCents = totalCents - paidCents;
  let status: InvoiceStatus = 'unpaid';
  if (voided) status = 'void';
  else if (balanceCents <= 0) status = 'paid';
  else if (paidCents > 0) status = 'partial';
  return { paidCents, balanceCents, status };
}

/* ------------------------------------------------------------------ */
/* Preventive maintenance                                              */
/* ------------------------------------------------------------------ */

export interface PmScheduleLike {
  intervalDays?: number | null;
  intervalMiles?: number | null;
  intervalHours?: number | null;
  lastDoneAt?: string | Date | null;
  lastDoneMiles?: number | null;
  lastDoneHours?: number | null;
}

export interface PmDue {
  status: 'ok' | 'due_soon' | 'overdue';
  nextDueDate: string | null; // YYYY-MM-DD
  nextDueMiles: number | null;
  nextDueHours: number | null;
  daysRemaining: number | null;
  milesRemaining: number | null;
  hoursRemaining: number | null;
  reasons: string[];
}

export const PM_SOON = { days: 14, miles: 1_500, hours: 50 };

/** PM is due at whichever interval (date, miles or engine hours) comes first. */
export function pmDue(
  s: PmScheduleLike,
  unit: { mileage?: number | null; engineHours?: number | null },
  today: Date = new Date(),
  soon = PM_SOON,
): PmDue {
  const reasons: string[] = [];
  let overdue = false;
  let dueSoon = false;
  let nextDueDate: string | null = null;
  let daysRemaining: number | null = null;
  let nextDueMiles: number | null = null;
  let milesRemaining: number | null = null;
  let nextDueHours: number | null = null;
  let hoursRemaining: number | null = null;

  if (s.intervalDays) {
    const last = s.lastDoneAt ? new Date(s.lastDoneAt) : null;
    if (last) {
      const due = new Date(last.getTime());
      due.setUTCDate(due.getUTCDate() + s.intervalDays);
      nextDueDate = due.toISOString().slice(0, 10);
      const t0 = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
      daysRemaining = Math.round((due.getTime() - t0) / 86_400_000);
    } else {
      daysRemaining = 0;
      reasons.push('Never performed');
      overdue = true;
    }
    if (daysRemaining !== null && last) {
      if (daysRemaining < 0) {
        overdue = true;
        reasons.push(`${-daysRemaining} days overdue`);
      } else if (daysRemaining <= soon.days) {
        dueSoon = true;
        reasons.push(`Due in ${daysRemaining} days`);
      }
    }
  }

  if (s.intervalMiles && unit.mileage != null) {
    const base = s.lastDoneMiles ?? 0;
    nextDueMiles = base + s.intervalMiles;
    milesRemaining = nextDueMiles - unit.mileage;
    if (milesRemaining < 0) {
      overdue = true;
      reasons.push(`${(-milesRemaining).toLocaleString('en-US')} mi overdue`);
    } else if (milesRemaining <= soon.miles) {
      dueSoon = true;
      reasons.push(`Due in ${milesRemaining.toLocaleString('en-US')} mi`);
    }
  }

  if (s.intervalHours && unit.engineHours != null) {
    const base = s.lastDoneHours ?? 0;
    nextDueHours = base + s.intervalHours;
    hoursRemaining = Math.round((nextDueHours - unit.engineHours) * 10) / 10;
    if (hoursRemaining < 0) {
      overdue = true;
      reasons.push(`${-hoursRemaining} engine hrs overdue`);
    } else if (hoursRemaining <= soon.hours) {
      dueSoon = true;
      reasons.push(`Due in ${hoursRemaining} engine hrs`);
    }
  }

  return {
    status: overdue ? 'overdue' : dueSoon ? 'due_soon' : 'ok',
    nextDueDate,
    nextDueMiles,
    nextDueHours,
    daysRemaining,
    milesRemaining,
    hoursRemaining,
    reasons,
  };
}
