import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { and, asc, desc, eq, isNull, max } from 'drizzle-orm';
import { Router, type Request } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { dueDateFor } from '../../shared/calc';
import { WO_STATUSES, canTransition, type WorkOrderStatus } from '../../shared/constants';
import { hasRole, requireRole } from '../auth';
import { config } from '../config';
import type { DB } from '../db/client';
import * as s from '../db/schema';
import { HttpError, badRequest, idParam, notFound, parse, zOptNum, zOptStr } from '../http';
import {
  closeOpenEntriesForTech,
  closeOpenEntriesForWorkOrder,
  getSettings,
  loadWorkOrder,
  moveStock,
  nextInvoiceNumber,
  nextWorkOrderNumber,
  nowIso,
  pricePartForCustomer,
} from '../services/core';

const writers = requireRole('service_writer');
const partsPeople = requireRole('service_writer', 'parts_manager');

/** Line fields without defaults, so partial updates never overwrite unspecified fields. */
const lineFields = z.object({
  title: z.string().trim().min(1, 'Job title is required'),
  complaint: zOptStr,
  cause: zOptStr,
  correction: zOptStr,
  laborHours: z.coerce.number().min(0).max(500),
  laborRateCents: z.coerce.number().int().min(0).optional(),
  technicianId: zOptNum,
  pmScheduleId: zOptNum,
  status: z.enum(['pending', 'approved', 'declined']).optional(),
  done: z.boolean().optional(),
});
const lineInput = lineFields.extend({ laborHours: z.coerce.number().min(0).max(500).default(0) });

const woInput = z.object({
  customerId: z.number().int(),
  unitId: z.number().int(),
  summary: zOptStr,
  priority: z.enum(['low', 'normal', 'high', 'down']).default('normal'),
  poNumber: zOptStr,
  mileageIn: zOptNum,
  engineHoursIn: zOptNum,
  promisedAt: zOptStr,
  serviceWriterId: zOptNum,
  lines: z.array(lineInput).optional(),
});

const partLineInput = z.object({
  partId: zOptNum,
  partNumber: z.string().trim().optional(),
  description: z.string().trim().optional(),
  quantity: z.coerce.number().positive(),
  unitCostCents: z.coerce.number().int().min(0).optional(),
  unitPriceCents: z.coerce.number().int().min(0).optional(),
  taxable: z.boolean().optional(),
});

/* ------------------------------ helpers -------------------------------- */

function getWo(db: DB, id: number) {
  const wo = db.select().from(s.workOrders).where(eq(s.workOrders.id, id)).get();
  if (!wo) throw notFound('Work order');
  return wo;
}

function assertEditable(wo: { status: WorkOrderStatus; number: string }) {
  if (wo.status === 'invoiced') throw new HttpError(409, `${wo.number} has been invoiced and is locked. Void the invoice to make changes.`);
}

function getLine(db: DB, lineId: number) {
  const line = db.select().from(s.workOrderLines).where(eq(s.workOrderLines.id, lineId)).get();
  if (!line) throw notFound('Job line');
  return { line, wo: getWo(db, line.workOrderId) };
}

function defaultLaborRate(db: DB, customerId: number) {
  const c = db.select().from(s.customers).where(eq(s.customers.id, customerId)).get();
  return c?.laborRateCents ?? getSettings(db).defaultLaborRateCents;
}

/** Apply per-line approve/decline decisions (from the customer portal or recorded by a writer). */
export function applyAuthorization(
  db: DB,
  woId: number,
  decisions: Record<string, 'approved' | 'declined'>,
  authorizedBy: string,
) {
  const wo = getWo(db, woId);
  assertEditable(wo);
  const lines = db.select().from(s.workOrderLines).where(eq(s.workOrderLines.workOrderId, woId)).all();
  db.transaction((tx) => {
    for (const l of lines) {
      const d = decisions[String(l.id)];
      if (d === 'approved' || d === 'declined') {
        tx.update(s.workOrderLines).set({ status: d }).where(eq(s.workOrderLines.id, l.id)).run();
      }
    }
    const anyApproved = lines.some((l) => (decisions[String(l.id)] ?? l.status) === 'approved');
    tx.update(s.workOrders)
      .set({
        authorizedAt: nowIso(),
        authorizedBy,
        ...(wo.status === 'estimate' && anyApproved ? { status: 'approved' as const } : {}),
      })
      .where(eq(s.workOrders.id, woId))
      .run();
  });
}

