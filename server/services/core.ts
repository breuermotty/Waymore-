import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  DEFAULT_MARKUP_MATRIX,
  computeTotals,
  invoiceBalance,
  lineLaborCents,
  partExtCents,
  resolvePartPrice,
  totalClockedHours,
  type MarkupTier,
  type ShopFeeSettings,
  type TotalsLine,
} from '../../shared/calc';
import type { DB } from '../db/client';
import * as s from '../db/schema';
import { notFound } from '../http';

export const nowIso = () => new Date().toISOString();

/* ------------------------------ Settings ------------------------------- */

export function getSettings(db: DB) {
  const row = db.select().from(s.shopSettings).limit(1).get();
  if (!row) {
    const created = db
      .insert(s.shopSettings)
      .values({ name: 'My Shop', markupMatrix: JSON.stringify(DEFAULT_MARKUP_MATRIX) })
      .returning()
      .get();
    return { ...created, markupMatrix: DEFAULT_MARKUP_MATRIX };
  }
  let matrix: MarkupTier[] = DEFAULT_MARKUP_MATRIX;
  try {
    matrix = JSON.parse(row.markupMatrix);
  } catch {
    /* keep default */
  }
  return { ...row, markupMatrix: matrix };
}
export type Settings = ReturnType<typeof getSettings>;

export function feeSettings(st: Settings): ShopFeeSettings {
  return {
    partsTaxRatePct: st.partsTaxRatePct,
    laborTaxRatePct: st.laborTaxRatePct,
    shopSuppliesPct: st.shopSuppliesPct,
    shopSuppliesCapCents: st.shopSuppliesCapCents,
    shopSuppliesBase: st.shopSuppliesBase,
    shopSuppliesTaxable: st.shopSuppliesTaxable,
  };
}

/* ------------------------------ Numbering ------------------------------ */

function nextNumber(db: DB, table: 'work_orders' | 'invoices' | 'purchase_orders', prefix: string, start: number) {
  const row = db.$client
    .prepare(`SELECT number FROM ${table} WHERE number LIKE ? ORDER BY id DESC LIMIT 1`)
    .get(`${prefix}-%`) as { number: string } | undefined;
  const last = row ? parseInt(row.number.slice(prefix.length + 1), 10) : start - 1;
  return `${prefix}-${(Number.isFinite(last) ? last : start - 1) + 1}`;
}
export const nextWorkOrderNumber = (db: DB) => nextNumber(db, 'work_orders', 'WO', 10001);
export const nextInvoiceNumber = (db: DB) => nextNumber(db, 'invoices', 'INV', 50001);
export const nextPoNumber = (db: DB) => nextNumber(db, 'purchase_orders', 'PO', 3001);

/* ------------------------------ Inventory ------------------------------ */

export function moveStock(
  db: DB,
  partId: number,
  qty: number,
  reason: 'work_order' | 'purchase_order' | 'adjustment',
  ref: { workOrderId?: number; purchaseOrderId?: number; userId?: number; note?: string } = {},
) {
  if (!qty) return;
  db.update(s.parts)
    .set({ qtyOnHand: sql`${s.parts.qtyOnHand} + ${qty}` })
    .where(eq(s.parts.id, partId))
    .run();
  db.insert(s.inventoryMoves)
    .values({ partId, qty, reason, ...ref })
    .run();
}

/** Price a catalog part for a given customer. */
export function pricePartForCustomer(db: DB, partId: number, customerId: number) {
  const part = db.select().from(s.parts).where(eq(s.parts.id, partId)).get();
  if (!part) throw notFound('Part');
  const cust = db.select().from(s.customers).where(eq(s.customers.id, customerId)).get();
  const st = getSettings(db);
  const price = resolvePartPrice({
    costCents: part.costCents,
    listPriceCents: part.listPriceCents,
    partMarkupPct: part.markupPct,
    customerMarkupPct: cust?.partsMarkupPct,
    matrix: st.markupMatrix,
  });
  return { part, ...price };
}

/* ----------------------------- Work orders ----------------------------- */

