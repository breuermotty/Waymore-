import { and, eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { efficiencyPct, pmDue } from '../../shared/calc';
import { INSPECTION_RESULTS, PAYMENT_METHODS } from '../../shared/constants';
import { hasRole, requireRole } from '../auth';
import type { DB } from '../db/client';
import * as s from '../db/schema';
import { HttpError, badRequest, idParam, notFound, parse, zOptStr } from '../http';
import { getSettings, invoiceWithBalance, loadWorkOrder, nowIso } from '../services/core';
import { applyAuthorization } from './workOrders';

const writers = requireRole('service_writer');

/* ============================== Inspections ============================== */

const sectionsSchema = z.array(z.object({ section: z.string().min(1), items: z.array(z.string().min(1)).min(1) })).min(1);

export function inspectionRoutes(db: DB) {
  const r = Router();

  r.get('/inspection-templates', (_req, res) => {
    res.json(db.select().from(s.inspectionTemplates).all().map((t) => ({ ...t, sections: JSON.parse(t.sections) })));
  });

  r.post('/inspection-templates', requireRole(), (req, res) => {
    const body = parse(z.object({ name: z.string().trim().min(1), description: zOptStr, sections: sectionsSchema }), req.body);
    const row = db.insert(s.inspectionTemplates).values({ ...body, sections: JSON.stringify(body.sections) }).returning().get();
    res.status(201).json({ ...row, sections: body.sections });
  });

  r.post('/work-orders/:id/inspections', (req, res) => {
    const workOrderId = idParam(req);
    const { templateId } = parse(z.object({ templateId: z.number().int() }), req.body);
    const wo = db.select().from(s.workOrders).where(eq(s.workOrders.id, workOrderId)).get();
    if (!wo) throw notFound('Work order');
    const row = db
      .insert(s.inspections)
      .values({ workOrderId, templateId, technicianId: req.user!.id, mileage: wo.mileageIn })
      .returning()
      .get();
    res.status(201).json(row);
  });

  const load = (id: number) => {
    const i = db.select().from(s.inspections).where(eq(s.inspections.id, id)).get();
    if (!i) throw notFound('Inspection');
    const t = db.select().from(s.inspectionTemplates).where(eq(s.inspectionTemplates.id, i.templateId)).get()!;
    const wo = db.select().from(s.workOrders).where(eq(s.workOrders.id, i.workOrderId)).get()!;
    const unit = db.select().from(s.units).where(eq(s.units.id, wo.unitId)).get()!;
    const customer = db.select({ name: s.customers.name }).from(s.customers).where(eq(s.customers.id, wo.customerId)).get()!;
    const tech = i.technicianId ? db.select({ name: s.users.name }).from(s.users).where(eq(s.users.id, i.technicianId)).get() : null;
    return {
      ...i,
      results: JSON.parse(i.results),
      template: { ...t, sections: JSON.parse(t.sections) as { section: string; items: string[] }[] },
      workOrder: { id: wo.id, number: wo.number, status: wo.status },
      unit,
      customerName: customer.name,
      technicianName: tech?.name ?? null,
    };
  };

  r.get('/inspections/:id', (req, res) => {
    res.json(load(idParam(req)));
  });

  r.put('/inspections/:id', (req, res) => {
    const id = idParam(req);
    const body = parse(
      z.object({
        results: z.record(z.string(), z.object({ result: z.enum(INSPECTION_RESULTS), note: z.string().optional() })),
        mileage: z.number().int().nullish(),
        complete: z.boolean().optional(),
      }),
      req.body,
    );
    const insp = load(id);
    if (insp.status === 'complete' && !hasRole(req, 'service_writer')) throw new HttpError(409, 'Inspection is already complete');
    if (body.complete) {
      const total = insp.template.sections.reduce((n, sec) => n + sec.items.length, 0);
      if (Object.keys(body.results).length < total) throw badRequest(`All ${total} items must be checked before completing`);
      const failsWithoutNotes = Object.entries(body.results).filter(([, v]) => v.result === 'fail' && !v.note?.trim());
      if (failsWithoutNotes.length) throw badRequest('Add a note to every failed item');
    }
    db.update(s.inspections)
      .set({
        results: JSON.stringify(body.results),
        mileage: body.mileage ?? insp.mileage,
        ...(body.complete ? { status: 'complete' as const, completedAt: nowIso() } : {}),
      })
      .where(eq(s.inspections.id, id))
      .run();
    res.json(load(id));
  });

  return r;
}

/* =============================== Invoices =============================== */

export function invoiceRoutes(db: DB) {
  const r = Router();

  r.get('/invoices', writers, (req, res) => {
    const status = String(req.query.status ?? '');
    const rows = db.$client
      .prepare(
        `SELECT i.id, i.number, i.issued_at AS issuedAt, i.due_at AS dueAt, i.total_cents AS totalCents, i.voided,
            c.id AS customerId, c.name AS customerName, w.id AS workOrderId, w.number AS workOrderNumber, u.unit_number AS unitNumber,
            COALESCE((SELECT SUM(amount_cents) FROM payments p WHERE p.invoice_id = i.id),0) AS paidCents
         FROM invoices i JOIN customers c ON c.id = i.customer_id JOIN work_orders w ON w.id = i.work_order_id JOIN units u ON u.id = w.unit_id
         ORDER BY i.id DESC LIMIT 1000`,
      )
      .all() as any[];
    const today = new Date().toISOString();
    const out = rows.map((i) => {
      const balanceCents = i.totalCents - i.paidCents;
      const st = i.voided ? 'void' : balanceCents <= 0 ? 'paid' : i.paidCents > 0 ? 'partial' : 'unpaid';
      return { ...i, voided: !!i.voided, balanceCents, status: st, overdue: !i.voided && balanceCents > 0 && i.dueAt < today };
    });
    res.json(status ? out.filter((i) => (status === 'open' ? ['unpaid', 'partial'].includes(i.status) : i.status === status)) : out);
  });

  r.get('/invoices/:id', writers, (req, res) => {
    const inv = invoiceWithBalance(db, idParam(req));
    const wo = loadWorkOrder(db, inv.workOrderId);
    const customerNotes = db
      .select({ body: s.notes.body })
      .from(s.notes)
      .where(and(eq(s.notes.workOrderId, wo.id), eq(s.notes.customerVisible, true)))
      .all();
    res.json({ ...inv, workOrder: { ...wo, lines: wo.lines.filter((l) => l.status === 'approved') }, customerNotes, shop: getSettings(db) });
  });

  r.post('/invoices/:id/payments', writers, (req, res) => {
    const id = idParam(req);
    const inv = invoiceWithBalance(db, id);
    if (inv.voided) throw new HttpError(409, 'Cannot record payments on a voided invoice');
    const body = parse(
      z.object({
        amountCents: z.coerce.number().int().positive(),
        method: z.enum(PAYMENT_METHODS),
        reference: zOptStr,
        receivedAt: z.string().optional(),
      }),
      req.body,
    );
    if (body.amountCents > inv.balanceCents) throw badRequest('Payment exceeds the balance due');
    db.insert(s.payments)
      .values({ ...body, receivedAt: body.receivedAt || nowIso(), invoiceId: id, userId: req.user!.id })
      .run();
    res.status(201).json(invoiceWithBalance(db, id));
  });

  r.delete('/payments/:id', requireRole(), (req, res) => {
    const p = db.select().from(s.payments).where(eq(s.payments.id, idParam(req))).get();
    if (!p) throw notFound('Payment');
    db.delete(s.payments).where(eq(s.payments.id, p.id)).run();
    res.json(invoiceWithBalance(db, p.invoiceId));
  });

  /** Void an invoice and unlock its work order (back to complete). */
  r.post('/invoices/:id/void', requireRole(), (req, res) => {
    const inv = invoiceWithBalance(db, idParam(req));
    if (inv.voided) throw badRequest('Invoice is already void');
    if (inv.paidCents > 0) throw new HttpError(409, 'Remove payments before voiding this invoice');
    db.transaction((tx) => {
      tx.update(s.invoices).set({ voided: true }).where(eq(s.invoices.id, inv.id)).run();
      tx.update(s.workOrders).set({ status: 'complete', invoicedAt: null }).where(eq(s.workOrders.id, inv.workOrderId)).run();
    });
    res.json(invoiceWithBalance(db, inv.id));
  });

  return r;
}

/* ============================ Dashboard & reports ============================ */

function range(req: { query: Record<string, unknown> }) {
  const to = String(req.query.to || new Date().toISOString().slice(0, 10));
  const fromDefault = new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);
  const from = String(req.query.from || fromDefault);
  // inclusive day range as ISO strings
  return { from, to, fromIso: `${from}T00:00:00.000Z`, toIso: `${to}T23:59:59.999Z` };
}