function completeWorkOrder(db: DB, woId: number) {
  const wo = getWo(db, woId);
  const unit = db.select().from(s.units).where(eq(s.units.id, wo.unitId)).get()!;
  const at = nowIso();
  closeOpenEntriesForWorkOrder(db, woId, at);
  // Mark linked PM schedules as performed.
  const pmLines = db
    .select()
    .from(s.workOrderLines)
    .where(and(eq(s.workOrderLines.workOrderId, woId), eq(s.workOrderLines.status, 'approved')))
    .all()
    .filter((l) => l.pmScheduleId);
  for (const l of pmLines) {
    db.update(s.pmSchedules)
      .set({
        lastDoneAt: at.slice(0, 10),
        lastDoneMiles: wo.mileageIn ?? unit.mileage,
        lastDoneHours: wo.engineHoursIn ?? unit.engineHours,
      })
      .where(eq(s.pmSchedules.id, l.pmScheduleId!))
      .run();
  }
  db.update(s.workOrders).set({ status: 'complete', completedAt: at }).where(eq(s.workOrders.id, woId)).run();
}

function addLine(db: DB, woId: number, customerId: number, input: z.infer<typeof lineInput>, sortOrder: number) {
  return db
    .insert(s.workOrderLines)
    .values({
      workOrderId: woId,
      sortOrder,
      title: input.title,
      complaint: input.complaint,
      cause: input.cause,
      correction: input.correction,
      laborHours: input.laborHours,
      laborRateCents: input.laborRateCents ?? defaultLaborRate(db, customerId),
      technicianId: input.technicianId ?? null,
      pmScheduleId: input.pmScheduleId ?? null,
      status: input.status ?? 'pending',
    })
    .returning()
    .get();
}

/* ------------------------------- routes -------------------------------- */

