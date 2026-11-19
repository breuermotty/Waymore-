import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';

let app: Express;
let db: any;

// Each role gets its own cookie-carrying agent.
const agents: Record<string, ReturnType<typeof request.agent>> = {};

beforeAll(async () => {
  process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'waymore-test-'));
  const { openDb } = await import('./db/client');
  const { seed } = await import('./db/seed');
  const { createApp } = await import('./app');
  db = openDb(':memory:');
  seed(db);
  app = createApp(db);
  for (const [role, email] of [
    ['admin', 'admin@waymore.dev'],
    ['writer', 'writer@waymore.dev'],
    ['tech', 'tech@waymore.dev'],
    ['parts', 'parts@waymore.dev'],
  ]) {
    agents[role] = request.agent(app);
    await agents[role].post('/api/auth/login').send({ email, password: 'waymore123' }).expect(200);
  }
});

describe('auth & roles', () => {
  it('rejects bad credentials and anonymous access', async () => {
    await request(app).post('/api/auth/login').send({ email: 'admin@waymore.dev', password: 'nope' }).expect(401);
    await request(app).get('/api/customers').expect(401);
  });
  it('returns the session user', async () => {
    const r = await agents.writer.get('/api/auth/me').expect(200);
    expect(r.body.user).toMatchObject({ email: 'writer@waymore.dev', role: 'service_writer' });
  });
  it('enforces role permissions', async () => {
    await agents.tech.post('/api/customers').send({ name: 'X' }).expect(403);
    await agents.writer.put('/api/settings').send({}).expect(403);
    await agents.tech.post('/api/parts').send({ partNumber: 'X', description: 'Y', costCents: 1 }).expect(403);
    await agents.writer.get('/api/users').expect(403);
  });
});

