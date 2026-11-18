import { api, esc, $, usd, badge, unitLabel, fmtDate, fmtTime, toast, formData, STATUS_LABEL } from './common.js';

const view = $('#view');
let settingsCache = null;
const getSettings = async () => (settingsCache ||= await api('/settings'));

// Each page sets view.innerHTML and assigns view.onclick / view.onchange handlers.
function page(html, { click, change, submit } = {}) {
  view.innerHTML = html;
  view.onclick = click ? (e) => { const t = e.target.closest('[data-act]'); if (t) run(() => click(t.dataset.act, t, e)); } : null;
  view.onchange = change ? (e) => run(() => change(e.target, e)) : null;
  view.onsubmit = submit ? (e) => { e.preventDefault(); run(() => submit(e.target, e)); } : null;
}
async function run(fn) {
  try { await fn(); } catch (err) { toast(err.message, true); }
}
const go = (hash) => { location.hash = hash; };

// ---------- Board (dashboard) ----------
async function board() {
  const [dash, wos] = await Promise.all([api('/dashboard'), api('/work-orders?open=1')]);
  const cols = ['estimate', 'approved', 'in_progress', 'waiting_parts', 'completed'];
  page(`
    <div class="spread"><h1>Shop board</h1><a class="btn primary" href="#/new">+ New work order</a></div>
    <div class="stats">
      <div class="stat"><span class="muted">Open work orders</span><b>${wos.length}</b></div>
      <div class="stat"><span class="muted">Ready to invoice</span><b>${dash.counts.completed || 0}</b></div>
      <div class="stat"><span class="muted">Invoiced, unpaid</span><b>${usd(dash.unpaid)}</b></div>
      <div class="stat"><span class="muted">Techs clocked in</span><b>${dash.clockedIn.length}</b></div>
    </div>
    <div class="board">
      ${cols.map((s) => `<div class="col"><b>${STATUS_LABEL[s]}</b>
        ${wos.filter((w) => w.status === s).map((w) => `
          <div class="card" data-act="open" data-id="${w.id}">
            <div class="spread"><b>#${w.number}</b><span class="muted">${usd(w.total)}</span></div>
            <div>${esc(w.customer_name)}</div>
            <div class="muted">${esc(w.unit)}</div>
            ${w.complaint ? `<div class="muted" style="font-size:13px">${esc(w.complaint.slice(0, 90))}</div>` : ''}
            ${w.techs ? `<div style="font-size:13px">🔧 ${esc(w.techs)}</div>` : ''}
          </div>`).join('')}
      </div>`).join('')}
    </div>
    <div class="grid2" style="margin-top:16px">
      <div class="panel"><h2>On the clock</h2>
        ${dash.clockedIn.length ? `<table>${dash.clockedIn.map((c) => `<tr><td>${esc(c.name)}</td><td>WO #${c.number}</td><td class="muted">since ${fmtTime(c.clock_in)}</td></tr>`).join('')}</table>` : '<p class="muted">Nobody is clocked in.</p>'}
      </div>
      <div class="panel"><h2>Low stock</h2>
        ${dash.lowParts.length ? `<table>${dash.lowParts.map((p) => `<tr><td>${esc(p.part_number)}</td><td class="num">${p.qty_on_hand}</td></tr>`).join('')}</table>` : '<p class="muted">Nothing below reorder level.</p>'}
      </div>
    </div>`, {
    click: (act, t) => { if (act === 'open') go(`#/wo/${t.dataset.id}`); },
  });
}