export function reportRoutes(db: DB) {
  const r = Router();
  const q = <T = any>(sql: string, ...p: unknown[]) => db.$client.prepare(sql).all(...p) as T[];
  const one = <T = any>(sql: string, ...p: unknown[]) => db.$client.prepare(sql).get(...p) as T;

  r.get('/dashboard', (_req, res) => {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const byStatus = Object.fromEntries(q(`SELECT status, COUNT(*) AS n FROM work_orders GROUP BY status`).map((x) => [x.status, x.n]));
    const revenueMonth = one(`SELECT COALESCE(SUM(total_cents - tax_cents),0) AS v, COUNT(*) AS n FROM invoices WHERE voided = 0 AND issued_at >= ?`, monthStart);
    const ar = one(
      `SELECT COALESCE(SUM(i.total_cents - COALESCE((SELECT SUM(amount_cents) FROM payments p WHERE p.invoice_id = i.id),0)),0) AS v,
              COALESCE(SUM(CASE WHEN i.due_at < ? THEN i.total_cents - COALESCE((SELECT SUM(amount_cents) FROM payments p WHERE p.invoice_id = i.id),0) ELSE 0 END),0) AS overdue
       FROM invoices i WHERE i.voided = 0`,
      now.toISOString(),
    );
    const lowStock = one(`SELECT COUNT(*) AS n FROM parts WHERE active = 1 AND qty_on_hand <= reorder_point`).n;
    const clockedIn = q(
      `SELECT u.name, t.started_at AS startedAt, w.number, w.id AS workOrderId, l.title FROM time_entries t
       JOIN users u ON u.id = t.technician_id JOIN work_order_lines l ON l.id = t.line_id JOIN work_orders w ON w.id = l.work_order_id
       WHERE t.ended_at IS NULL ORDER BY t.started_at`,
    );
    const pmRows = q(
      `SELECT p.*, u.mileage, u.engine_hours FROM pm_schedules p JOIN units u ON u.id = p.unit_id WHERE p.active = 1 AND u.active = 1`,
    );
    const pm = { overdue: 0, due_soon: 0 };
    for (const p of pmRows) {
      const d = pmDue(
        {
          intervalDays: p.interval_days,
          intervalMiles: p.interval_miles,
          intervalHours: p.interval_hours,
          lastDoneAt: p.last_done_at,
          lastDoneMiles: p.last_done_miles,
          lastDoneHours: p.last_done_hours,
        },
        { mileage: p.mileage, engineHours: p.engine_hours },
      );
      if (d.status !== 'ok') pm[d.status]++;
    }
    const months: { month: string; revenueCents: number; laborCents: number; partsCents: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 1));
      const row = one(
        `SELECT COALESCE(SUM(total_cents - tax_cents),0) AS rev, COALESCE(SUM(labor_cents),0) AS labor, COALESCE(SUM(parts_cents),0) AS parts
         FROM invoices WHERE voided = 0 AND issued_at >= ? AND issued_at < ?`,
        start.toISOString(),
        end.toISOString(),
      );
      months.push({ month: start.toISOString().slice(0, 7), revenueCents: row.rev, laborCents: row.labor, partsCents: row.parts });
    }
    const awaitingAuth = one(`SELECT COUNT(*) AS n FROM work_orders WHERE status = 'estimate' AND auth_sent_at IS NOT NULL`).n;
    const recent = q(
      `SELECT w.id, w.number, w.status, w.priority, w.summary, c.name AS customerName, u.unit_number AS unitNumber, w.promised_at AS promisedAt
       FROM work_orders w JOIN customers c ON c.id = w.customer_id JOIN units u ON u.id = w.unit_id
       WHERE w.status NOT IN ('invoiced') ORDER BY CASE w.priority WHEN 'down' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, w.id DESC LIMIT 8`,
    );
    res.json({
      byStatus,
      openCount: Object.entries(byStatus).filter(([k]) => k !== 'invoiced').reduce((a, [, v]) => a + (v as number), 0),
      revenueMonthCents: revenueMonth.v,
      invoicesMonth: revenueMonth.n,
      arCents: ar.v,
      arOverdueCents: ar.overdue,
      lowStock,
      pm,
      clockedIn,
      months,
      awaitingAuth,
      recent,
    });
  });

  /** Technician productivity: clocked vs. billed hours and efficiency. */
  r.get('/reports/technicians', writers, (req, res) => {
    const { from, to, fromIso, toIso } = range(req);
    const techs = q(`SELECT id, name, active FROM users WHERE role = 'technician' ORDER BY name`);
    const out = techs.map((t) => {
      const clocked = one(
        `SELECT COALESCE(SUM((julianday(COALESCE(ended_at, strftime('%Y-%m-%dT%H:%M:%fZ','now'))) - julianday(started_at)) * 24),0) AS h
         FROM time_entries WHERE technician_id = ? AND started_at BETWEEN ? AND ?`,
        t.id,
        fromIso,
        toIso,
      ).h as number;
      // Completed jobs: lines on work orders completed in range, assigned to this tech.
      const jobs = q(
        `SELECT l.id, l.labor_hours AS billed, ROUND(l.labor_hours * l.labor_rate_cents) AS laborCents,
           (SELECT COALESCE(SUM((julianday(t.ended_at) - julianday(t.started_at)) * 24),0) FROM time_entries t
              WHERE t.line_id = l.id AND t.technician_id = ? AND t.ended_at IS NOT NULL) AS actual
         FROM work_order_lines l JOIN work_orders w ON w.id = l.work_order_id
         WHERE l.technician_id = ? AND l.status = 'approved' AND w.completed_at BETWEEN ? AND ?`,
        t.id,
        t.id,
        fromIso,
        toIso,
      );
      const billed = jobs.reduce((a, j) => a + j.billed, 0);
      const actualOnJobs = jobs.reduce((a, j) => a + j.actual, 0);
      const round2 = (n: number) => Math.round(n * 100) / 100;
      return {
        id: t.id,
        name: t.name,
        clockedHours: round2(clocked),
        jobsCompleted: jobs.length,
        billedHours: round2(billed),
        actualHoursOnCompleted: round2(actualOnJobs),
        efficiencyPct: efficiencyPct(billed, actualOnJobs),
        laborSoldCents: jobs.reduce((a, j) => a + j.laborCents, 0),
      };
    });
    res.json({ from, to, rows: out });
  });

  /** Revenue by month with gross profit on parts. */
  r.get('/reports/revenue', writers, (req, res) => {
    const { from, to, fromIso, toIso } = range(req);
    const rows = q(
      `SELECT substr(issued_at, 1, 7) AS month, COUNT(*) AS invoices,
         SUM(labor_cents) AS laborCents, SUM(parts_cents) AS partsCents, SUM(parts_cost_cents) AS partsCostCents,
         SUM(shop_supplies_cents) AS shopSuppliesCents, SUM(tax_cents) AS taxCents, SUM(total_cents) AS totalCents
       FROM invoices WHERE voided = 0 AND issued_at BETWEEN ? AND ? GROUP BY month ORDER BY month`,
      fromIso,
      toIso,
    );
    const byCustomer = q(
      `SELECT c.id, c.name, COUNT(*) AS invoices, SUM(i.total_cents - i.tax_cents) AS revenueCents
       FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.voided = 0 AND i.issued_at BETWEEN ? AND ?
       GROUP BY c.id ORDER BY revenueCents DESC LIMIT 15`,
      fromIso,
      toIso,
    );
    res.json({ from, to, rows, byCustomer });
  });

  /** Parts usage on work orders created in range. */
  r.get('/reports/parts-usage', requireRole('service_writer', 'parts_manager'), (req, res) => {
    const { from, to, fromIso, toIso } = range(req);
    const rows = q(
      `SELECT p.part_number AS partNumber, MAX(p.description) AS description, SUM(p.quantity) AS qty,
         SUM(ROUND(p.quantity * p.unit_price_cents)) AS revenueCents, SUM(ROUND(p.quantity * p.unit_cost_cents)) AS costCents,
         COUNT(DISTINCT w.id) AS workOrders
       FROM work_order_parts p JOIN work_order_lines l ON l.id = p.line_id JOIN work_orders w ON w.id = l.work_order_id
       WHERE l.status != 'declined' AND w.created_at BETWEEN ? AND ?
       GROUP BY p.part_number ORDER BY revenueCents DESC LIMIT 200`,
      fromIso,
      toIso,
    );
    res.json({ from, to, rows });
  });

  /** Accounts receivable aging. */
  r.get('/reports/ar-aging', writers, (_req, res) => {
    const rows = q(
      `SELECT i.id, i.number, i.due_at AS dueAt, c.id AS customerId, c.name AS customerName,
         i.total_cents - COALESCE((SELECT SUM(amount_cents) FROM payments p WHERE p.invoice_id = i.id),0) AS balanceCents
       FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.voided = 0`,
    ).filter((x) => x.balanceCents > 0);
    const today = Date.now();
    const buckets = ['current', '1-30', '31-60', '61-90', '90+'] as const;
    const byCust = new Map<number, { customerId: number; customerName: string } & Record<(typeof buckets)[number] | 'total', number>>();
    for (const i of rows) {
      const days = Math.floor((today - new Date(i.dueAt).getTime()) / 86_400_000);
      const b = days <= 0 ? 'current' : days <= 30 ? '1-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : '90+';
      const c = byCust.get(i.customerId) ?? { customerId: i.customerId, customerName: i.customerName, current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0, total: 0 };
      c[b] += i.balanceCents;
      c.total += i.balanceCents;
      byCust.set(i.customerId, c);
    }
    res.json({ buckets, rows: [...byCust.values()].sort((a, b) => b.total - a.total) });
  });

  return r;
}