export function loadWorkOrder(db: DB, id: number) {
  const wo = db.select().from(s.workOrders).where(eq(s.workOrders.id, id)).get();
  if (!wo) throw notFound('Work order');
  const customer = db.select().from(s.customers).where(eq(s.customers.id, wo.customerId)).get()!;
  const unit = db.select().from(s.units).where(eq(s.units.id, wo.unitId)).get()!;
  const lines = db
    .select()
    .from(s.workOrderLines)
    .where(eq(s.workOrderLines.workOrderId, id))
    .orderBy(asc(s.workOrderLines.sortOrder), asc(s.workOrderLines.id))
    .all();
  const lineIds = lines.map((l) => l.id);
  const parts = lineIds.length
    ? db.select().from(s.workOrderParts).where(inArray(s.workOrderParts.lineId, lineIds)).all()
    : [];
  const entries = lineIds.length
    ? db
        .select({
          id: s.timeEntries.id,
          lineId: s.timeEntries.lineId,
          technicianId: s.timeEntries.technicianId,
          technicianName: s.users.name,
          startedAt: s.timeEntries.startedAt,
          endedAt: s.timeEntries.endedAt,
        })
        .from(s.timeEntries)
        .leftJoin(s.users, eq(s.users.id, s.timeEntries.technicianId))
        .where(inArray(s.timeEntries.lineId, lineIds))
        .orderBy(asc(s.timeEntries.startedAt))
        .all()
    : [];
  const techs = db.select({ id: s.users.id, name: s.users.name }).from(s.users).all();
  const techName = new Map(techs.map((t) => [t.id, t.name]));
  const now = new Date();

  const detailedLines = lines.map((l) => {
    const lp = parts.filter((p) => p.lineId === l.id).map((p) => ({ ...p, extCents: partExtCents(p) }));
    const le = entries.filter((e) => e.lineId === l.id);
    return {
      ...l,
      technicianName: l.technicianId ? (techName.get(l.technicianId) ?? null) : null,
      parts: lp,
      timeEntries: le,
      clockedHours: totalClockedHours(le, now),
      laborCents: lineLaborCents(l),
      partsCents: lp.reduce((sum, p) => sum + p.extCents, 0),
    };
  });

  const st = getSettings(db);
  const fees = feeSettings(st);
  const toTotals = (ls: typeof detailedLines): TotalsLine[] =>
    ls.map((l) => ({
      status: l.status,
      laborHours: l.laborHours,
      laborRateCents: l.laborRateCents,
      parts: l.parts.map((p) => ({
        quantity: p.quantity,
        unitPriceCents: p.unitPriceCents,
        unitCostCents: p.unitCostCents,
        taxable: p.taxable,
      })),
    }));
  // Estimate total: everything not declined. Authorized total: approved lines only.
  const estimateTotals = computeTotals(toTotals(detailedLines), fees, { taxExempt: customer.taxExempt });
  const approvedTotals = computeTotals(
    toTotals(detailedLines.filter((l) => l.status === 'approved')),
    fees,
    { taxExempt: customer.taxExempt },
  );

  const invoice = db.select().from(s.invoices).where(and(eq(s.invoices.workOrderId, id), eq(s.invoices.voided, false))).get();
  const serviceWriter = wo.serviceWriterId ? (techName.get(wo.serviceWriterId) ?? null) : null;

  return {
    ...wo,
    serviceWriterName: serviceWriter,
    customer,
    unit,
    lines: detailedLines,
    estimateTotals,
    approvedTotals,
    clockedHours: Math.round(detailedLines.reduce((a, l) => a + l.clockedHours, 0) * 100) / 100,
    invoice: invoice ? { id: invoice.id, number: invoice.number } : null,
  };
}
export type WorkOrderDetail = ReturnType<typeof loadWorkOrder>;

export function closeOpenEntriesForTech(db: DB, technicianId: number, at = nowIso()) {
  db.update(s.timeEntries)
    .set({ endedAt: at })
    .where(and(eq(s.timeEntries.technicianId, technicianId), isNull(s.timeEntries.endedAt)))
    .run();
}

export function closeOpenEntriesForWorkOrder(db: DB, workOrderId: number, at = nowIso()) {
  db.$client
    .prepare(
      `UPDATE time_entries SET ended_at = ? WHERE ended_at IS NULL
       AND line_id IN (SELECT id FROM work_order_lines WHERE work_order_id = ?)`,
    )
    .run(at, workOrderId);
}

/* ------------------------------ Invoices ------------------------------- */

export function invoiceWithBalance(db: DB, invoiceId: number) {
  const inv = db.select().from(s.invoices).where(eq(s.invoices.id, invoiceId)).get();
  if (!inv) throw notFound('Invoice');
  const pays = db.select().from(s.payments).where(eq(s.payments.invoiceId, invoiceId)).orderBy(asc(s.payments.receivedAt)).all();
  return { ...inv, payments: pays, ...invoiceBalance(inv.totalCents, pays.map((p) => p.amountCents), inv.voided) };
}
