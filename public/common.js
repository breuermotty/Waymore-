// Small helpers shared by the office app and the tech tablet app.
export async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    method: opts.method || (opts.body ? 'POST' : 'GET'),
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
export const $ = (sel, root = document) => root.querySelector(sel);
export const usd = (n) => (Number(n) || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
export const STATUS_LABEL = {
  estimate: 'Estimate', approved: 'Approved', in_progress: 'In progress', waiting_parts: 'Waiting on parts',
  completed: 'Completed', invoiced: 'Invoiced', paid: 'Paid',
};
export const badge = (s) => `<span class="badge ${esc(s)}">${esc(STATUS_LABEL[s] || s)}</span>`;
export const unitLabel = (u) => [u.unit_number && `#${u.unit_number}`, u.year, u.make, u.model].filter(Boolean).join(' ');
export const fmtDate = (d) => (d ? new Date(d.includes('T') ? d : d.replace(' ', 'T') + 'Z').toLocaleDateString() : '');
export const fmtTime = (d) => (d ? new Date(d).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

export function toast(msg, isErr = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (isErr ? ' err' : '');
  t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), isErr ? 4000 : 1800);
}

// Read all named fields in a container into an object.
export function formData(root) {
  const out = {};
  root.querySelectorAll('[name]').forEach((el) => {
    out[el.name] = el.type === 'checkbox' ? el.checked : el.value;
  });
  return out;
}