export function workOrderRoutes(db: DB) {
  const r = Router();
  fs.mkdirSync(config.uploadDir, { recursive: true });
  const upload = multer({
    storage: multer.diskStorage({
      destination: config.uploadDir,
      filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
    }),
    limits: { fileSize: 15 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => cb(null, /^(image\/|application\/pdf$|video\/)/.test(file.mimetype)),
  });

  r.get('/work-orders', (req, res) => {
    const status = String(req.query.status ?? '');
    const q = String(req.query.q ?? '').trim();
    const open = req.query.open === '1';
    const rows = db.$client
      .prepare(
        `SELECT w.id, w.number, w.status, w.priority, w.summary, w.created_at AS createdAt, w.promised_at AS promisedAt,
            w.auth_sent_at AS authSentAt, w.authorized_at AS authorizedAt,
            c.id AS customerId, c.name AS customerName, u.id AS unitId, u.unit_number AS unitNumber,
            TRIM(COALESCE(u.year,'') || ' ' || COALESCE(u.make,'') || ' ' || COALESCE(u.model,'')) AS unitLabel,
            (SELECT COUNT(*) FROM work_order_lines l WHERE l.work_order_id = w.id) AS lineCount,
            (SELECT COALESCE(SUM(ROUND(l.labor_hours * l.labor_rate_cents)),0) FROM work_order_lines l WHERE l.work_order_id = w.id AND l.status != 'declined')
             + (SELECT COALESCE(SUM(ROUND(p.quantity * p.unit_price_cents)),0) FROM work_order_parts p JOIN work_order_lines l ON l.id = p.line_id WHERE l.work_order_id = w.id AND l.status != 'declined') AS subtotalCents,
            (SELECT GROUP_CONCAT(DISTINCT us.name) FROM work_order_lines l JOIN users us ON us.id = l.technician_id WHERE l.work_order_id = w.id) AS technicians
         FROM work_orders w
         JOIN customers c ON c.id = w.customer_id
         JOIN units u ON u.id = w.unit_id
         WHERE (? = '' OR w.status = ?)
           AND (? = 0 OR w.status != 'invoiced')
           AND (? = '' OR w.number LIKE ? OR c.name LIKE ? OR u.unit_number LIKE ? OR u.vin LIKE ? OR w.summary LIKE ?)
         ORDER BY CASE w.priority WHEN 'down' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, w.id DESC
         LIMIT 500`,
      )
      .all(status, status, open ? 1 : 0, q, ...Array(5).fill(`%${q}%`));
    res.json(rows);
  });

  r.post('/work-orders', writers, (req, res) => {
    const body = parse(woInput, req.body);
    const unit = db.select().from(s.units).where(eq(s.units.id, body.unitId)).get();
    if (!unit || unit.customerId !== body.customerId) throw badRequest('Unit does not belong to that customer');
    const id = db.transaction((tx) => {
      const wo = tx
        .insert(s.workOrders)
        .values({
          number: nextWorkOrderNumber(db),
          customerId: body.customerId,
          unitId: body.unitId,
          summary: body.summary,
          priority: body.priority,
          poNumber: body.poNumber,
          mileageIn: body.mileageIn,
          engineHoursIn: body.engineHoursIn,
          promisedAt: body.promisedAt,
          serviceWriterId: body.serviceWriterId ?? req.user!.id,
        })
        .returning()
        .get();
      (body.lines ?? []).forEach((l, i) => addLine(db, wo.id, body.customerId, l, i));
      // Keep the unit's meters current.
      const meters: Partial<typeof s.units.$inferInsert> = {};
      if (body.mileageIn != null && body.mileageIn > (unit.mileage ?? 0)) meters.mileage = body.mileageIn;
      if (body.engineHoursIn != null && body.engineHoursIn > (unit.engineHours ?? 0)) meters.engineHours = body.engineHoursIn;
      if (Object.keys(meters).length) tx.update(s.units).set(meters).where(eq(s.units.id, unit.id)).run();
      return wo.id;
    });
    res.status(201).json(loadWorkOrder(db, id));
  });

  r.get('/work-orders/:id', (req, res) => {
    const id = idParam(req);
    const wo = loadWorkOrder(db, id);
    const woNotes = db
      .select({
        id: s.notes.id,
        lineId: s.notes.lineId,
        body: s.notes.body,
        customerVisible: s.notes.customerVisible,
        createdAt: s.notes.createdAt,
        userName: s.users.name,
      })
      .from(s.notes)
      .leftJoin(s.users, eq(s.users.id, s.notes.userId))
      .where(eq(s.notes.workOrderId, id))
      .orderBy(desc(s.notes.createdAt))
      .all();
    const files = db.select().from(s.attachments).where(eq(s.attachments.workOrderId, id)).orderBy(desc(s.attachments.id)).all();
    const insp = db
      .select({
        id: s.inspections.id,
        status: s.inspections.status,
        templateName: s.inspectionTemplates.name,
        technicianId: s.inspections.technicianId,
        createdAt: s.inspections.createdAt,
        completedAt: s.inspections.completedAt,
        results: s.inspections.results,
      })
      .from(s.inspections)
      .innerJoin(s.inspectionTemplates, eq(s.inspectionTemplates.id, s.inspections.templateId))
      .where(eq(s.inspections.workOrderId, id))
      .all()
      .map(({ results, ...i }) => {
        const vals = Object.values(JSON.parse(results) as Record<string, { result: string }>);
        return { ...i, failCount: vals.filter((v) => v.result === 'fail').length, checkedCount: vals.length };
      });
    res.json({ ...wo, notes: woNotes, attachments: files, inspections: insp });
  });

  r.put('/work-orders/:id', writers, (req, res) => {
    const id = idParam(req);
    const wo = getWo(db, id);
    assertEditable(wo);
    const body = parse(woInput.omit({ customerId: true, unitId: true, lines: true }), req.body);
    db.update(s.workOrders).set(body).where(eq(s.workOrders.id, id)).run();
    res.json(loadWorkOrder(db, id));
  });

  r.delete('/work-orders/:id', writers, (req, res) => {
    const id = idParam(req);
    const wo = getWo(db, id);
    if (wo.status !== 'estimate') throw new HttpError(409, 'Only estimates can be deleted');
    // Return any stocked parts to inventory.
    const used = db.$client
      .prepare(`SELECT p.part_id AS partId, p.quantity FROM work_order_parts p JOIN work_order_lines l ON l.id = p.line_id WHERE l.work_order_id = ? AND p.part_id IS NOT NULL`)
      .all(id) as { partId: number; quantity: number }[];
    db.transaction(() => {
      for (const u of used) moveStock(db, u.partId, u.quantity, 'work_order', { workOrderId: id, userId: req.user!.id, note: `${wo.number} deleted` });
      db.delete(s.workOrders).where(eq(s.workOrders.id, id)).run();
    });
    res.json({ ok: true });
  });

  r.post('/work-orders/:id/status', (req, res) => {
    const id = idParam(req);
    const { status } = parse(z.object({ status: z.enum(WO_STATUSES) }), req.body);
    const wo = getWo(db, id);
    if (status === 'invoiced') throw badRequest('Generate an invoice to mark a work order invoiced');
    if (!canTransition(wo.status, status)) throw badRequest(`Cannot move from ${wo.status} to ${status}`);
    // Technicians may only toggle between working states.
    if (!hasRole(req, 'service_writer') && !['in_progress', 'waiting_parts', 'complete'].includes(status)) {
      throw new HttpError(403, 'Only service writers can change that status');
    }
    if (status === 'approved' && wo.status === 'estimate') {
      db.update(s.workOrderLines)
        .set({ status: 'approved' })
        .where(and(eq(s.workOrderLines.workOrderId, id), eq(s.workOrderLines.status, 'pending')))
        .run();
      db.update(s.workOrders)
        .set({ status, authorizedAt: nowIso(), authorizedBy: wo.authorizedBy ?? `${req.user!.name} (recorded by shop)` })
        .where(eq(s.workOrders.id, id))
        .run();
    } else if (status === 'complete') {
      completeWorkOrder(db, id);
    } else {
      if (status === 'waiting_parts') closeOpenEntriesForWorkOrder(db, id);
      db.update(s.workOrders).set({ status, completedAt: null }).where(eq(s.workOrders.id, id)).run();
    }
    res.json(loadWorkOrder(db, id));
  });

  /* ---- Customer authorization ---- */

  r.post('/work-orders/:id/send-authorization', writers, (req, res) => {
    const id = idParam(req);
    const wo = getWo(db, id);
    assertEditable(wo);
    const token = wo.authToken ?? crypto.randomBytes(18).toString('base64url');
    db.update(s.workOrders).set({ authToken: token, authSentAt: nowIso() }).where(eq(s.workOrders.id, id)).run();
    res.json({ token, path: `/authorize/${token}` });
  });

  r.post('/work-orders/:id/authorize', writers, (req, res) => {
    const id = idParam(req);
    const body = parse(
      z.object({ decisions: z.record(z.string(), z.enum(['approved', 'declined'])), authorizedBy: z.string().trim().min(1) }),
      req.body,
    );
    applyAuthorization(db, id, body.decisions, `${body.authorizedBy} (recorded by ${req.user!.name})`);
    res.json(loadWorkOrder(db, id));
  });

  /* ---- Lines (complaint / cause / correction) ---- */

  r.post('/work-orders/:id/lines', writers, (req, res) => {
    const id = idParam(req);
    const wo = getWo(db, id);
    assertEditable(wo);
    const body = parse(lineInput, req.body);
    const maxSort = db.select({ m: max(s.workOrderLines.sortOrder) }).from(s.workOrderLines).where(eq(s.workOrderLines.workOrderId, id)).get();
    // Lines added after authorization still need approval; lines on a fresh estimate start pending.
    addLine(db, id, wo.customerId, body, (maxSort?.m ?? -1) + 1);
    res.status(201).json(loadWorkOrder(db, id));
  });

  r.put('/lines/:id', (req, res) => {
    const { line, wo } = getLine(db, idParam(req));
    assertEditable(wo);
    const body = parse(lineFields.partial(), req.body);
    let patch: Partial<typeof s.workOrderLines.$inferInsert> = body;
    if (!hasRole(req, 'service_writer')) {
      // Technicians can document their own work only.
      if (line.technicianId !== req.user!.id) throw new HttpError(403, 'This job is not assigned to you');
      patch = { cause: body.cause, correction: body.correction, done: body.done };
      for (const k of Object.keys(patch) as (keyof typeof patch)[]) if (patch[k] === undefined) delete patch[k];
    }
    db.update(s.workOrderLines).set(patch).where(eq(s.workOrderLines.id, line.id)).run();
    res.json(loadWorkOrder(db, wo.id));
  });

  r.delete('/lines/:id', writers, (req, res) => {
    const { line, wo } = getLine(db, idParam(req));
    assertEditable(wo);
    const lineParts = db.select().from(s.workOrderParts).where(eq(s.workOrderParts.lineId, line.id)).all();
    db.transaction(() => {
      for (const p of lineParts) if (p.partId) moveStock(db, p.partId, p.quantity, 'work_order', { workOrderId: wo.id, userId: req.user!.id });
      db.delete(s.workOrderLines).where(eq(s.workOrderLines.id, line.id)).run();
    });
    res.json(loadWorkOrder(db, wo.id));
  });

  /* ---- Parts on lines ---- */

  r.post('/lines/:id/parts', partsPeople, (req, res) => {
    const { line, wo } = getLine(db, idParam(req));
    assertEditable(wo);
    const body = parse(partLineInput, req.body);
    db.transaction(() => {
      if (body.partId) {
        const priced = pricePartForCustomer(db, body.partId, wo.customerId);
        db.insert(s.workOrderParts)
          .values({
            lineId: line.id,
            partId: priced.part.id,
            partNumber: priced.part.partNumber,
            description: body.description || priced.part.description,
            quantity: body.quantity,
            unitCostCents: priced.part.costCents,
            unitPriceCents: body.unitPriceCents ?? priced.priceCents,
            taxable: body.taxable ?? priced.part.taxable,
          })
          .run();
        moveStock(db, priced.part.id, -body.quantity, 'work_order', { workOrderId: wo.id, userId: req.user!.id });
      } else {
        if (!body.partNumber || !body.description) throw badRequest('Part number and description are required for non-stock parts');
        if (body.unitPriceCents == null) throw badRequest('Price is required for non-stock parts');
        db.insert(s.workOrderParts)
          .values({
            lineId: line.id,
            partNumber: body.partNumber,
            description: body.description,
            quantity: body.quantity,
            unitCostCents: body.unitCostCents ?? 0,
            unitPriceCents: body.unitPriceCents,
            taxable: body.taxable ?? true,
          })
          .run();
      }
    });
    res.status(201).json(loadWorkOrder(db, wo.id));
  });

  r.put('/wo-parts/:id', partsPeople, (req, res) => {
    const id = idParam(req);
    const p = db.select().from(s.workOrderParts).where(eq(s.workOrderParts.id, id)).get();
    if (!p) throw notFound('Part line');
    const { wo } = getLine(db, p.lineId);
    assertEditable(wo);
    const body = parse(partLineInput.partial(), req.body);
    db.transaction(() => {
      if (body.quantity != null && p.partId && body.quantity !== p.quantity) {
        moveStock(db, p.partId, p.quantity - body.quantity, 'work_order', { workOrderId: wo.id, userId: req.user!.id });
      }
      db.update(s.workOrderParts)
        .set({
          quantity: body.quantity ?? p.quantity,
          unitPriceCents: body.unitPriceCents ?? p.unitPriceCents,
          unitCostCents: body.unitCostCents ?? p.unitCostCents,
          description: body.description ?? p.description,
          taxable: body.taxable ?? p.taxable,
        })
        .where(eq(s.workOrderParts.id, id))
        .run();
    });
    res.json(loadWorkOrder(db, wo.id));
  });

  r.delete('/wo-parts/:id', partsPeople, (req, res) => {
    const id = idParam(req);
    const p = db.select().from(s.workOrderParts).where(eq(s.workOrderParts.id, id)).get();
    if (!p) throw notFound('Part line');
    const { wo } = getLine(db, p.lineId);
    assertEditable(wo);
    db.transaction(() => {
      if (p.partId) moveStock(db, p.partId, p.quantity, 'work_order', { workOrderId: wo.id, userId: req.user!.id, note: 'Returned to stock' });
      db.delete(s.workOrderParts).where(eq(s.workOrderParts.id, id)).run();
    });
    res.json(loadWorkOrder(db, wo.id));
  });

  /* ---- Labor time clock ---- */

  r.post('/lines/:id/clock-in', (req, res) => {
    const { line, wo } = getLine(db, idParam(req));
    if (!['approved', 'in_progress', 'waiting_parts'].includes(wo.status)) {
      throw new HttpError(409, `${wo.number} is not open for work (status: ${wo.status})`);
    }
    if (line.status === 'declined') throw new HttpError(409, 'This job was declined by the customer');
    const techId = req.user!.id;
    if (line.technicianId && line.technicianId !== techId && !hasRole(req, 'service_writer')) {
      throw new HttpError(403, 'This job is assigned to another technician');
    }
    const at = nowIso();
    db.transaction(() => {
      closeOpenEntriesForTech(db, techId, at); // a tech can only be on one job at a time
      if (!line.technicianId) db.update(s.workOrderLines).set({ technicianId: techId }).where(eq(s.workOrderLines.id, line.id)).run();
      db.insert(s.timeEntries).values({ lineId: line.id, technicianId: techId, startedAt: at }).run();
      if (wo.status !== 'in_progress') db.update(s.workOrders).set({ status: 'in_progress' }).where(eq(s.workOrders.id, wo.id)).run();
    });
    res.json({ ok: true, startedAt: at });
  });

  r.post('/time/clock-out', (req, res) => {
    closeOpenEntriesForTech(db, req.user!.id);
    res.json({ ok: true });
  });

  r.get('/time/current', (req, res) => {
    const row = db
      .select({
        id: s.timeEntries.id,
        startedAt: s.timeEntries.startedAt,
        lineId: s.timeEntries.lineId,
        lineTitle: s.workOrderLines.title,
        workOrderId: s.workOrders.id,
        workOrderNumber: s.workOrders.number,
      })
      .from(s.timeEntries)
      .innerJoin(s.workOrderLines, eq(s.workOrderLines.id, s.timeEntries.lineId))
      .innerJoin(s.workOrders, eq(s.workOrders.id, s.workOrderLines.workOrderId))
      .where(and(eq(s.timeEntries.technicianId, req.user!.id), isNull(s.timeEntries.endedAt)))
      .get();
    res.json(row ?? null);
  });

  r.put('/time-entries/:id', writers, (req, res) => {
    const id = idParam(req);
    const body = parse(z.object({ startedAt: z.iso.datetime(), endedAt: z.iso.datetime().nullable() }), req.body);
    if (body.endedAt && body.endedAt < body.startedAt) throw badRequest('End must be after start');
    const row = db.update(s.timeEntries).set(body).where(eq(s.timeEntries.id, id)).returning().get();
    if (!row) throw notFound('Time entry');
    res.json(row);
  });

  r.delete('/time-entries/:id', writers, (req, res) => {
    db.delete(s.timeEntries).where(eq(s.timeEntries.id, idParam(req))).run();
    res.json({ ok: true });
  });

  /** Technician's job board: lines assigned to me (or unassigned) on open work orders. */
  r.get('/my/jobs', (req, res) => {
    const me = req.user!.id;
    const rows = db.$client
      .prepare(
        `SELECT l.id AS lineId, l.title, l.complaint, l.cause, l.correction, l.done, l.labor_hours AS laborHours,
                l.status AS lineStatus, l.technician_id AS technicianId,
                w.id AS workOrderId, w.number, w.status, w.priority, w.promised_at AS promisedAt,
                u.unit_number AS unitNumber, TRIM(COALESCE(u.year,'') || ' ' || COALESCE(u.make,'') || ' ' || COALESCE(u.model,'')) AS unitLabel,
                c.name AS customerName,
                (SELECT COALESCE(SUM((julianday(COALESCE(t.ended_at, strftime('%Y-%m-%dT%H:%M:%fZ','now'))) - julianday(t.started_at)) * 24), 0)
                   FROM time_entries t WHERE t.line_id = l.id) AS clockedHours
         FROM work_order_lines l
         JOIN work_orders w ON w.id = l.work_order_id
         JOIN units u ON u.id = w.unit_id
         JOIN customers c ON c.id = w.customer_id
         WHERE w.status IN ('approved','in_progress','waiting_parts')
           AND l.status = 'approved'
           AND (l.technician_id = ? OR l.technician_id IS NULL)
         ORDER BY l.done, CASE w.priority WHEN 'down' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, w.id`,
      )
      .all(me) as Record<string, unknown>[];
    res.json(rows.map((r0) => ({ ...r0, done: !!r0.done, clockedHours: Math.round((r0.clockedHours as number) * 100) / 100 })));
  });

  /* ---- Notes & attachments ---- */

  r.post('/work-orders/:id/notes', (req, res) => {
    const id = idParam(req);
    getWo(db, id);
    const body = parse(z.object({ body: z.string().trim().min(1), lineId: zOptNum, customerVisible: z.boolean().default(false) }), req.body);
    const row = db.insert(s.notes).values({ ...body, workOrderId: id, userId: req.user!.id }).returning().get();
    res.status(201).json(row);
  });

  r.delete('/notes/:id', (req, res) => {
    const id = idParam(req);
    const n = db.select().from(s.notes).where(eq(s.notes.id, id)).get();
    if (!n) throw notFound('Note');
    if (n.userId !== req.user!.id && !hasRole(req, 'service_writer')) throw new HttpError(403, 'You can only delete your own notes');
    db.delete(s.notes).where(eq(s.notes.id, id)).run();
    res.json({ ok: true });
  });

  r.post('/work-orders/:id/attachments', upload.array('files', 10), (req: Request, res) => {
    const id = idParam(req);
    getWo(db, id);
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (!files.length) throw badRequest('Attach at least one photo, video or PDF');
    const lineId = req.body.lineId ? Number(req.body.lineId) : null;
    const rows = files.map((f) =>
      db
        .insert(s.attachments)
        .values({
          workOrderId: id,
          lineId,
          userId: req.user!.id,
          filename: f.originalname,
          storedName: f.filename,
          mimeType: f.mimetype,
          sizeBytes: f.size,
          caption: req.body.caption || null,
        })
        .returning()
        .get(),
    );
    res.status(201).json(rows);
  });

  r.get('/attachments/:id/file', (req, res) => {
    const a = db.select().from(s.attachments).where(eq(s.attachments.id, idParam(req))).get();
    if (!a) throw notFound('Attachment');
    const file = path.join(config.uploadDir, path.basename(a.storedName));
    if (!fs.existsSync(file)) throw notFound('File');
    res.type(a.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${a.filename.replace(/"/g, '')}"`);
    res.sendFile(file);
  });

  r.delete('/attachments/:id', (req, res) => {
    const a = db.select().from(s.attachments).where(eq(s.attachments.id, idParam(req))).get();
    if (!a) throw notFound('Attachment');
    if (a.userId !== req.user!.id && !hasRole(req, 'service_writer')) throw new HttpError(403, 'You can only delete your own uploads');
    db.delete(s.attachments).where(eq(s.attachments.id, a.id)).run();
    fs.rm(path.join(config.uploadDir, path.basename(a.storedName)), { force: true }, () => {});
    res.json({ ok: true });
  });

  /* ---- Invoicing ---- */

  r.post('/work-orders/:id/invoice', writers, (req, res) => {
    const id = idParam(req);
    const wo = loadWorkOrder(db, id);
    if (wo.status !== 'complete') throw new HttpError(409, 'Mark the work order complete before invoicing');
    const pending = wo.lines.filter((l) => l.status === 'pending');
    if (pending.length) {
      throw new HttpError(409, `Approve or decline ${pending.length} pending job line(s) before invoicing`);
    }
    if (wo.customer.requiresPo && !wo.poNumber) throw new HttpError(409, `${wo.customer.name} requires a PO number on invoices`);
    const t = wo.approvedTotals;
    const issued = new Date();
    const inv = db.transaction((tx) => {
      const row = tx
        .insert(s.invoices)
        .values({
          number: nextInvoiceNumber(db),
          workOrderId: id,
          customerId: wo.customerId,
          issuedAt: issued.toISOString(),
          dueAt: dueDateFor(issued, wo.customer.paymentTerms).toISOString(),
          laborCents: t.laborCents,
          partsCents: t.partsCents,
          partsCostCents: t.partsCostCents,
          shopSuppliesCents: t.shopSuppliesCents,
          taxCents: t.taxCents,
          totalCents: t.totalCents,
        })
        .returning()
        .get();
      tx.update(s.workOrders).set({ status: 'invoiced', invoicedAt: issued.toISOString() }).where(eq(s.workOrders.id, id)).run();
      return row;
    });
    res.status(201).json(inv);
  });

  return r;
}