// ---------- Work order list ----------
async function workOrders() {
  const status = new URLSearchParams(location.hash.split('?')[1]).get('status') || '';
  const wos = await api('/work-orders' + (status ? `?status=${status}` : ''));
  page(`
    <div class="spread"><h1>Work orders</h1><a class="btn primary" href="#/new">+ New work order</a></div>
    <div class="panel">
      <label style="max-width:240px">Status
        <select id="statusFilter"><option value="">All</option>
          ${Object.entries(STATUS_LABEL).map(([k, v]) => `<option value="${k}" ${k === status ? 'selected' : ''}>${v}</option>`).join('')}
        </select></label>
      <div class="scroll"><table style="margin-top:12px">
        <tr><th>#</th><th>Date</th><th>Customer</th><th>Unit</th><th>Complaint</th><th>Status</th><th class="num">Total</th></tr>
        ${wos.map((w) => `<tr class="click" data-act="open" data-id="${w.id}">
          <td>${w.number}</td><td>${fmtDate(w.created_at)}</td><td>${esc(w.customer_name)}</td><td>${esc(w.unit)}</td>
          <td class="muted">${esc(w.complaint.slice(0, 70))}</td><td>${badge(w.status)}</td><td class="num">${usd(w.total)}</td></tr>`).join('')}
      </table></div>
      ${wos.length ? '' : '<p class="muted">No work orders yet.</p>'}
    </div>`, {
    click: (act, t) => act === 'open' && go(`#/wo/${t.dataset.id}`),
    change: (el) => el.id === 'statusFilter' && go('#/work-orders' + (el.value ? `?status=${el.value}` : '')),
  });
}

// ---------- New work order ----------
async function newWorkOrder() {
  const pre = new URLSearchParams(location.hash.split('?')[1]).get('customer');
  const customers = await api('/customers');
  let units = [];
  const unitOptions = () => `<option value="">— No unit —</option>${units.map((u) => `<option value="${u.id}">${esc(unitLabel(u))}</option>`).join('')}`;
  page(`
    <h1>New work order</h1>
    <form class="panel" id="newwo">
      <div class="row">
        <label>Customer
          <select name="customer_id" id="cust" required><option value="">Choose…</option>
            ${customers.map((c) => `<option value="${c.id}" ${String(c.id) === pre ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
          </select></label>
        <label>Unit <select name="unit_id" id="unit">${unitOptions()}</select></label>
        <label>Mileage / hours <input name="mileage" type="number" inputmode="numeric"></label>
        <label>Customer PO # <input name="po_number"></label>
      </div>
      <p class="muted" style="margin:8px 0 0">No customer yet? <a href="#/customers">Add one first</a>.</p>
      <label style="margin-top:12px">Complaints — one per line (each becomes a job)
        <textarea name="complaints" rows="5" placeholder="PM service A&#10;Check engine light on&#10;Air leak at rear axle"></textarea></label>
      <p><button class="primary">Create work order</button></p>
    </form>`, {
    change: async (el) => {
      if (el.id !== 'cust') return;
      units = el.value ? (await api(`/customers/${el.value}`)).units : [];
      $('#unit').innerHTML = unitOptions();
      if (units.length === 1) $('#unit').value = units[0].id;
    },
    submit: async (form) => {
      const d = formData(form);
      const wo = await api('/work-orders', { body: {
        customer_id: Number(d.customer_id), unit_id: d.unit_id ? Number(d.unit_id) : null,
        mileage: d.mileage ? Number(d.mileage) : undefined, po_number: d.po_number, complaints: d.complaints.split('\n'),
      } });
      go(`#/wo/${wo.id}`);
    },
  });
  if (pre) $('#cust').dispatchEvent(new Event('change', { bubbles: true }));
}

