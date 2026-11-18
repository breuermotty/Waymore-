import { api, esc, $, unitLabel, fmtTime, toast } from './common.js';

const view = $('#view');
let tech = null;
let idleTimer;

// Log the tech out after 3 minutes without a tap, so the shared tablet is ready for the next person.
function resetIdle() {
  clearTimeout(idleTimer);
  if (tech) idleTimer = setTimeout(logout, 3 * 60 * 1000);
}
document.addEventListener('pointerdown', resetIdle);
function logout() { tech = null; pinScreen(); }

async function act(fn) { try { await fn(); } catch (e) { toast(e.message, true); } }

function pinScreen() {
  let pin = '';
  view.innerHTML = `
    <h1 style="text-align:center;margin-top:24px">Enter your PIN</h1>
    <div class="pindots" id="dots"></div>
    <div class="pinpad">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 'C', 0, 'OK'].map((k) => `<button data-k="${k}" ${k === 'OK' ? 'class="primary"' : ''}>${k}</button>`).join('')}</div>`;
  const show = () => { $('#dots').textContent = '•'.repeat(pin.length); };
  view.onclick = (e) => {
    const k = e.target.dataset.k; if (k === undefined) return;
    if (k === 'C') pin = '';
    else if (k === 'OK') return act(async () => { tech = await api('/tech/login', { body: { pin } }); resetIdle(); jobList(); }).finally(() => { pin = ''; show(); });
    else if (pin.length < 6) pin += k;
    show();
  };
}

async function jobList() {
  const { active, jobs } = await api(`/tech/${tech.id}/jobs`);
  const activeJob = active && jobs.find((j) => j.id === active.job_id);
  const card = (j) => `
    <div class="panel" style="${j.id === active?.job_id ? 'border:2px solid #f0a020' : ''}">
      <div class="spread"><b>WO #${j.number} · ${esc(j.customer_name)}</b><span class="muted">${esc(unitLabel(j))}</span></div>
      <div style="margin:6px 0 10px">${esc(j.complaint)} ${j.done ? '<span class="badge completed">Done</span>' : ''} ${j.tech_id ? '' : '<span class="badge">Unassigned</span>'}</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        ${j.id === active?.job_id ? '<button data-a="out">Clock out</button>' : `<button class="primary" data-a="in" data-id="${j.id}">Clock in</button>`}
        <button data-a="open" data-id="${j.id}">Notes &amp; parts</button>
      </div>
    </div>`;
  view.innerHTML = `
    <div class="spread"><h1>Hi, ${esc(tech.name)}</h1><button data-a="logout">Log out</button></div>
    <div class="clockbar ${activeJob || active ? '' : 'idle'}">
      ${active ? `On the clock since ${fmtTime(active.clock_in)}${activeJob ? ` — WO #${activeJob.number}: ${esc(activeJob.complaint)}` : ''}` : 'You are not clocked in.'}
    </div>
    ${jobs.length ? jobs.map(card).join('') : '<p class="muted">No open jobs. Ask the office to approve a work order.</p>'}`;
  view.onclick = (e) => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    act(async () => {
      if (b.dataset.a === 'logout') return logout();
      if (b.dataset.a === 'in') { await api(`/jobs/${b.dataset.id}/clock-in`, { body: { tech_id: tech.id } }); toast('Clocked in'); return jobList(); }
      if (b.dataset.a === 'out') { await api(`/tech/${tech.id}/clock-out`, { body: {} }); toast('Clocked out'); return jobList(); }
      if (b.dataset.a === 'open') return jobDetail(Number(b.dataset.id));
    });
  };
}

async function jobDetail(jobId) {
  const [{ active, jobs }, parts] = await Promise.all([api(`/tech/${tech.id}/jobs`), api('/parts')]);
  const j0 = jobs.find((j) => j.id === jobId);
  if (!j0) return jobList();
  const wo = await api(`/work-orders/${j0.work_order_id}`);
  const j = wo.jobs.find((x) => x.id === jobId);
  const onThis = active?.job_id === jobId;
  view.innerHTML = `
    <p><button data-a="back">← All jobs</button></p>
    <h1>WO #${wo.number} · ${esc(wo.customer_name)}</h1>
    <p class="muted">${esc(unitLabel(wo))} ${wo.vin ? '· VIN ' + esc(wo.vin) : ''} ${wo.mileage ? '· ' + Number(wo.mileage).toLocaleString() + ' mi' : ''}</p>
    <div class="panel">
      <label>Complaint</label><p style="margin:4px 0 12px"><b>${esc(j.complaint)}</b></p>
      <label>Cause<textarea id="cause" rows="3">${esc(j.cause)}</textarea></label>
      <label style="margin-top:10px">Correction<textarea id="correction" rows="3">${esc(j.correction)}</textarea></label>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px">
        <button class="primary" data-a="save">Save notes</button>
        ${onThis ? '<button data-a="out">Clock out</button>' : '<button data-a="in">Clock in</button>'}
        <button data-a="done">${j.done ? 'Mark not done' : 'Mark job done'}</button>
      </div>
    </div>
    <div class="panel"><h2>Parts used</h2>
      ${j.parts.length ? `<table>${j.parts.map((p) => `<tr><td>${esc(p.part_number)} ${esc(p.description)}</td><td class="num">× ${p.qty}</td></tr>`).join('')}</table>` : '<p class="muted">None yet.</p>'}
      <datalist id="partlist">${parts.map((p) => `<option value="${esc(p.part_number)} — ${esc(p.description)}">${p.qty_on_hand} on hand</option>`).join('')}</datalist>
      <div class="row" style="margin-top:10px">
        <label>Part<input id="part" list="partlist" placeholder="Search part #"></label>
        <label style="flex:0 0 110px">Qty<input id="qty" type="number" step="any" min="0" value="1"></label>
        <div style="flex:0 0 auto"><button data-a="addpart">Add part</button></div>
      </div>
      <p class="muted" style="font-size:14px">Not in the list? Tell the office so they can price it.</p>
    </div>`;
  view.onclick = (e) => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    act(async () => {
      const a = b.dataset.a;
      if (a === 'back') return jobList();
      if (a === 'save') { await api(`/jobs/${jobId}`, { method: 'PUT', body: { cause: $('#cause').value, correction: $('#correction').value } }); return toast('Saved'); }
      if (a === 'in') { await api(`/jobs/${jobId}/clock-in`, { body: { tech_id: tech.id } }); toast('Clocked in'); return jobDetail(jobId); }
      if (a === 'out') { await api(`/tech/${tech.id}/clock-out`, { body: {} }); toast('Clocked out'); return jobDetail(jobId); }
      if (a === 'done') {
        await api(`/jobs/${jobId}`, { method: 'PUT', body: { done: !j.done, cause: $('#cause').value, correction: $('#correction').value } });
        if (!j.done && onThis) await api(`/tech/${tech.id}/clock-out`, { body: {} });
        toast(j.done ? 'Reopened' : 'Job done'); return jobList();
      }
      if (a === 'addpart') {
        const text = $('#part').value.trim();
        const p = parts.find((x) => text === `${x.part_number} — ${x.description}` || text.toLowerCase() === x.part_number.toLowerCase());
        if (!p) return toast('Pick a part from the list', true);
        await api(`/jobs/${jobId}/parts`, { body: { part_id: p.id, qty: Number($('#qty').value) || 1 } });
        toast('Part added'); return jobDetail(jobId);
      }
    });
  };
}

pinScreen();
