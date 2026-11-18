import express from 'express';
import { fileURLToPath } from 'node:url';
import { tx } from './db.js';

export const STATUSES = ['estimate', 'approved', 'in_progress', 'waiting_parts', 'completed', 'invoiced', 'paid'];
const LOCKED = new Set(['invoiced', 'paid']);

const money = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const now = () => new Date().toISOString();

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const notFound = (what) => new HttpError(404, `${what} not found`);

// Only these columns may be written from request bodies.
const FIELDS = {
  settings: ['shop_name', 'shop_address', 'shop_phone', 'labor_rate', 'parts_markup_pct', 'shop_supplies_pct',
    'shop_supplies_cap', 'tax_rate_pct', 'tax_labor', 'invoice_terms'],
  customers: ['name', 'contact', 'phone', 'email', 'address'],
  units: ['customer_id', 'unit_number', 'year', 'make', 'model', 'vin', 'plate', 'mileage'],
  technicians: ['name', 'pin', 'active'],
  parts: ['part_number', 'description', 'vendor', 'cost', 'price', 'qty_on_hand', 'reorder_at'],
  work_orders: ['status', 'mileage', 'po_number', 'notes'],
  jobs: ['complaint', 'cause', 'correction', 'tech_id', 'estimated_hours', 'billed_hours', 'done'],
};

function pick(table, body) {
  const out = {};
  for (const k of FIELDS[table]) {
    if (body[k] === undefined) continue;
    let v = body[k];
    if (typeof v === 'boolean') v = v ? 1 : 0;
    if (v === '') v = ['price', 'billed_hours', 'mileage', 'tech_id'].includes(k) ? null : v;
    out[k] = v;
  }
  return out;
}