/* ===================== Public customer authorization ===================== */

export function publicRoutes(db: DB) {
  const r = Router();
  const byToken = (token: string) => {
    if (!token || token.length < 16) throw notFound('Estimate');
    const wo = db.select().from(s.workOrders).where(eq(s.workOrders.authToken, token)).get();
    if (!wo) throw notFound('Estimate');
    return wo;
  };

  r.get('/public/authorize/:token', (req, res) => {
    const wo = loadWorkOrder(db, byToken(String(req.params.token)).id);
    const shop = getSettings(db);
    res.json({
      shop: { name: shop.name, phone: shop.phone, email: shop.email, address: shop.address, city: shop.city, state: shop.state },
      number: wo.number,
      status: wo.status,
      createdAt: wo.createdAt,
      authorizedAt: wo.authorizedAt,
      authorizedBy: wo.authorizedBy,
      locked: wo.status === 'invoiced',
      customer: { name: wo.customer.name },
      unit: { unitNumber: wo.unit.unitNumber, year: wo.unit.year, make: wo.unit.make, model: wo.unit.model, vin: wo.unit.vin },
      lines: wo.lines.map((l) => ({
        id: l.id,
        title: l.title,
        complaint: l.complaint,
        cause: l.cause,
        correction: l.correction,
        status: l.status,
        laborCents: l.laborCents,
        partsCents: l.partsCents,
        parts: l.parts.map((p) => ({ description: p.description, quantity: p.quantity, extCents: p.extCents })),
      })),
      estimateTotals: wo.estimateTotals,
      approvedTotals: wo.approvedTotals,
    });
  });

  r.post('/public/authorize/:token', (req, res) => {
    const wo = byToken(String(req.params.token));
    const body = parse(
      z.object({
        name: z.string().trim().min(2, 'Please enter your name'),
        decisions: z.record(z.string(), z.enum(['approved', 'declined'])),
      }),
      req.body,
    );
    if (!['estimate', 'approved', 'in_progress', 'waiting_parts'].includes(wo.status)) {
      throw new HttpError(409, 'This estimate can no longer be changed. Please call the shop.');
    }
    applyAuthorization(db, wo.id, body.decisions, `${body.name} (online)`);
    db.insert(s.notes)
      .values({
        workOrderId: wo.id,
        body: `Customer ${body.name} responded online: ${Object.values(body.decisions).filter((d) => d === 'approved').length} approved, ${
          Object.values(body.decisions).filter((d) => d === 'declined').length
        } declined.`,
      })
      .run();
    res.json({ ok: true });
  });

  return r;
}