describe('work order lifecycle', () => {
  let customerId: number;
  let unitId: number;
  let woId: number;
  let lineA: number;
  let lineB: number;
  let partId: number;
  let stockBefore: number;

  it('creates a customer and unit', async () => {
    const c = await agents.writer
      .post('/api/customers')
      .send({ name: 'Test Haulers LLC', paymentTerms: 'net30', laborRateCents: 15000 })
      .expect(201);
    customerId = c.body.id;
    const u = await agents.writer
      .post('/api/units')
      .send({ customerId, unitNumber: 'T-1', vin: '1fujgldr0clbp8834', year: 2020, make: 'Freightliner', model: 'Cascadia', mileage: 100000 })
      .expect(201);
    unitId = u.body.id;
    expect(u.body.vin).toBe('1FUJGLDR0CLBP8834');
    await agents.writer.post('/api/units').send({ customerId, unitNumber: 'BAD', vin: 'IOQ' }).expect(400);
  });

  it('creates a work order with complaint lines at the customer labor rate', async () => {
    const r = await agents.writer
      .post('/api/work-orders')
      .send({
        customerId,
        unitId,
        mileageIn: 101500,
        lines: [
          { title: 'Brake job', complaint: 'Pulls left', laborHours: 3 },
          { title: 'Replace wipers', complaint: 'Streaking', laborHours: 0.5 },
        ],
      })
      .expect(201);
    woId = r.body.id;
    expect(r.body.status).toBe('estimate');
    expect(r.body.number).toMatch(/^WO-\d+$/);
    [lineA, lineB] = r.body.lines.map((l: any) => l.id);
    expect(r.body.lines[0].laborRateCents).toBe(15000);
    // unit mileage was bumped
    const unit = await agents.writer.get(`/api/units/${unitId}`).expect(200);
    expect(unit.body.mileage).toBe(101500);
  });

  it('prices catalog parts from the markup matrix and decrements stock', async () => {
    const parts = await agents.writer.get('/api/parts?q=BS-4707Q').expect(200);
    partId = parts.body[0].id;
    stockBefore = parts.body[0].qtyOnHand;
    const r = await agents.parts.post(`/api/lines/${lineA}/parts`).send({ partId, quantity: 4 }).expect(201);
    const p = r.body.lines[0].parts[0];
    // cost $68.90 falls in the <= $200 tier (40%) -> $96.46
    expect(p.unitPriceCents).toBe(9646);
    const after = await agents.writer.get(`/api/parts/${partId}`).expect(200);
    expect(after.body.qtyOnHand).toBe(stockBefore - 4);
  });

  it('adds non-stock parts and computes estimate totals', async () => {
    const r = await agents.writer
      .post(`/api/lines/${lineB}/parts`)
      .send({ partNumber: 'NS-1', description: 'Wiper blade', quantity: 2, unitPriceCents: 1500, taxable: true })
      .expect(201);
    const t = r.body.estimateTotals;
    expect(t.laborCents).toBe(45000 + 7500);
    expect(t.partsCents).toBe(9646 * 4 + 3000);
    expect(t.shopSuppliesCents).toBe(2625); // 5% of $525.00 labor (cap $75)
    expect(t.taxCents).toBe(Math.round(((9646 * 4 + 3000) * 8.25) / 100));
  });

  it('lets the customer approve/decline lines through the public link', async () => {
    const sent = await agents.writer.post(`/api/work-orders/${woId}/send-authorization`).expect(200);
    const token = sent.body.token;
    const pub = await request(app).get(`/api/public/authorize/${token}`).expect(200);
    expect(pub.body.lines).toHaveLength(2);
    expect(pub.body).not.toHaveProperty('customer.email');
    await request(app).get('/api/public/authorize/not-a-real-token-123').expect(404);
    await request(app)
      .post(`/api/public/authorize/${token}`)
      .send({ name: 'Pat Customer', decisions: { [lineA]: 'approved', [lineB]: 'declined' } })
      .expect(200);
    const wo = await agents.writer.get(`/api/work-orders/${woId}`).expect(200);
    expect(wo.body.status).toBe('approved');
    expect(wo.body.authorizedBy).toContain('Pat Customer');
    expect(wo.body.lines.map((l: any) => l.status)).toEqual(['approved', 'declined']);
    expect(wo.body.approvedTotals.partsCents).toBe(9646 * 4);
  });

  it('tracks technician labor time and moves the WO to in progress', async () => {
    await agents.writer.put(`/api/lines/${lineA}`).send({ technicianId: (await techId()) }).expect(200);
    await agents.tech.post(`/api/lines/${lineB}/clock-in`).expect(409); // declined line
    await agents.tech.post(`/api/lines/${lineA}/clock-in`).expect(200);
    const cur = await agents.tech.get('/api/time/current').expect(200);
    expect(cur.body.lineId).toBe(lineA);
    let wo = await agents.writer.get(`/api/work-orders/${woId}`).expect(200);
    expect(wo.body.status).toBe('in_progress');
    await agents.tech.post('/api/time/clock-out').expect(200);
    expect((await agents.tech.get('/api/time/current')).body).toBeNull();
    wo = await agents.writer.get(`/api/work-orders/${woId}`).expect(200);
    expect(wo.body.lines[0].timeEntries).toHaveLength(1);
    expect(wo.body.lines[0].timeEntries[0].endedAt).toBeTruthy();
    // tech documents cause/correction but cannot change billed hours
    await agents.tech.put(`/api/lines/${lineA}`).send({ cause: 'Worn shoes', correction: 'Relined', laborHours: 99, done: true }).expect(200);
    wo = await agents.writer.get(`/api/work-orders/${woId}`).expect(200);
    expect(wo.body.lines[0]).toMatchObject({ cause: 'Worn shoes', correction: 'Relined', laborHours: 3, done: true });
  });

  it('blocks invoicing until complete, then invoices approved lines only and locks the WO', async () => {
    await agents.writer.post(`/api/work-orders/${woId}/invoice`).expect(409);
    await agents.writer.post(`/api/work-orders/${woId}/status`).send({ status: 'complete' }).expect(200);
    const inv = await agents.writer.post(`/api/work-orders/${woId}/invoice`).expect(201);
    const labor = 45000;
    const parts = 9646 * 4;
    const supplies = 2250;
    const tax = Math.round((parts * 8.25) / 100);
    expect(inv.body).toMatchObject({ laborCents: labor, partsCents: parts, shopSuppliesCents: supplies, taxCents: tax, totalCents: labor + parts + supplies + tax });
    expect(inv.body.dueAt.slice(0, 10) > inv.body.issuedAt.slice(0, 10)).toBe(true);
    const wo = await agents.writer.get(`/api/work-orders/${woId}`).expect(200);
    expect(wo.body.status).toBe('invoiced');
    await agents.writer.post(`/api/work-orders/${woId}/lines`).send({ title: 'Late add' }).expect(409);

    // payments
    const half = Math.floor(inv.body.totalCents / 2);
    let r = await agents.writer.post(`/api/invoices/${inv.body.id}/payments`).send({ amountCents: half, method: 'check', reference: '1001' }).expect(201);
    expect(r.body.status).toBe('partial');
    await agents.writer.post(`/api/invoices/${inv.body.id}/payments`).send({ amountCents: inv.body.totalCents, method: 'check' }).expect(400);
    r = await agents.writer.post(`/api/invoices/${inv.body.id}/payments`).send({ amountCents: inv.body.totalCents - half, method: 'ach' }).expect(201);
    expect(r.body).toMatchObject({ status: 'paid', balanceCents: 0 });
  });

  it('requires pending lines to be resolved before invoicing', async () => {
    const r = await agents.writer
      .post('/api/work-orders')
      .send({ customerId, unitId, lines: [{ title: 'Diag', laborHours: 1 }] })
      .expect(201);
    const id = r.body.id;
    await agents.writer.post(`/api/work-orders/${id}/status`).send({ status: 'approved' }).expect(200); // approves pending lines
    await agents.writer.post(`/api/work-orders/${id}/lines`).send({ title: 'Added later', laborHours: 1 }).expect(201);
    await agents.writer.post(`/api/work-orders/${id}/status`).send({ status: 'in_progress' }).expect(200);
    await agents.writer.post(`/api/work-orders/${id}/status`).send({ status: 'complete' }).expect(200);
    const res = await agents.writer.post(`/api/work-orders/${id}/invoice`).expect(409);
    expect(res.body.error).toMatch(/pending/);
  });

  it('returns stock when a part is removed', async () => {
    const r = await agents.writer.post('/api/work-orders').send({ customerId, unitId, lines: [{ title: 'Seal' }] }).expect(201);
    const line = r.body.lines[0].id;
    const before = (await agents.writer.get(`/api/parts/${partId}`)).body.qtyOnHand;
    const added = await agents.parts.post(`/api/lines/${line}/parts`).send({ partId, quantity: 2 }).expect(201);
    expect((await agents.writer.get(`/api/parts/${partId}`)).body.qtyOnHand).toBe(before - 2);
    await agents.parts.delete(`/api/wo-parts/${added.body.lines[0].parts[0].id}`).expect(200);
    expect((await agents.writer.get(`/api/parts/${partId}`)).body.qtyOnHand).toBe(before);
  });
});