export function createApp(db) {
  const app = express();
  app.use(express.json());

  // Optional shared password for the whole app (set SHOP_PASSWORD when hosted online).
  if (process.env.SHOP_PASSWORD) {
    app.use((req, res, next) => {
      const [, b64 = ''] = (req.headers.authorization || '').split(' ');
      const [, pass] = Buffer.from(b64, 'base64').toString().split(':');
      if (pass === process.env.SHOP_PASSWORD) return next();
      res.set('WWW-Authenticate', 'Basic realm="Shop"').status(401).send('Login required');
    });
  }

  const get = (sql, ...p) => db.prepare(sql).get(...p);
  const all = (sql, ...p) => db.prepare(sql).all(...p);
  const run = (sql, ...p) => db.prepare(sql).run(...p);

  function insert(table, data) {
    const keys = Object.keys(data);
    const sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`;
    return Number(run(sql, ...keys.map((k) => data[k])).lastInsertRowid);
  }
  function update(table, id, data) {
    const keys = Object.keys(data);
    if (!keys.length) return;
    run(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(',')} WHERE id = ?`, ...keys.map((k) => data[k]), id);
  }

  const settings = () => get('SELECT * FROM settings WHERE id = 1');
  const partPrice = (part, s = settings()) =>
    part.price != null ? part.price : money(part.cost * (1 + s.parts_markup_pct / 100));

  function workOrder(id) {
    const wo = get(`SELECT w.*, c.name AS customer_name, c.phone AS customer_phone, c.email AS customer_email,
        c.address AS customer_address, u.unit_number, u.year, u.make, u.model, u.vin, u.plate
      FROM work_orders w JOIN customers c ON c.id = w.customer_id LEFT JOIN units u ON u.id = w.unit_id
      WHERE w.id = ?`, id);
    if (!wo) throw notFound('Work order');
    const s = settings();
    wo.number = 1000 + wo.id;
    wo.jobs = all(`SELECT j.*, t.name AS tech_name FROM jobs j LEFT JOIN technicians t ON t.id = j.tech_id
      WHERE work_order_id = ? ORDER BY j.id`, id);
    const t = { labor: 0, parts: 0, hours: 0 };
    for (const j of wo.jobs) {
      j.parts = all('SELECT * FROM part_lines WHERE job_id = ? ORDER BY id', j.id);
      j.time = all(`SELECT e.*, t.name AS tech_name FROM time_entries e JOIN technicians t ON t.id = e.tech_id
        WHERE job_id = ? ORDER BY e.id`, j.id);
      const ms = j.time.reduce((sum, e) => sum + (Date.parse(e.clock_out || now()) - Date.parse(e.clock_in)), 0);
      j.clocked_hours = Math.round(ms / 360000) / 10;
      j.hours = j.billed_hours ?? (j.clocked_hours > 0 ? j.clocked_hours : j.estimated_hours);
      j.labor_total = money(j.hours * s.labor_rate);
      j.parts_total = money(j.parts.reduce((sum, p) => sum + p.qty * p.unit_price, 0));
      t.hours += j.hours; t.labor += j.labor_total; t.parts += j.parts_total;
    }
    let supplies = t.labor * s.shop_supplies_pct / 100;
    if (s.shop_supplies_cap > 0) supplies = Math.min(supplies, s.shop_supplies_cap);
    const taxable = t.parts + supplies + (s.tax_labor ? t.labor : 0);
    const tax = taxable * s.tax_rate_pct / 100;
    wo.totals = {
      hours: Math.round(t.hours * 10) / 10,
      labor: money(t.labor), parts: money(t.parts), supplies: money(supplies), tax: money(tax),
      total: money(t.labor + t.parts + supplies + tax),
    };
    return wo;
  }

  function jobWithWo(jobId) {
    const job = get('SELECT j.*, w.status AS wo_status FROM jobs j JOIN work_orders w ON w.id = j.work_order_id WHERE j.id = ?', jobId);
    if (!job) throw notFound('Job');
    return job;
  }
  const assertEditable = (status) => {
    if (LOCKED.has(status)) throw new HttpError(409, 'Work order is invoiced; reopen it to make changes');
  };

  const r = express.Router();
  const h = (fn) => (req, res, next) => { try { res.json(fn(req, res)); } catch (e) { next(e); } };

  // Settings
  r.get('/settings', h(() => settings()));
  r.put('/settings', h((req) => { update('settings', 1, pick('settings', req.body)); return settings(); }));

  // Customers & units
  r.get('/customers', h((req) => {
    const q = `%${req.query.q || ''}%`;
    return all(`SELECT c.*, (SELECT COUNT(*) FROM units WHERE customer_id = c.id) AS unit_count FROM customers c
      WHERE c.name LIKE ? OR c.phone LIKE ? OR c.contact LIKE ? ORDER BY c.name`, q, q, q);
  }));
  r.post('/customers', h((req) => {
    const data = pick('customers', req.body);
    if (!data.name) throw new HttpError(400, 'Name is required');
    return get('SELECT * FROM customers WHERE id = ?', insert('customers', data));
  }));
  r.get('/customers/:id', h((req) => {
    const c = get('SELECT * FROM customers WHERE id = ?', req.params.id);
    if (!c) throw notFound('Customer');
    c.units = all('SELECT * FROM units WHERE customer_id = ? ORDER BY unit_number', c.id);
    c.work_orders = all('SELECT id, 1000 + id AS number, status, created_at FROM work_orders WHERE customer_id = ? ORDER BY id DESC', c.id);
    return c;
  }));
  r.put('/customers/:id', h((req) => { update('customers', req.params.id, pick('customers', req.body)); return get('SELECT * FROM customers WHERE id = ?', req.params.id); }));
  r.delete('/customers/:id', h((req) => {
    if (get('SELECT 1 FROM work_orders WHERE customer_id = ?', req.params.id)) throw new HttpError(409, 'Customer has work orders');
    run('DELETE FROM customers WHERE id = ?', req.params.id); return { ok: true };
  }));
  r.post('/units', h((req) => {
    const data = pick('units', req.body);
    if (!data.customer_id) throw new HttpError(400, 'customer_id is required');
    return get('SELECT * FROM units WHERE id = ?', insert('units', data));
  }));
  r.put('/units/:id', h((req) => { update('units', req.params.id, pick('units', req.body)); return get('SELECT * FROM units WHERE id = ?', req.params.id); }));
  r.delete('/units/:id', h((req) => {
    if (get('SELECT 1 FROM work_orders WHERE unit_id = ?', req.params.id)) throw new HttpError(409, 'Unit has work orders');
    run('DELETE FROM units WHERE id = ?', req.params.id); return { ok: true };
  }));

  // Technicians
  r.get('/technicians', h(() => all(`SELECT t.id, t.name, t.active,
      (SELECT j.work_order_id FROM time_entries e JOIN jobs j ON j.id = e.job_id WHERE e.tech_id = t.id AND e.clock_out IS NULL) AS on_work_order
    FROM technicians t ORDER BY t.active DESC, t.name`)));
  r.post('/technicians', h((req) => {
    const data = pick('technicians', req.body);
    if (!data.name || !/^\d{4,6}$/.test(String(data.pin || ''))) throw new HttpError(400, 'Name and a 4–6 digit PIN are required');
    if (get('SELECT 1 FROM technicians WHERE pin = ?', String(data.pin))) throw new HttpError(409, 'PIN already in use');
    const id = insert('technicians', { ...data, pin: String(data.pin) });
    return get('SELECT id, name, active FROM technicians WHERE id = ?', id);
  }));
  r.put('/technicians/:id', h((req) => {
    const data = pick('technicians', req.body);
    if (data.pin !== undefined) {
      if (!/^\d{4,6}$/.test(String(data.pin))) throw new HttpError(400, 'PIN must be 4–6 digits');
      if (get('SELECT 1 FROM technicians WHERE pin = ? AND id <> ?', String(data.pin), req.params.id)) throw new HttpError(409, 'PIN already in use');
      data.pin = String(data.pin);
    }
    update('technicians', req.params.id, data);
    return get('SELECT id, name, active FROM technicians WHERE id = ?', req.params.id);
  }));

  // Parts inventory
  r.get('/parts', h((req) => {
    const q = `%${req.query.q || ''}%`;
    const s = settings();
    return all('SELECT * FROM parts WHERE part_number LIKE ? OR description LIKE ? OR vendor LIKE ? ORDER BY part_number', q, q, q)
      .map((p) => ({ ...p, sell_price: partPrice(p, s), low: p.qty_on_hand <= p.reorder_at }));
  }));
  r.post('/parts', h((req) => {
    const data = pick('parts', req.body);
    if (!data.part_number) throw new HttpError(400, 'Part number is required');
    return get('SELECT * FROM parts WHERE id = ?', insert('parts', data));
  }));
  r.put('/parts/:id', h((req) => { update('parts', req.params.id, pick('parts', req.body)); return get('SELECT * FROM parts WHERE id = ?', req.params.id); }));
  r.delete('/parts/:id', h((req) => {
    if (get('SELECT 1 FROM part_lines WHERE part_id = ?', req.params.id)) throw new HttpError(409, 'Part is used on work orders');
    run('DELETE FROM parts WHERE id = ?', req.params.id); return { ok: true };
  }));

  // Work orders
  r.get('/work-orders', h((req) => {
    const where = []; const params = [];
    if (req.query.status) { where.push('w.status = ?'); params.push(req.query.status); }
    if (req.query.open === '1') where.push(`w.status NOT IN ('invoiced','paid')`);
    const rows = all(`SELECT w.id FROM work_orders w ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY w.id DESC LIMIT 500`, ...params);
    return rows.map(({ id }) => {
      const wo = workOrder(id);
      return {
        id: wo.id, number: wo.number, status: wo.status, created_at: wo.created_at, customer_name: wo.customer_name,
        unit: [wo.unit_number, wo.year, wo.make, wo.model].filter(Boolean).join(' '),
        complaint: wo.jobs.map((j) => j.complaint).filter(Boolean).join('; '),
        techs: [...new Set(wo.jobs.map((j) => j.tech_name).filter(Boolean))].join(', '),
        total: wo.totals.total,
      };
    });
  }));
  r.post('/work-orders', h((req) => {
    const { customer_id, unit_id, complaints = [] } = req.body;
    if (!get('SELECT 1 FROM customers WHERE id = ?', customer_id)) throw new HttpError(400, 'Pick a customer');
    if (unit_id && !get('SELECT 1 FROM units WHERE id = ? AND customer_id = ?', unit_id, customer_id)) throw new HttpError(400, 'Unit does not belong to customer');
    const id = tx(db, () => {
      const unit = unit_id ? get('SELECT mileage FROM units WHERE id = ?', unit_id) : null;
      const woId = insert('work_orders', { customer_id, unit_id: unit_id || null, mileage: req.body.mileage ?? unit?.mileage ?? null, po_number: req.body.po_number || '' });
      for (const c of complaints.filter((c) => c && c.trim())) insert('jobs', { work_order_id: woId, complaint: c.trim() });
      return woId;
    });
    return workOrder(id);
  }));
  r.get('/work-orders/:id', h((req) => workOrder(req.params.id)));
  r.put('/work-orders/:id', h((req) => {
    const wo = workOrder(req.params.id);
    const data = pick('work_orders', req.body);
    if (data.status !== undefined && !STATUSES.includes(data.status)) throw new HttpError(400, 'Bad status');
    if (LOCKED.has(wo.status) && Object.keys(data).some((k) => k !== 'status' && k !== 'notes')) assertEditable(wo.status);
    if (LOCKED.has(data.status) && !wo.invoiced_at) {
      // Close out any running clocks so the invoice reflects real time.
      run(`UPDATE time_entries SET clock_out = ? WHERE clock_out IS NULL AND job_id IN (SELECT id FROM jobs WHERE work_order_id = ?)`, now(), wo.id);
      data.invoiced_at = now();
    }
    if (data.status === 'paid' && !wo.paid_at) data.paid_at = now();
    if (data.status && !LOCKED.has(data.status)) { data.invoiced_at = null; data.paid_at = null; }
    if (data.mileage != null && wo.unit_id) run('UPDATE units SET mileage = MAX(COALESCE(mileage,0), ?) WHERE id = ?', data.mileage, wo.unit_id);
    update('work_orders', wo.id, data);
    return workOrder(wo.id);
  }));
  r.delete('/work-orders/:id', h((req) => {
    const wo = workOrder(req.params.id);
    assertEditable(wo.status);
    tx(db, () => {
      // Return any stocked parts to inventory.
      for (const j of wo.jobs) for (const p of j.parts) if (p.part_id) run('UPDATE parts SET qty_on_hand = qty_on_hand + ? WHERE id = ?', p.qty, p.part_id);
      run('DELETE FROM work_orders WHERE id = ?', wo.id);
    });
    return { ok: true };
  }));

  // Jobs (complaint / cause / correction lines)
  r.post('/work-orders/:id/jobs', h((req) => {
    const wo = workOrder(req.params.id);
    assertEditable(wo.status);
    insert('jobs', { work_order_id: wo.id, ...pick('jobs', req.body) });
    return workOrder(wo.id);
  }));
  r.put('/jobs/:id', h((req) => {
    const job = jobWithWo(req.params.id);
    assertEditable(job.wo_status);
    update('jobs', job.id, pick('jobs', req.body));
    return workOrder(job.work_order_id);
  }));
  r.delete('/jobs/:id', h((req) => {
    const job = jobWithWo(req.params.id);
    assertEditable(job.wo_status);
    tx(db, () => {
      for (const p of all('SELECT * FROM part_lines WHERE job_id = ?', job.id)) if (p.part_id) run('UPDATE parts SET qty_on_hand = qty_on_hand + ? WHERE id = ?', p.qty, p.part_id);
      run('DELETE FROM jobs WHERE id = ?', job.id);
    });
    return workOrder(job.work_order_id);
  }));

  // Parts on a job — stocked parts come out of inventory.
  r.post('/jobs/:id/parts', h((req) => {
    const job = jobWithWo(req.params.id);
    assertEditable(job.wo_status);
    const qty = Number(req.body.qty) || 1;
    tx(db, () => {
      if (req.body.part_id) {
        const part = get('SELECT * FROM parts WHERE id = ?', req.body.part_id);
        if (!part) throw notFound('Part');
        insert('part_lines', {
          job_id: job.id, part_id: part.id, part_number: part.part_number, description: part.description, qty,
          unit_cost: part.cost, unit_price: req.body.unit_price != null && req.body.unit_price !== '' ? Number(req.body.unit_price) : partPrice(part),
        });
        run('UPDATE parts SET qty_on_hand = qty_on_hand - ? WHERE id = ?', qty, part.id);
      } else {
        if (!req.body.description && !req.body.part_number) throw new HttpError(400, 'Describe the part');
        const cost = Number(req.body.unit_cost) || 0;
        const price = req.body.unit_price != null && req.body.unit_price !== '' ? Number(req.body.unit_price) : partPrice({ cost, price: null });
        insert('part_lines', { job_id: job.id, part_number: req.body.part_number || '', description: req.body.description || '', qty, unit_cost: cost, unit_price: price });
      }
    });
    return workOrder(job.work_order_id);
  }));
  r.delete('/part-lines/:id', h((req) => {
    const line = get('SELECT * FROM part_lines WHERE id = ?', req.params.id);
    if (!line) throw notFound('Part line');
    const job = jobWithWo(line.job_id);
    assertEditable(job.wo_status);
    tx(db, () => {
      if (line.part_id) run('UPDATE parts SET qty_on_hand = qty_on_hand + ? WHERE id = ?', line.qty, line.part_id);
      run('DELETE FROM part_lines WHERE id = ?', line.id);
    });
    return workOrder(job.work_order_id);
  }));

  // Tech tablet: PIN login, job list, clock in/out
  r.post('/tech/login', h((req) => {
    const t = get('SELECT id, name FROM technicians WHERE pin = ? AND active = 1', String(req.body.pin || ''));
    if (!t) throw new HttpError(401, 'Wrong PIN');
    return t;
  }));
  r.get('/tech/:id/jobs', h((req) => {
    const techId = Number(req.params.id);
    const active = get('SELECT * FROM time_entries WHERE tech_id = ? AND clock_out IS NULL', techId);
    const jobs = all(`SELECT j.id, j.work_order_id, j.complaint, j.cause, j.correction, j.done, j.tech_id,
        1000 + w.id AS number, w.status, c.name AS customer_name, u.unit_number, u.year, u.make, u.model
      FROM jobs j JOIN work_orders w ON w.id = j.work_order_id JOIN customers c ON c.id = w.customer_id
      LEFT JOIN units u ON u.id = w.unit_id
      WHERE w.status IN ('approved','in_progress','waiting_parts') AND (j.tech_id = ? OR j.tech_id IS NULL)
      ORDER BY (j.tech_id IS NULL), j.done, w.id`, techId);
    return { active, jobs };
  }));
  r.post('/jobs/:id/clock-in', h((req) => {
    const job = jobWithWo(req.params.id);
    assertEditable(job.wo_status);
    const tech = get('SELECT id FROM technicians WHERE id = ? AND active = 1', req.body.tech_id);
    if (!tech) throw new HttpError(400, 'Unknown tech');
    tx(db, () => {
      run('UPDATE time_entries SET clock_out = ? WHERE tech_id = ? AND clock_out IS NULL', now(), tech.id);
      insert('time_entries', { job_id: job.id, tech_id: tech.id, clock_in: now() });
      if (!job.tech_id) run('UPDATE jobs SET tech_id = ? WHERE id = ?', tech.id, job.id);
      if (job.wo_status === 'approved' || job.wo_status === 'estimate') run(`UPDATE work_orders SET status = 'in_progress' WHERE id = ?`, job.work_order_id);
    });
    return workOrder(job.work_order_id);
  }));
  r.post('/tech/:id/clock-out', h((req) => {
    run('UPDATE time_entries SET clock_out = ? WHERE tech_id = ? AND clock_out IS NULL', now(), req.params.id);
    return { ok: true };
  }));
  r.put('/time-entries/:id', h((req) => {
    const e = get('SELECT * FROM time_entries WHERE id = ?', req.params.id);
    if (!e) throw notFound('Time entry');
    assertEditable(jobWithWo(e.job_id).wo_status);
    const data = {};
    for (const k of ['clock_in', 'clock_out']) if (req.body[k] !== undefined) data[k] = req.body[k] ? new Date(req.body[k]).toISOString() : null;
    update('time_entries', e.id, data);
    return workOrder(jobWithWo(e.job_id).work_order_id);
  }));
  r.delete('/time-entries/:id', h((req) => {
    const e = get('SELECT * FROM time_entries WHERE id = ?', req.params.id);
    if (!e) throw notFound('Time entry');
    const job = jobWithWo(e.job_id);
    assertEditable(job.wo_status);
    run('DELETE FROM time_entries WHERE id = ?', e.id);
    return workOrder(job.work_order_id);
  }));

  // Dashboard numbers
  r.get('/dashboard', h(() => {
    const counts = Object.fromEntries(all('SELECT status, COUNT(*) AS n FROM work_orders GROUP BY status').map((x) => [x.status, x.n]));
    const unpaid = all(`SELECT id FROM work_orders WHERE status = 'invoiced'`).reduce((s, { id }) => s + workOrder(id).totals.total, 0);
    const lowParts = all('SELECT id, part_number, description, qty_on_hand, reorder_at FROM parts WHERE qty_on_hand <= reorder_at AND reorder_at > 0 ORDER BY part_number');
    const clockedIn = all(`SELECT t.name, 1000 + j.work_order_id AS number, e.clock_in FROM time_entries e
      JOIN technicians t ON t.id = e.tech_id JOIN jobs j ON j.id = e.job_id WHERE e.clock_out IS NULL ORDER BY t.name`);
    return { counts, unpaid: money(unpaid), lowParts, clockedIn };
  }));

  app.use('/api', r);
  app.use(express.static(fileURLToPath(new URL('./public', import.meta.url))));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    res.status(status).json({ error: status === 500 ? 'Server error' : err.message });
  });
  return app;
}
