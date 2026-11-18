import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db.js';
import { createApp } from '../app.js';

let server, base;
before(async () => {
  server = createApp(openDb(':memory:')).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => server.close());

async function call(path, method = 'GET', body) {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}
const ok = async (...a) => { const r = await call(...a); assert.ok(r.status < 300, JSON.stringify(r.body)); return r.body; };

test('full work order flow: pricing, inventory, time clock, invoice lock', async () => {
  await ok('/settings', 'PUT', { labor_rate: 100, parts_markup_pct: 50, shop_supplies_pct: 10, shop_supplies_cap: 5, tax_rate_pct: 10, tax_labor: 0 });
  const cust = await ok('/customers', 'POST', { name: 'Acme Freight' });
  const unit = await ok('/units', 'POST', { customer_id: cust.id, unit_number: '7', make: 'Kenworth', mileage: 1000 });
  const tech = await ok('/technicians', 'POST', { name: 'Sam', pin: '1234' });
  const part = await ok('/parts', 'POST', { part_number: 'F1', description: 'Filter', cost: 10, qty_on_hand: 5 });

  let wo = await ok('/work-orders', 'POST', { customer_id: cust.id, unit_id: unit.id, complaints: ['PM', '  ', 'Brakes'] });
  assert.equal(wo.jobs.length, 2);
  assert.equal(wo.number, 1000 + wo.id);
  const [pm] = wo.jobs;

  // Estimate uses estimated hours until time is clocked.
  wo = await ok(`/jobs/${pm.id}`, 'PUT', { estimated_hours: 2 });
  assert.equal(wo.totals.labor, 200);

  // Stocked part: marked up 50%, comes out of inventory.
  wo = await ok(`/jobs/${pm.id}/parts`, 'POST', { part_id: part.id, qty: 2 });
  assert.equal(wo.totals.parts, 30);
  assert.equal((await ok('/parts')).find((p) => p.id === part.id).qty_on_hand, 3);

  // Supplies capped at $5; tax on parts + supplies only.
  assert.equal(wo.totals.supplies, 5);
  assert.equal(wo.totals.tax, 3.5);
  assert.equal(wo.totals.total, 238.5);

  // Billed hours override.
  wo = await ok(`/jobs/${pm.id}`, 'PUT', { billed_hours: 1.5 });
  assert.equal(wo.totals.labor, 150);

  // Tech logs in with PIN, clocks in; WO moves to in progress and job is assigned.
  assert.equal((await call('/tech/login', 'POST', { pin: '0000' })).status, 401);
  const me = await ok('/tech/login', 'POST', { pin: '1234' });
  await ok(`/work-orders/${wo.id}`, 'PUT', { status: 'approved' });
  assert.equal((await ok(`/tech/${me.id}/jobs`)).jobs.length, 2);
  wo = await ok(`/jobs/${pm.id}/clock-in`, 'POST', { tech_id: me.id });
  assert.equal(wo.status, 'in_progress');
  assert.equal(wo.jobs[0].tech_id, tech.id);
  // Clocking into another job closes the first punch.
  wo = await ok(`/jobs/${wo.jobs[1].id}/clock-in`, 'POST', { tech_id: me.id });
  assert.ok(wo.jobs[0].time[0].clock_out);
  assert.equal(wo.jobs[1].time[0].clock_out, null);

  // Removing a stocked part line returns stock.
  const line = wo.jobs[0].parts[0];
  await ok(`/part-lines/${line.id}`, 'DELETE');
  assert.equal((await ok('/parts')).find((p) => p.id === part.id).qty_on_hand, 5);

  // Invoicing closes running clocks and locks the work order.
  wo = await ok(`/work-orders/${wo.id}`, 'PUT', { status: 'invoiced' });
  assert.ok(wo.invoiced_at);
  assert.ok(wo.jobs[1].time[0].clock_out);
  assert.equal((await call(`/jobs/${pm.id}`, 'PUT', { cause: 'x' })).status, 409);
  assert.equal((await call(`/jobs/${pm.id}/clock-in`, 'POST', { tech_id: me.id })).status, 409);

  // Reopen unlocks.
  wo = await ok(`/work-orders/${wo.id}`, 'PUT', { status: 'completed' });
  assert.equal(wo.invoiced_at, null);
  await ok(`/jobs/${pm.id}`, 'PUT', { cause: 'worn' });
});

test('validation', async () => {
  assert.equal((await call('/customers', 'POST', {})).status, 400);
  assert.equal((await call('/technicians', 'POST', { name: 'X', pin: '12' })).status, 400);
  await ok('/technicians', 'POST', { name: 'A', pin: '5555' });
  assert.equal((await call('/technicians', 'POST', { name: 'B', pin: '5555' })).status, 409);
  assert.equal((await call('/work-orders', 'POST', { customer_id: 9999 })).status, 400);
  assert.equal((await call('/work-orders/9999')).status, 404);
});