// ---------- Work order detail ----------
async function workOrderDetail(id) {
  const [wo, techs, parts, s] = await Promise.all([api(`/work-orders/${id}`), api('/technicians'), api('/parts'), getSettings()]);
  const locked = wo.status === 'invoiced' || wo.status === 'paid';
  const dis = locked ? 'disabled' : '';
  const techOpts = (sel) => `<option value="">Unassigned</option>${techs.filter((t) => t.active || t.id === sel).map((t) => `<option value="${t.id}" ${t.id === sel ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}`;
  const toLocal = (iso) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');

  const jobHtml = (j, i) => `
    <div class="job ${j.done ? 'done' : ''}" data-job="${j.id}">
      <div class="spread"><b>Job ${i + 1}</b>
        <span><label style="display:inline"><input type="checkbox" data-field="done" ${j.done ? 'checked' : ''} ${dis} style="width:auto"> Done</label>
        ${locked ? '' : `<button class="small danger" data-act="del-job" data-id="${j.id}">Remove job</button>`}</span></div>
      <div class="row" style="margin-top:8px">
        <label>Complaint<textarea data-field="complaint" ${dis}>${esc(j.complaint)}</textarea></label>
        <label>Cause<textarea data-field="cause" ${dis}>${esc(j.cause)}</textarea></label>
        <label>Correction<textarea data-field="correction" ${dis}>${esc(j.correction)}</textarea></label>
      </div>
      <div class="row" style="margin-top:8px">
        <label>Tech<select data-field="tech_id" ${dis}>${techOpts(j.tech_id)}</select></label>
        <label>Estimated hrs<input type="number" step="0.1" min="0" data-field="estimated_hours" value="${j.estimated_hours}" ${dis}></label>
        <label>Billed hrs <span class="muted">(clocked ${j.clocked_hours})</span>
          <input type="number" step="0.1" min="0" data-field="billed_hours" value="${j.billed_hours ?? ''}" placeholder="${j.clocked_hours || j.estimated_hours}" ${dis}></label>
        <label>Labor<input value="${usd(j.labor_total)}" disabled></label>
      </div>
      ${j.time.length ? `<details style="margin-top:10px"><summary class="muted">Time punches (${j.time.length})</summary>
        <table>${j.time.map((e) => `<tr data-entry="${e.id}"><td>${esc(e.tech_name)}</td>
          <td><input type="datetime-local" data-time="clock_in" value="${toLocal(e.clock_in)}" ${dis}></td>
          <td>${e.clock_out ? `<input type="datetime-local" data-time="clock_out" value="${toLocal(e.clock_out)}" ${dis}>` : '<span class="badge in_progress">On the clock</span>'}</td>
          <td>${locked ? '' : `<button class="small danger" data-act="del-time" data-id="${e.id}">✕</button>`}</td></tr>`).join('')}</table></details>` : ''}
      <h2 style="margin-top:14px;font-size:15px">Parts</h2>
      <table>
        ${j.parts.map((p) => `<tr><td>${esc(p.part_number)}</td><td>${esc(p.description)}</td><td class="num">${p.qty}</td>
          <td class="num">${usd(p.unit_price)}</td><td class="num">${usd(p.qty * p.unit_price)}</td>
          <td>${locked ? '' : `<button class="small danger" data-act="del-part" data-id="${p.id}">✕</button>`}</td></tr>`).join('')}
        ${locked ? '' : `<tr class="addpart">
          <td colspan="2"><input list="partlist" data-np="part" placeholder="Search inventory or type a part"></td>
          <td><input type="number" step="any" min="0" data-np="qty" value="1" style="max-width:80px"></td>
          <td><input type="number" step="0.01" min="0" data-np="price" placeholder="Price" style="max-width:110px"></td>
          <td colspan="2"><button class="small" data-act="add-part" data-id="${j.id}">Add</button></td></tr>`}
      </table>
      <div class="muted" style="text-align:right;margin-top:6px">Job total ${usd(j.labor_total + j.parts_total)}</div>
    </div>`;

  page(`
    <datalist id="partlist">${parts.map((p) => `<option value="${esc(p.part_number)} — ${esc(p.description)}">${p.qty_on_hand} on hand · ${usd(p.sell_price)}</option>`).join('')}</datalist>
    <div class="spread">
      <h1>Work order #${wo.number} ${badge(wo.status)}</h1>
      <div class="noprint" style="display:flex;gap:8px;flex-wrap:wrap">
        <a class="btn" href="#/print/${wo.id}">${locked ? 'Print invoice' : 'Print estimate'}</a>
        ${wo.status === 'completed' ? '<button class="primary" data-act="status" data-s="invoiced">Create invoice</button>' : ''}
        ${wo.status === 'invoiced' ? '<button class="primary" data-act="status" data-s="paid">Mark paid</button>' : ''}
        ${locked ? '<button data-act="status" data-s="completed">Reopen</button>' : '<button class="danger" data-act="del-wo">Delete</button>'}
      </div>
    </div>
    <div class="grid2">
      <div>
        <div class="panel">
          <div class="row">
            <div><label>Customer</label><a href="#/customer/${wo.customer_id}"><b>${esc(wo.customer_name)}</b></a><div class="muted">${esc(wo.customer_phone)}</div></div>
            <div><label>Unit</label><b>${esc(unitLabel(wo)) || '—'}</b><div class="muted">${esc(wo.vin)}</div></div>
            <label>Status<select id="status">${Object.entries(STATUS_LABEL).map(([k, v]) => `<option value="${k}" ${k === wo.status ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          </div>
          <div class="row" style="margin-top:10px">
            <label>Mileage / hours<input type="number" data-wo="mileage" value="${wo.mileage ?? ''}" ${dis}></label>
            <label>Customer PO #<input data-wo="po_number" value="${esc(wo.po_number)}" ${dis}></label>
            <label>Opened<input value="${fmtDate(wo.created_at)}" disabled></label>
          </div>
          <label style="margin-top:10px">Notes (internal)<textarea data-wo="notes">${esc(wo.notes)}</textarea></label>
        </div>
        ${wo.jobs.map(jobHtml).join('')}
        ${locked ? '' : `<div class="panel"><div class="row"><label>Add a job — complaint<input id="newjob" placeholder="e.g. Replace front brake chambers"></label>
          <div style="flex:0 0 auto"><button data-act="add-job">Add job</button></div></div></div>`}
      </div>
      <div class="panel" style="position:sticky;top:12px">
        <h2>Totals</h2>
        <table class="totals">
          <tr><td>Labor (${wo.totals.hours} hrs @ ${usd(s.labor_rate)})</td><td class="num">${usd(wo.totals.labor)}</td></tr>
          <tr><td>Parts</td><td class="num">${usd(wo.totals.parts)}</td></tr>
          <tr><td>Shop supplies</td><td class="num">${usd(wo.totals.supplies)}</td></tr>
          <tr><td>Tax</td><td class="num">${usd(wo.totals.tax)}</td></tr>
          <tr class="grand"><td>Total</td><td class="num">${usd(wo.totals.total)}</td></tr>
        </table>
        ${wo.invoiced_at ? `<p class="muted">Invoiced ${fmtTime(wo.invoiced_at)}${wo.paid_at ? ` · Paid ${fmtTime(wo.paid_at)}` : ''}</p>` : ''}
      </div>
    </div>`, {
    click: async (act, t) => {
      const reload = () => workOrderDetail(id);
      if (act === 'status') { await api(`/work-orders/${id}`, { method: 'PUT', body: { status: t.dataset.s } }); return reload(); }
      if (act === 'del-wo') {
        if (!confirm(`Delete work order #${wo.number}? Stocked parts go back into inventory.`)) return;
        await api(`/work-orders/${id}`, { method: 'DELETE' }); return go('#/work-orders');
      }
      if (act === 'add-job') {
        const v = $('#newjob').value.trim(); if (!v) return;
        await api(`/work-orders/${id}/jobs`, { body: { complaint: v } }); return reload();
      }
      if (act === 'del-job') { if (!confirm('Remove this job and its parts and time?')) return; await api(`/jobs/${t.dataset.id}`, { method: 'DELETE' }); return reload(); }
      if (act === 'del-part') { await api(`/part-lines/${t.dataset.id}`, { method: 'DELETE' }); return reload(); }
      if (act === 'del-time') { if (!confirm('Delete this time punch?')) return; await api(`/time-entries/${t.dataset.id}`, { method: 'DELETE' }); return reload(); }
      if (act === 'add-part') {
        const row = t.closest('tr');
        const text = row.querySelector('[data-np=part]').value.trim();
        if (!text) return;
        const qty = Number(row.querySelector('[data-np=qty]').value) || 1;
        const price = row.querySelector('[data-np=price]').value;
        const stocked = parts.find((p) => text === `${p.part_number} — ${p.description}` || text.toLowerCase() === p.part_number.toLowerCase());
        const body = stocked ? { part_id: stocked.id, qty, unit_price: price } : { description: text, qty, unit_price: price };
        if (!stocked && price === '') { toast('Enter a price for a part that is not in inventory', true); return; }
        await api(`/jobs/${t.dataset.id}/parts`, { body }); return reload();
      }
    },
    change: async (el) => {
      if (el.id === 'status') { await api(`/work-orders/${id}`, { method: 'PUT', body: { status: el.value } }); return workOrderDetail(id); }
      if (el.dataset.wo) { await api(`/work-orders/${id}`, { method: 'PUT', body: { [el.dataset.wo]: el.value } }); return toast('Saved'); }
      if (el.dataset.time) {
        await api(`/time-entries/${el.closest('[data-entry]').dataset.entry}`, { method: 'PUT', body: { [el.dataset.time]: el.value } });
        return workOrderDetail(id);
      }
      if (el.dataset.field) {
        const jobId = el.closest('[data-job]').dataset.job;
        const v = el.type === 'checkbox' ? el.checked : el.value;
        await api(`/jobs/${jobId}`, { method: 'PUT', body: { [el.dataset.field]: v } });
        if (['complaint', 'cause', 'correction'].includes(el.dataset.field)) return toast('Saved');
        return workOrderDetail(id);
      }
    },
  });
}

// ---------- Printable estimate / invoice ----------
async function printView(id) {
  const [wo, s] = await Promise.all([api(`/work-orders/${id}`), getSettings()]);
  const isInvoice = wo.status === 'invoiced' || wo.status === 'paid';
  page(`
    <p class="noprint"><a href="#/wo/${wo.id}">← Back to work order</a> &nbsp; <button class="primary" data-act="print">Print</button></p>
    <div class="doc">
      <div class="head">
        <div><h1>${esc(s.shop_name)}</h1><div class="muted" style="white-space:pre-line">${esc(s.shop_address)}\n${esc(s.shop_phone)}</div></div>
        <div style="text-align:right"><h1>${isInvoice ? 'INVOICE' : 'ESTIMATE'}</h1>
          <div>#${wo.number}</div><div class="muted">${fmtDate(wo.invoiced_at || wo.created_at)}</div>
          ${wo.paid_at ? '<div><b>PAID</b></div>' : ''}</div>
      </div>
      <div class="row" style="margin-bottom:16px">
        <div><label>Bill to</label><b>${esc(wo.customer_name)}</b><div style="white-space:pre-line">${esc(wo.customer_address)}</div><div>${esc(wo.customer_phone)}</div></div>
        <div><label>Unit</label>${esc(unitLabel(wo))}<div>${wo.vin ? 'VIN ' + esc(wo.vin) : ''}</div><div>${wo.mileage ? 'Mileage ' + Number(wo.mileage).toLocaleString() : ''}</div>
          ${wo.po_number ? `<div>PO ${esc(wo.po_number)}</div>` : ''}</div>
      </div>
      ${wo.jobs.map((j, i) => `<div class="job-block">
        <b>${i + 1}. ${esc(j.complaint)}</b>
        ${j.cause ? `<div><span class="muted">Cause:</span> ${esc(j.cause)}</div>` : ''}
        ${j.correction ? `<div><span class="muted">Correction:</span> ${esc(j.correction)}</div>` : ''}
        <table style="margin-top:6px">
          <tr><th>Item</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Amount</th></tr>
          <tr><td>Labor</td><td class="num">${j.hours}</td><td class="num">${usd(s.labor_rate)}</td><td class="num">${usd(j.labor_total)}</td></tr>
          ${j.parts.map((p) => `<tr><td>${esc([p.part_number, p.description].filter(Boolean).join(' — '))}</td><td class="num">${p.qty}</td><td class="num">${usd(p.unit_price)}</td><td class="num">${usd(p.qty * p.unit_price)}</td></tr>`).join('')}
        </table></div>`).join('')}
      <table class="totals" style="max-width:320px;margin-left:auto;margin-top:16px">
        <tr><td>Labor</td><td class="num">${usd(wo.totals.labor)}</td></tr>
        <tr><td>Parts</td><td class="num">${usd(wo.totals.parts)}</td></tr>
        <tr><td>Shop supplies</td><td class="num">${usd(wo.totals.supplies)}</td></tr>
        <tr><td>Tax</td><td class="num">${usd(wo.totals.tax)}</td></tr>
        <tr class="grand"><td>Total</td><td class="num">${usd(wo.totals.total)}</td></tr>
      </table>
      <p class="muted" style="margin-top:24px">${esc(s.invoice_terms)}</p>
      ${isInvoice ? '' : '<p style="margin-top:32px">Approved by: ______________________ &nbsp; Date: __________</p>'}
    </div>`, { click: (act) => act === 'print' && window.print() });
}

// ---------- Customers ----------
async function customers() {
  const list = await api('/customers');
  page(`
    <h1>Customers</h1>
    <form class="panel" id="addcust"><h2>Add customer</h2>
      <div class="row">
        <label>Company / name<input name="name" required></label>
        <label>Contact<input name="contact"></label>
        <label>Phone<input name="phone" type="tel"></label>
        <label>Email<input name="email" type="email"></label>
        <div style="flex:0 0 auto"><button class="primary">Add</button></div>
      </div></form>
    <div class="panel"><input id="q" placeholder="Search customers…">
      <div class="scroll"><table style="margin-top:10px"><tr><th>Name</th><th>Contact</th><th>Phone</th><th class="num">Units</th></tr>
        ${list.map((c) => `<tr class="click" data-act="open" data-id="${c.id}" data-search="${esc((c.name + ' ' + c.contact + ' ' + c.phone).toLowerCase())}">
          <td>${esc(c.name)}</td><td>${esc(c.contact)}</td><td>${esc(c.phone)}</td><td class="num">${c.unit_count}</td></tr>`).join('')}
      </table></div></div>`, {
    click: (act, t) => act === 'open' && go(`#/customer/${t.dataset.id}`),
    submit: async (form) => { const c = await api('/customers', { body: formData(form) }); go(`#/customer/${c.id}`); },
  });
  $('#q').oninput = (e) => {
    const q = e.target.value.toLowerCase();
    view.querySelectorAll('tr[data-search]').forEach((tr) => { tr.hidden = !tr.dataset.search.includes(q); });
  };
}

async function customerDetail(id) {
  const c = await api(`/customers/${id}`);
  page(`
    <div class="spread"><h1>${esc(c.name)}</h1><a class="btn primary" href="#/new?customer=${c.id}">+ New work order</a></div>
    <div class="panel" id="custform"><div class="row">
      <label>Company / name<input name="name" value="${esc(c.name)}"></label>
      <label>Contact<input name="contact" value="${esc(c.contact)}"></label>
      <label>Phone<input name="phone" value="${esc(c.phone)}"></label>
      <label>Email<input name="email" value="${esc(c.email)}"></label>
    </div><label style="margin-top:10px">Billing address<textarea name="address">${esc(c.address)}</textarea></label></div>
    <div class="panel"><h2>Units</h2>
      <div class="scroll"><table><tr><th>Unit #</th><th>Year</th><th>Make</th><th>Model</th><th>VIN</th><th>Plate</th><th>Mileage</th><th></th></tr>
        ${c.units.map((u) => `<tr data-unit="${u.id}">${['unit_number', 'year', 'make', 'model', 'vin', 'plate', 'mileage'].map((f) => `<td><input data-uf="${f}" value="${esc(u[f])}"></td>`).join('')}
          <td><button class="small danger" data-act="del-unit" data-id="${u.id}">✕</button></td></tr>`).join('')}
        <tr id="newunit">${['unit_number', 'year', 'make', 'model', 'vin', 'plate', 'mileage'].map((f) => `<td><input name="${f}" placeholder="${f.replace('_', ' ')}"></td>`).join('')}
          <td><button class="small" data-act="add-unit">Add</button></td></tr>
      </table></div></div>
    <div class="panel"><h2>Work orders</h2>
      ${c.work_orders.length ? `<table>${c.work_orders.map((w) => `<tr class="click" data-act="wo" data-id="${w.id}"><td>#${w.number}</td><td>${fmtDate(w.created_at)}</td><td>${badge(w.status)}</td></tr>`).join('')}</table>` : '<p class="muted">None yet.</p>'}
    </div>
    <button class="danger" data-act="del-cust">Delete customer</button>`, {
    click: async (act, t) => {
      if (act === 'wo') return go(`#/wo/${t.dataset.id}`);
      if (act === 'add-unit') {
        const d = formData($('#newunit'));
        if (d.mileage === '') delete d.mileage;
        await api('/units', { body: { ...d, customer_id: c.id } }); return customerDetail(id);
      }
      if (act === 'del-unit') { if (!confirm('Delete this unit?')) return; await api(`/units/${t.dataset.id}`, { method: 'DELETE' }); return customerDetail(id); }
      if (act === 'del-cust') { if (!confirm(`Delete ${c.name}?`)) return; await api(`/customers/${c.id}`, { method: 'DELETE' }); return go('#/customers'); }
    },
    change: async (el) => {
      if (el.closest('#custform')) { await api(`/customers/${c.id}`, { method: 'PUT', body: { [el.name]: el.value } }); return toast('Saved'); }
      if (el.dataset.uf) { await api(`/units/${el.closest('[data-unit]').dataset.unit}`, { method: 'PUT', body: { [el.dataset.uf]: el.value } }); return toast('Saved'); }
    },
  });
}

// ---------- Parts ----------
async function partsPage() {
  const list = await api('/parts');
  const F = ['part_number', 'description', 'vendor', 'cost', 'price', 'qty_on_hand', 'reorder_at'];
  const num = (f) => ['cost', 'price', 'qty_on_hand', 'reorder_at'].includes(f);
  page(`
    <h1>Parts inventory</h1>
    <div class="panel"><input id="q" placeholder="Search parts…">
      <p class="muted" style="margin:8px 0 0">Leave <b>Price</b> blank to use cost + your parts markup. Changes save when you leave a field.</p>
      <div class="scroll"><table style="margin-top:10px">
        <tr><th>Part #</th><th>Description</th><th>Vendor</th><th>Cost</th><th>Price</th><th>On hand</th><th>Reorder at</th><th class="num">Sells for</th><th></th></tr>
        ${list.map((p) => `<tr data-part="${p.id}" data-search="${esc((p.part_number + ' ' + p.description + ' ' + p.vendor).toLowerCase())}">
          ${F.map((f) => `<td><input data-pf="${f}" ${num(f) ? 'type="number" step="any"' : ''} value="${esc(p[f])}"></td>`).join('')}
          <td class="num">${usd(p.sell_price)} ${p.low ? '<span class="badge low">Low</span>' : ''}</td>
          <td><button class="small danger" data-act="del" data-id="${p.id}">✕</button></td></tr>`).join('')}
        <tr id="newpart">${F.map((f) => `<td><input name="${f}" ${num(f) ? 'type="number" step="any"' : ''} placeholder="${f.replace(/_/g, ' ')}"></td>`).join('')}
          <td></td><td><button class="small primary" data-act="add">Add</button></td></tr>
      </table></div></div>`, {
    click: async (act, t) => {
      if (act === 'add') {
        const d = formData($('#newpart'));
        for (const f of F) if (num(f)) d[f] = d[f] === '' ? (f === 'price' ? null : 0) : Number(d[f]);
        await api('/parts', { body: d }); return partsPage();
      }
      if (act === 'del') { if (!confirm('Delete this part?')) return; await api(`/parts/${t.dataset.id}`, { method: 'DELETE' }); return partsPage(); }
    },
    change: async (el) => {
      if (!el.dataset.pf) return;
      const f = el.dataset.pf;
      const v = num(f) ? (el.value === '' ? (f === 'price' ? null : 0) : Number(el.value)) : el.value;
      await api(`/parts/${el.closest('[data-part]').dataset.part}`, { method: 'PUT', body: { [f]: v } });
      toast('Saved');
    },
  });
  $('#q').oninput = (e) => {
    const q = e.target.value.toLowerCase();
    view.querySelectorAll('tr[data-search]').forEach((tr) => { tr.hidden = !tr.dataset.search.includes(q); });
  };
}

// ---------- Techs ----------
async function techsPage() {
  const list = await api('/technicians');
  page(`
    <h1>Technicians</h1>
    <form class="panel" id="addtech"><h2>Add tech</h2><div class="row">
      <label>Name<input name="name" required></label>
      <label>Tablet PIN (4–6 digits)<input name="pin" inputmode="numeric" pattern="\\d{4,6}" required></label>
      <div style="flex:0 0 auto"><button class="primary">Add</button></div></div></form>
    <div class="panel"><table><tr><th>Name</th><th>Status</th><th>Active</th><th>Change PIN</th></tr>
      ${list.map((t) => `<tr data-tech="${t.id}"><td><input data-tf="name" value="${esc(t.name)}"></td>
        <td>${t.on_work_order ? `<span class="badge in_progress">On WO #${1000 + t.on_work_order}</span>` : '<span class="muted">Off the clock</span>'}</td>
        <td><input type="checkbox" data-tf="active" ${t.active ? 'checked' : ''} style="width:auto"></td>
        <td><input data-tf="pin" inputmode="numeric" placeholder="New PIN" style="max-width:140px"></td></tr>`).join('')}
    </table></div>`, {
    submit: async (form) => { await api('/technicians', { body: formData(form) }); techsPage(); },
    change: async (el) => {
      if (!el.dataset.tf) return;
      const v = el.type === 'checkbox' ? el.checked : el.value;
      await api(`/technicians/${el.closest('[data-tech]').dataset.tech}`, { method: 'PUT', body: { [el.dataset.tf]: v } });
      if (el.dataset.tf === 'pin') el.value = '';
      toast('Saved');
    },
  });
}

// ---------- Settings ----------
async function settingsPage() {
  const s = await api('/settings');
  const f = (name, label, attrs = '') => `<label>${label}<input name="${name}" value="${esc(s[name])}" ${attrs}></label>`;
  page(`
    <h1>Shop settings</h1>
    <form class="panel" id="settings">
      <h2>Shop</h2>
      <div class="row">${f('shop_name', 'Shop name')}${f('shop_phone', 'Phone')}</div>
      <label style="margin-top:10px">Address (shown on estimates & invoices)<textarea name="shop_address">${esc(s.shop_address)}</textarea></label>
      <h2 style="margin-top:20px">Pricing</h2>
      <div class="row">
        ${f('labor_rate', 'Labor rate ($/hr)', 'type="number" step="0.01"')}
        ${f('parts_markup_pct', 'Parts markup (%)', 'type="number" step="0.1"')}
        ${f('shop_supplies_pct', 'Shop supplies (% of labor)', 'type="number" step="0.1"')}
        ${f('shop_supplies_cap', 'Shop supplies cap ($, 0 = none)', 'type="number" step="0.01"')}
        ${f('tax_rate_pct', 'Sales tax (%)', 'type="number" step="0.001"')}
      </div>
      <label style="margin-top:10px"><input type="checkbox" name="tax_labor" ${s.tax_labor ? 'checked' : ''} style="width:auto"> Charge tax on labor too</label>
      <label style="margin-top:10px">Invoice terms<textarea name="invoice_terms">${esc(s.invoice_terms)}</textarea></label>
      <p><button class="primary">Save settings</button></p>
    </form>`, {
    submit: async (form) => {
      const d = formData(form);
      for (const k of ['labor_rate', 'parts_markup_pct', 'shop_supplies_pct', 'shop_supplies_cap', 'tax_rate_pct']) d[k] = Number(d[k]) || 0;
      settingsCache = await api('/settings', { method: 'PUT', body: d });
      $('#brand').textContent = settingsCache.shop_name;
      toast('Settings saved');
    },
  });
}

// ---------- Router ----------
const routes = [
  [/^#?\/?$/, board],
  [/^#\/work-orders/, workOrders],
  [/^#\/new/, newWorkOrder],
  [/^#\/wo\/(\d+)/, workOrderDetail],
  [/^#\/print\/(\d+)/, printView],
  [/^#\/customers/, customers],
  [/^#\/customer\/(\d+)/, customerDetail],
  [/^#\/parts/, partsPage],
  [/^#\/techs/, techsPage],
  [/^#\/settings/, settingsPage],
];
async function route() {
  const hash = location.hash || '#/';
  const section = hash.replace(/^#\/?/, '').split(/[/?]/)[0];
  const navKey = { wo: 'work-orders', new: 'work-orders', print: 'work-orders', customer: 'customers' }[section] ?? section;
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === navKey));
  for (const [re, fn] of routes) {
    const m = hash.match(re);
    if (m) { await run(() => fn(m[1])); window.scrollTo(0, 0); return; }
  }
  view.innerHTML = '<p>Page not found.</p>';
}
window.addEventListener('hashchange', route);
getSettings().then((s) => { $('#brand').textContent = s.shop_name; document.title = `${s.shop_name} — Office`; }).catch(() => {});
route();
