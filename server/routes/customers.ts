import { and, desc, eq, like, or } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { pmDue } from '../../shared/calc';
import { PAYMENT_TERMS, UNIT_TYPES } from '../../shared/constants';
import { requireRole } from '../auth';
import type { DB } from '../db/client';
import * as s from '../db/schema';
import { idParam, notFound, parse, zOptNum, zOptStr } from '../http';

const customerInput = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  accountNumber: zOptStr,
  phone: zOptStr,
  email: zOptStr,
  billingAddress: zOptStr,
  billingCity: zOptStr,
  billingState: zOptStr,
  billingZip: zOptStr,
  paymentTerms: z.enum(PAYMENT_TERMS).default('due_on_receipt'),
  taxExempt: z.boolean().default(false),
  laborRateCents: zOptNum,
  partsMarkupPct: zOptNum,
  requiresPo: z.boolean().default(false),
  notes: zOptStr,
});

const contactInput = z.object({
  name: z.string().trim().min(1),
  title: zOptStr,
  phone: zOptStr,
  email: zOptStr,
  isPrimary: z.boolean().default(false),
  canAuthorize: z.boolean().default(true),
});

const unitInput = z.object({
  customerId: z.number().int(),
  unitNumber: z.string().trim().min(1, 'Unit number is required'),
  vin: z
    .string()
    .trim()
    .toUpperCase()
    .nullish()
    .transform((v) => v || null)
    .refine((v) => !v || /^[A-HJ-NPR-Z0-9]{11,17}$/.test(v), 'VIN must be 11–17 characters (no I, O or Q)'),
  year: zOptNum,
  make: zOptStr,
  model: zOptStr,
  type: z.enum(UNIT_TYPES).default('tractor'),
  licensePlate: zOptStr,
  engine: zOptStr,
  mileage: zOptNum,
  engineHours: zOptNum,
  notes: zOptStr,
  active: z.boolean().default(true),
});

const pmInput = z
  .object({
    name: z.string().trim().min(1),
    intervalDays: zOptNum,
    intervalMiles: zOptNum,
    intervalHours: zOptNum,
    lastDoneAt: zOptStr,
    lastDoneMiles: zOptNum,
    lastDoneHours: zOptNum,
    notes: zOptStr,
    active: z.boolean().default(true),
  })
  .refine((v) => v.intervalDays || v.intervalMiles || v.intervalHours, 'Set at least one interval (days, miles or hours)');

const writers = requireRole('service_writer');