describe('purchasing', () => {
  it('orders and receives a PO, updating stock and status', async () => {
    const parts = await agents.parts.get('/api/parts?q=WS-370').expect(200);
    const part = parts.body[0];
    const vendors = await agents.parts.get('/api/vendors').expect(200);
    const po = await agents.parts
      .post('/api/purchase-orders')
      .send({ vendorId: vendors.body[0].id, lines: [{ partId: part.id, quantity: 10, unitCostCents: 3300 }] })
      .expect(201);
    await agents.parts.post(`/api/purchase-orders/${po.body.id}/receive`).send({ lines: [] }).expect(409);
    await agents.parts.post(`/api/purchase-orders/${po.body.id}/status`).send({ status: 'ordered' }).expect(200);
    const lineId = po.body.lines[0].id;
    let r = await agents.parts.post(`/api/purchase-orders/${po.body.id}/receive`).send({ lines: [{ lineId, qty: 4 }] }).expect(200);
    expect(r.body.status).toBe('partial');
    r = await agents.parts.post(`/api/purchase-orders/${po.body.id}/receive`).send({ lines: [{ lineId, qty: 50 }] }).expect(200);
    expect(r.body.status).toBe('received');
    const after = (await agents.parts.get(`/api/parts/${part.id}`)).body;
    expect(after.qtyOnHand).toBe(part.qtyOnHand + 10); // over-receipt is capped at ordered qty
    expect(after.costCents).toBe(3300);
  });
});

describe('reports', () => {
  it('produces dashboard and report data', async () => {
    const d = await agents.writer.get('/api/dashboard').expect(200);
    expect(d.body.months).toHaveLength(6);
    expect(d.body.openCount).toBeGreaterThan(0);
    const t = await agents.writer.get('/api/reports/technicians?from=2020-01-01').expect(200);
    expect(t.body.rows.length).toBe(4);
    expect(t.body.rows.some((r: any) => r.efficiencyPct > 0)).toBe(true);
    const ar = await agents.writer.get('/api/reports/ar-aging').expect(200);
    expect(ar.body.buckets).toContain('90+');
    await agents.tech.get('/api/reports/revenue').expect(403);
  });
});

async function techId() {
  const staff = await agents.writer.get('/api/staff');
  return staff.body.find((u: any) => u.email === 'tech@waymore.dev').id;
}
