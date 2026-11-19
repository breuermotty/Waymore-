import { eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { resolvePartPrice } from '../../shared/calc';
import { requireRole } from '../auth';
import type { DB } from '../db/client';
import * as s from '../db/schema';
import { HttpError, badRequest, idParam, notFound, parse, zOptNum, zOptStr } from '../http';
import { getSettings, moveStock, nextPoNumber, nowIso, pricePartForCustomer } from '../services/core';

const partsMgr = requireRole('parts_manager');

const partInput = z.object({
  partNumber: z.string().trim().min(1, 'Part number is required').toUpperCase(),
  description: z.string().trim().min(1, 'Description is required'),
  manufacturer: zOptStr,
  category: zOptStr,
  vendorId: zOptNum,
  costCents: z.coerce.number().int().min(0),
  markupPct: zOptNum,
  listPriceCents: zOptNum,
  reorderPoint: z.coerce.number().min(0).default(0),
  reorderQty: z.coerce.number().min(0).default(0),
  binLocation: zOptStr,
  taxable: z.boolean().default(true),
  active: z.boolean().default(true),
});

const vendorInput = z.object({
  name: z.string().trim().min(1),
  contactName: zOptStr,
  phone: zOptStr,
  email: zOptStr,
  accountNumber: zOptStr,
  address: zOptStr,
  notes: zOptStr,
});

const poLineInput = z.object({
  partId: z.number().int(),
  quantity: z.coerce.number().positive(),
  unitCostCents: z.coerce.number().int().min(0).optional(),
});

export function partRoutes(db: DB) {
  const r = Router();

  r.get('/parts', (req, res) => {
    const q = String(req.query.q ?? '').trim();
    const low = req.query.low === '1';
    const st = getSettings(db);
    const rows = db.$client
      .prepare(
        `SELECT p.*, v.name AS vendor_name,
           (SELECT COALESCE(SUM(l.quantity - l.received_qty),0) FROM purchase_order_lines l JOIN purchase_orders po ON po.id = l.purchase_order_id
             WHERE l.part_id = p.id AND po.status IN ('ordered','partial')) AS on_order
         FROM parts p LEFT JOIN vendors v ON v.id = p.vendor_id
         WHERE (? = '' OR p.part_number LIKE ? OR p.description LIKE ? OR p.manufacturer LIKE ? OR p.category LIKE ?)
           AND (? = 0 OR (p.qty_on_hand <= p.reorder_point AND p.active = 1))
         ORDER BY p.part_number LIMIT 1000`,
      )
      .all(q, ...Array(4).fill(`%${q}%`), low ? 1 : 0) as Record<string, any>[];
    res.json(
      rows.map((p) => {
        const price = resolvePartPrice({
          costCents: p.cost_cents,
          listPriceCents: p.list_price_cents,
          partMarkupPct: p.markup_pct,
          matrix: st.markupMatrix,
        });
        return {
          id: p.id,
          partNumber: p.part_number,
          description: p.description,
          manufacturer: p.manufacturer,
          category: p.category,
          vendorId: p.vendor_id,
          vendorName: p.vendor_name,
          costCents: p.cost_cents,
          markupPct: p.markup_pct,
          listPriceCents: p.list_price_cents,
          priceCents: price.priceCents,
          effectiveMarkupPct: price.markupPct,
          priceSource: price.source,
          qtyOnHand: p.qty_on_hand,
          onOrder: p.on_order,
          reorderPoint: p.reorder_point,
          reorderQty: p.reorder_qty,
          binLocation: p.bin_location,
          taxable: !!p.taxable,
          active: !!p.active,
          lowStock: p.qty_on_hand <= p.reorder_point,
        };
      }),
    );
  });

  r.get('/parts/:id', (req, res) => {
    const id = idParam(req);
    const part = db.select().from(s.parts).where(eq(s.parts.id, id)).get();
    if (!part) throw notFound('Part');
    const moves = db.$client
      .prepare(
        `SELECT m.*, w.number AS wo_number, po.number AS po_number, u.name AS user_name FROM inventory_moves m
         LEFT JOIN work_orders w ON w.id = m.work_order_id LEFT JOIN purchase_orders po ON po.id = m.purchase_order_id
         LEFT JOIN users u ON u.id = m.user_id
         WHERE m.part_id = ? ORDER BY m.id DESC LIMIT 100`,
      )
      .all(id);
    res.json({ ...part, moves });
  });

  /** Price preview for a part on a given customer's work order. */
  r.get('/parts/:id/price', (req, res) => {
    const customerId = Number(req.query.customerId);
    const p = pricePartForCustomer(db, idParam(req), customerId);
    res.json({ priceCents: p.priceCents, markupPct: p.markupPct, source: p.source });
  });

  r.post('/parts', partsMgr, (req, res) => {
    const body = parse(partInput.extend({ qtyOnHand: z.coerce.number().min(0).default(0) }), req.body);
    const { qtyOnHand, ...rest } = body;
    const part = db.insert(s.parts).values({ ...rest, qtyOnHand: 0 }).returning().get();
    if (qtyOnHand) moveStock(db, part.id, qtyOnHand, 'adjustment', { userId: req.user!.id, note: 'Opening stock' });
    res.status(201).json({ ...part, qtyOnHand });
  });

  r.put('/parts/:id', partsMgr, (req, res) => {
    const body = parse(partInput, req.body);
    const row = db.update(s.parts).set(body).where(eq(s.parts.id, idParam(req))).returning().get();
    if (!row) throw notFound('Part');
    res.json(row);
  });

  r.post('/parts/:id/adjust', partsMgr, (req, res) => {
    const id = idParam(req);
    const body = parse(z.object({ newQty: z.coerce.number().min(0), note: zOptStr }), req.body);
    const part = db.select().from(s.parts).where(eq(s.parts.id, id)).get();
    if (!part) throw notFound('Part');
    moveStock(db, id, body.newQty - part.qtyOnHand, 'adjustment', { userId: req.user!.id, note: body.note ?? 'Cycle count' });
    res.json(db.select().from(s.parts).where(eq(s.parts.id, id)).get());
  });

  /* ---- Vendors ---- */

  r.get('/vendors', (_req, res) => {
    res.json(
      db.$client
        .prepare(
          `SELECT v.*, (SELECT COUNT(*) FROM parts p WHERE p.vendor_id = v.id) AS partCount,
             (SELECT COUNT(*) FROM purchase_orders po WHERE po.vendor_id = v.id AND po.status IN ('draft','ordered','partial')) AS openPoCount
           FROM vendors v ORDER BY v.name`,
        )
        .all()
        .map((v: any) => ({
          id: v.id,
          name: v.name,
          contactName: v.contact_name,
          phone: v.phone,
          email: v.email,
          accountNumber: v.account_number,
          address: v.address,
          notes: v.notes,
          partCount: v.partCount,
          openPoCount: v.openPoCount,
        })),
    );
  });

  r.post('/vendors', partsMgr, (req, res) => {
    res.status(201).json(db.insert(s.vendors).values(parse(vendorInput, req.body)).returning().get());
  });

  r.put('/vendors/:id', partsMgr, (req, res) => {
    const row = db.update(s.vendors).set(parse(vendorInput, req.body)).where(eq(s.vendors.id, idParam(req))).returning().get();
    if (!row) throw notFound('Vendor');
    res.json(row);
  });

  /* ---- Purchase orders ---- */

  const loadPo = (id: number) => {
    const po = db.select().from(s.purchaseOrders).where(eq(s.purchaseOrders.id, id)).get();
    if (!po) throw notFound('Purchase order');
    const vendor = db.select().from(s.vendors).where(eq(s.vendors.id, po.vendorId)).get();
    const lines = db
      .select({
        id: s.purchaseOrderLines.id,
        partId: s.purchaseOrderLines.partId,
        quantity: s.purchaseOrderLines.quantity,
        receivedQty: s.purchaseOrderLines.receivedQty,
        unitCostCents: s.purchaseOrderLines.unitCostCents,
        partNumber: s.parts.partNumber,
        description: s.parts.description,
        qtyOnHand: s.parts.qtyOnHand,
      })
      .from(s.purchaseOrderLines)
      .innerJoin(s.parts, eq(s.parts.id, s.purchaseOrderLines.partId))
      .where(eq(s.purchaseOrderLines.purchaseOrderId, id))
      .all();
    const totalCents = lines.reduce((sum, l) => sum + Math.round(l.quantity * l.unitCostCents), 0);
    return { ...po, vendor, lines, totalCents };
  };

  r.get('/purchase-orders', (_req, res) => {
    res.json(
      db.$client
        .prepare(
          `SELECT po.id, po.number, po.status, po.created_at AS createdAt, po.ordered_at AS orderedAt, po.received_at AS receivedAt,
             v.name AS vendorName,
             (SELECT COUNT(*) FROM purchase_order_lines l WHERE l.purchase_order_id = po.id) AS lineCount,
             (SELECT COALESCE(SUM(ROUND(l.quantity * l.unit_cost_cents)),0) FROM purchase_order_lines l WHERE l.purchase_order_id = po.id) AS totalCents
           FROM purchase_orders po JOIN vendors v ON v.id = po.vendor_id ORDER BY po.id DESC`,
        )
        .all(),
    );
  });

  r.get('/purchase-orders/:id', (req, res) => {
    res.json(loadPo(idParam(req)));
  });

  r.post('/purchase-orders', partsMgr, (req, res) => {
    const body = parse(z.object({ vendorId: z.number().int(), notes: zOptStr, lines: z.array(poLineInput).default([]) }), req.body);
    const id = db.transaction((tx) => {
      const po = tx
        .insert(s.purchaseOrders)
        .values({ number: nextPoNumber(db), vendorId: body.vendorId, notes: body.notes, createdById: req.user!.id })
        .returning()
        .get();
      for (const l of body.lines) {
        const part = tx.select().from(s.parts).where(eq(s.parts.id, l.partId)).get();
        if (!part) throw notFound('Part');
        tx.insert(s.purchaseOrderLines)
          .values({ purchaseOrderId: po.id, partId: l.partId, quantity: l.quantity, unitCostCents: l.unitCostCents ?? part.costCents })
          .run();
      }
      return po.id;
    });
    res.status(201).json(loadPo(id));
  });

  /** Create a draft PO per vendor for every active part at/below its reorder point. */
  r.post('/purchase-orders/auto-reorder', partsMgr, (req, res) => {
    const low = db.$client
      .prepare(
        `SELECT p.* FROM parts p WHERE p.active = 1 AND p.vendor_id IS NOT NULL AND p.qty_on_hand <= p.reorder_point
           AND NOT EXISTS (SELECT 1 FROM purchase_order_lines l JOIN purchase_orders po ON po.id = l.purchase_order_id
                            WHERE l.part_id = p.id AND po.status IN ('draft','ordered','partial'))`,
      )
      .all() as any[];
    const byVendor = new Map<number, any[]>();
    for (const p of low) byVendor.set(p.vendor_id, [...(byVendor.get(p.vendor_id) ?? []), p]);
    const created: string[] = [];
    db.transaction((tx) => {
      for (const [vendorId, ps] of byVendor) {
        const po = tx
          .insert(s.purchaseOrders)
          .values({ number: nextPoNumber(db), vendorId, notes: 'Auto-generated from reorder points', createdById: req.user!.id })
          .returning()
          .get();
        for (const p of ps) {
          const qty = Math.max(p.reorder_qty || 0, p.reorder_point - p.qty_on_hand + 1);
          tx.insert(s.purchaseOrderLines).values({ purchaseOrderId: po.id, partId: p.id, quantity: qty, unitCostCents: p.cost_cents }).run();
        }
        created.push(po.number);
      }
    });
    res.json({ created });
  });

  r.post('/purchase-orders/:id/lines', partsMgr, (req, res) => {
    const id = idParam(req);
    const po = loadPo(id);
    if (po.status !== 'draft') throw new HttpError(409, 'Only draft purchase orders can be edited');
    const l = parse(poLineInput, req.body);
    const part = db.select().from(s.parts).where(eq(s.parts.id, l.partId)).get();
    if (!part) throw notFound('Part');
    db.insert(s.purchaseOrderLines)
      .values({ purchaseOrderId: id, partId: l.partId, quantity: l.quantity, unitCostCents: l.unitCostCents ?? part.costCents })
      .run();
    res.json(loadPo(id));
  });

  r.delete('/purchase-order-lines/:id', partsMgr, (req, res) => {
    const line = db.select().from(s.purchaseOrderLines).where(eq(s.purchaseOrderLines.id, idParam(req))).get();
    if (!line) throw notFound('PO line');
    const po = loadPo(line.purchaseOrderId);
    if (po.status !== 'draft') throw new HttpError(409, 'Only draft purchase orders can be edited');
    db.delete(s.purchaseOrderLines).where(eq(s.purchaseOrderLines.id, line.id)).run();
    res.json(loadPo(po.id));
  });

  r.post('/purchase-orders/:id/status', partsMgr, (req, res) => {
    const id = idParam(req);
    const { status } = parse(z.object({ status: z.enum(['ordered', 'cancelled', 'draft']) }), req.body);
    const po = loadPo(id);
    const ok =
      (status === 'ordered' && po.status === 'draft' && po.lines.length > 0) ||
      (status === 'cancelled' && ['draft', 'ordered'].includes(po.status)) ||
      (status === 'draft' && po.status === 'ordered');
    if (!ok) throw badRequest(`Cannot change a ${po.status} PO to ${status}`);
    db.update(s.purchaseOrders)
      .set({ status, ...(status === 'ordered' ? { orderedAt: nowIso() } : {}) })
      .where(eq(s.purchaseOrders.id, id))
      .run();
    res.json(loadPo(id));
  });

  /** Receive quantities against PO lines; adds stock and updates part cost to the latest received cost. */
  r.post('/purchase-orders/:id/receive', partsMgr, (req, res) => {
    const id = idParam(req);
    const body = parse(z.object({ lines: z.array(z.object({ lineId: z.number().int(), qty: z.coerce.number().min(0) })) }), req.body);
    const po = loadPo(id);
    if (!['ordered', 'partial'].includes(po.status)) throw new HttpError(409, 'Mark the PO as ordered before receiving');
    db.transaction((tx) => {
      for (const rcv of body.lines) {
        const line = po.lines.find((l) => l.id === rcv.lineId);
        if (!line || !rcv.qty) continue;
        const qty = Math.min(rcv.qty, line.quantity - line.receivedQty);
        if (qty <= 0) continue;
        tx.update(s.purchaseOrderLines).set({ receivedQty: line.receivedQty + qty }).where(eq(s.purchaseOrderLines.id, line.id)).run();
        moveStock(db, line.partId, qty, 'purchase_order', { purchaseOrderId: id, userId: req.user!.id });
        tx.update(s.parts).set({ costCents: line.unitCostCents }).where(eq(s.parts.id, line.partId)).run();
      }
      const after = tx.select().from(s.purchaseOrderLines).where(eq(s.purchaseOrderLines.purchaseOrderId, id)).all();
      const complete = after.every((l) => l.receivedQty >= l.quantity);
      const any = after.some((l) => l.receivedQty > 0);
      tx.update(s.purchaseOrders)
        .set({ status: complete ? 'received' : any ? 'partial' : po.status, ...(complete ? { receivedAt: nowIso() } : {}) })
        .where(eq(s.purchaseOrders.id, id))
        .run();
    });
    res.json(loadPo(id));
  });

  return r;
}