export function customerRoutes(db: DB) {
  const r = Router();

  r.get('/customers', (req, res) => {
    const q = String(req.query.q ?? '').trim();
    const rows = db.$client
      .prepare(
        `SELECT c.*,
           (SELECT COUNT(*) FROM units u WHERE u.customer_id = c.id AND u.active = 1) AS unit_count,
           (SELECT COUNT(*) FROM work_orders w WHERE w.customer_id = c.id AND w.status != 'invoiced') AS open_wo_count,
           (SELECT COALESCE(SUM(i.total_cents - COALESCE((SELECT SUM(p.amount_cents) FROM payments p WHERE p.invoice_id = i.id),0)),0)
              FROM invoices i WHERE i.customer_id = c.id AND i.voided = 0) AS balance_cents
         FROM customers c
         WHERE (? = '' OR c.name LIKE ? OR c.account_number LIKE ? OR c.phone LIKE ?)
         ORDER BY c.name`,
      )
      .all(q, `%${q}%`, `%${q}%`, `%${q}%`) as Record<string, unknown>[];
    res.json(
      rows.map((c) => ({
        id: c.id,
        name: c.name,
        accountNumber: c.account_number,
        phone: c.phone,
        email: c.email,
        billingCity: c.billing_city,
        billingState: c.billing_state,
        paymentTerms: c.payment_terms,
        unitCount: c.unit_count,
        openWorkOrders: c.open_wo_count,
        balanceCents: c.balance_cents,
      })),
    );
  });

  r.get('/customers/:id', (req, res) => {
    const id = idParam(req);
    const customer = db.select().from(s.customers).where(eq(s.customers.id, id)).get();
    if (!customer) throw notFound('Customer');
    const contacts = db.select().from(s.contacts).where(eq(s.contacts.customerId, id)).orderBy(desc(s.contacts.isPrimary)).all();
    const units = db.select().from(s.units).where(eq(s.units.customerId, id)).orderBy(s.units.unitNumber).all();
    const workOrders = db
      .select({
        id: s.workOrders.id,
        number: s.workOrders.number,
        status: s.workOrders.status,
        summary: s.workOrders.summary,
        createdAt: s.workOrders.createdAt,
        unitNumber: s.units.unitNumber,
      })
      .from(s.workOrders)
      .innerJoin(s.units, eq(s.units.id, s.workOrders.unitId))
      .where(eq(s.workOrders.customerId, id))
      .orderBy(desc(s.workOrders.id))
      .limit(50)
      .all();
    const invoices = db.$client
      .prepare(
        `SELECT i.id, i.number, i.issued_at AS issuedAt, i.due_at AS dueAt, i.total_cents AS totalCents, i.voided,
           i.total_cents - COALESCE((SELECT SUM(amount_cents) FROM payments p WHERE p.invoice_id = i.id),0) AS balanceCents
         FROM invoices i WHERE i.customer_id = ? ORDER BY i.id DESC LIMIT 50`,
      )
      .all(id);
    res.json({ ...customer, contacts, units, workOrders, invoices });
  });

  r.post('/customers', writers, (req, res) => {
    const body = parse(customerInput, req.body);
    res.status(201).json(db.insert(s.customers).values(body).returning().get());
  });

  r.put('/customers/:id', writers, (req, res) => {
    const body = parse(customerInput, req.body);
    const row = db.update(s.customers).set(body).where(eq(s.customers.id, idParam(req))).returning().get();
    if (!row) throw notFound('Customer');
    res.json(row);
  });

  /* Contacts */
  r.post('/customers/:id/contacts', writers, (req, res) => {
    const customerId = idParam(req);
    const body = parse(contactInput, req.body);
    if (body.isPrimary) db.update(s.contacts).set({ isPrimary: false }).where(eq(s.contacts.customerId, customerId)).run();
    res.status(201).json(db.insert(s.contacts).values({ ...body, customerId }).returning().get());
  });

  r.put('/contacts/:id', writers, (req, res) => {
    const id = idParam(req);
    const body = parse(contactInput, req.body);
    const existing = db.select().from(s.contacts).where(eq(s.contacts.id, id)).get();
    if (!existing) throw notFound('Contact');
    if (body.isPrimary)
      db.update(s.contacts).set({ isPrimary: false }).where(eq(s.contacts.customerId, existing.customerId)).run();
    res.json(db.update(s.contacts).set(body).where(eq(s.contacts.id, id)).returning().get());
  });

  r.delete('/contacts/:id', writers, (req, res) => {
    db.delete(s.contacts).where(eq(s.contacts.id, idParam(req))).run();
    res.json({ ok: true });
  });

  /* Units */
  r.get('/units', (req, res) => {
    const q = String(req.query.q ?? '').trim();
    const customerId = req.query.customerId ? Number(req.query.customerId) : null;
    const conds = [];
    if (q)
      conds.push(
        or(
          like(s.units.unitNumber, `%${q}%`),
          like(s.units.vin, `%${q}%`),
          like(s.units.make, `%${q}%`),
          like(s.units.model, `%${q}%`),
          like(s.customers.name, `%${q}%`),
        ),
      );
    if (customerId) conds.push(eq(s.units.customerId, customerId));
    const rows = db
      .select({
        id: s.units.id,
        unitNumber: s.units.unitNumber,
        vin: s.units.vin,
        year: s.units.year,
        make: s.units.make,
        model: s.units.model,
        type: s.units.type,
        mileage: s.units.mileage,
        engineHours: s.units.engineHours,
        active: s.units.active,
        customerId: s.units.customerId,
        customerName: s.customers.name,
      })
      .from(s.units)
      .innerJoin(s.customers, eq(s.customers.id, s.units.customerId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(s.customers.name, s.units.unitNumber)
      .all();
    res.json(rows);
  });

  r.get('/units/:id', (req, res) => {
    const id = idParam(req);
    const unit = db.select().from(s.units).where(eq(s.units.id, id)).get();
    if (!unit) throw notFound('Unit');
    const customer = db.select({ id: s.customers.id, name: s.customers.name }).from(s.customers).where(eq(s.customers.id, unit.customerId)).get();
    const pm = db
      .select()
      .from(s.pmSchedules)
      .where(eq(s.pmSchedules.unitId, id))
      .all()
      .map((p) => ({ ...p, due: pmDue(p, unit) }));
    const history = db.$client
      .prepare(
        `SELECT w.id, w.number, w.status, w.summary, w.created_at AS createdAt, w.mileage_in AS mileageIn,
           (SELECT GROUP_CONCAT(title, ' · ') FROM work_order_lines l WHERE l.work_order_id = w.id AND l.status != 'declined') AS jobs
         FROM work_orders w WHERE w.unit_id = ? ORDER BY w.id DESC`,
      )
      .all(id);
    res.json({ ...unit, customer, pmSchedules: pm, history });
  });

  r.post('/units', writers, (req, res) => {
    const body = parse(unitInput, req.body);
    res.status(201).json(db.insert(s.units).values(body).returning().get());
  });

  r.put('/units/:id', writers, (req, res) => {
    const body = parse(unitInput, req.body);
    const row = db.update(s.units).set(body).where(eq(s.units.id, idParam(req))).returning().get();
    if (!row) throw notFound('Unit');
    res.json(row);
  });

  /* Preventive maintenance */
  r.post('/units/:id/pm', writers, (req, res) => {
    const unitId = idParam(req);
    const body = parse(pmInput, req.body);
    res.status(201).json(db.insert(s.pmSchedules).values({ ...body, unitId }).returning().get());
  });

  r.put('/pm/:id', writers, (req, res) => {
    const body = parse(pmInput, req.body);
    const row = db.update(s.pmSchedules).set(body).where(eq(s.pmSchedules.id, idParam(req))).returning().get();
    if (!row) throw notFound('PM schedule');
    res.json(row);
  });

  r.delete('/pm/:id', writers, (req, res) => {
    db.delete(s.pmSchedules).where(eq(s.pmSchedules.id, idParam(req))).run();
    res.json({ ok: true });
  });

  /** All PM schedules across the fleet with due status, most urgent first. */
  r.get('/pm', (_req, res) => {
    const rows = db
      .select({
        pm: s.pmSchedules,
        unitNumber: s.units.unitNumber,
        mileage: s.units.mileage,
        engineHours: s.units.engineHours,
        make: s.units.make,
        model: s.units.model,
        year: s.units.year,
        customerId: s.customers.id,
        customerName: s.customers.name,
      })
      .from(s.pmSchedules)
      .innerJoin(s.units, eq(s.units.id, s.pmSchedules.unitId))
      .innerJoin(s.customers, eq(s.customers.id, s.units.customerId))
      .where(and(eq(s.pmSchedules.active, true), eq(s.units.active, true)))
      .all();
    // Is there an open (not yet invoiced) work order line already handling this PM?
    const scheduled = new Set(
      (
        db.$client
          .prepare(
            `SELECT l.pm_schedule_id AS id FROM work_order_lines l JOIN work_orders w ON w.id = l.work_order_id
             WHERE l.pm_schedule_id IS NOT NULL AND w.status NOT IN ('complete','invoiced') AND l.status != 'declined'`,
          )
          .all() as { id: number }[]
      ).map((x) => x.id),
    );
    const rank = { overdue: 0, due_soon: 1, ok: 2 } as const;
    const out = rows
      .map((r0) => ({
        ...r0.pm,
        unitNumber: r0.unitNumber,
        unitLabel: [r0.year, r0.make, r0.model].filter(Boolean).join(' '),
        mileage: r0.mileage,
        engineHours: r0.engineHours,
        customerId: r0.customerId,
        customerName: r0.customerName,
        onOpenWorkOrder: scheduled.has(r0.pm.id),
        due: pmDue(r0.pm, { mileage: r0.mileage, engineHours: r0.engineHours }),
      }))
      .sort((a, b) => rank[a.due.status] - rank[b.due.status] || (a.due.daysRemaining ?? 9e9) - (b.due.daysRemaining ?? 9e9));
    res.json(out);
  });

  return r;
}

