import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { WO_STATUSES, WO_STATUS_LABELS, WO_TRANSITIONS, type WorkOrderStatus } from '../../../shared/constants';
import { formatMoney } from '../../../shared/money';
import { api } from '../api';
import { useAuth } from '../auth';
import {
  Badge,
  Card,
  Empty,
  ErrorBox,
  Field,
  Loading,
  Modal,
  MoneyInput,
  PageHeader,
  PriorityBadge,
  SearchInput,
  StatusBadge,
  Tabs,
  fmtDate,
  fmtHours,
  fmtNum,
  toast,
  unitLabel,
  useAction,
  useApi,
  useDebounced,
} from '../ui';

const LINE_TONE: Record<string, string> = { pending: 'warn', approved: 'good', declined: 'bad' };

export default function WorkOrderDetail() {
  const { id } = useParams();
  const { data: wo, setData, error, reload } = useApi<any>(`/work-orders/${id}`, [id]);
  const { data: staff } = useApi<any[]>('/staff');
  const { data: current, reload: reloadClock } = useApi<any>('/time/current');
  const { user, can } = useAuth();
  const nav = useNavigate();
  const { busy, run } = useAction();
  const [lineModal, setLineModal] = useState<any | null>(null);
  const [partModal, setPartModal] = useState<any | null>(null);
  const [authModal, setAuthModal] = useState(false);
  const [sendModal, setSendModal] = useState<string | null>(null);
  const [tab, setTab] = useState<'notes' | 'files' | 'inspections'>('notes');

  if (error) return <ErrorBox error={error} />;
  if (!wo) return <Loading />;

  const status = wo.status as WorkOrderStatus;
  const locked = status === 'invoiced';
  const isWriter = can('service_writer');
  const isParts = can('service_writer', 'parts_manager');
  const isTech = user!.role === 'technician';
  const techs = (staff ?? []).filter((s) => s.role === 'technician');
  const openForWork = ['approved', 'in_progress', 'waiting_parts'].includes(status);
  const update = (p: Promise<any>, msg?: string) => run(async () => setData({ ...wo, ...(await p) }), msg);

  const setStatus = (s: WorkOrderStatus) => update(api.post(`/work-orders/${wo.id}/status`, { status: s }), `Moved to ${WO_STATUS_LABELS[s]}`);
  const clockIn = (lineId: number) =>
    run(async () => {
      await api.post(`/lines/${lineId}/clock-in`);
      await Promise.all([reload(), reloadClock()]);
    }, 'Clocked in');
  const clockOut = () =>
    run(async () => {
      await api.post('/time/clock-out');
      await Promise.all([reload(), reloadClock()]);
    }, 'Clocked out');

  const flowIdx = WO_STATUSES.indexOf(status);
  const t = status === 'estimate' ? wo.estimateTotals : wo.approvedTotals;

  return (
    <>
      <PageHeader
        back={{ to: '/work-orders', label: 'Work orders' }}
        title={
          <>
            {wo.number} <StatusBadge status={status} /> <PriorityBadge priority={wo.priority} />
          </>
        }
        sub={
          <>
            <Link to={`/customers/${wo.customer.id}`}>{wo.customer.name}</Link> · Unit <Link to={`/units/${wo.unit.id}`}>{wo.unit.unitNumber}</Link> ·{' '}
            {unitLabel(wo.unit)} · Opened {fmtDate(wo.createdAt)}
            {wo.serviceWriterName && ` by ${wo.serviceWriterName}`}
          </>
        }
        actions={
          <>
            {isWriter && status === 'estimate' && (
              <>
                <button className="btn" disabled={busy} onClick={() => run(async () => { const r = await api.post(`/work-orders/${wo.id}/send-authorization`); setSendModal(r.path); reload(); })}>
                  Send for approval
                </button>
                <button className="btn" onClick={() => setAuthModal(true)}>
                  Record approval
                </button>
                <button className="btn btn-primary" disabled={busy || !wo.lines.length} onClick={() => setStatus('approved')}>
                  Approve all
                </button>
              </>
            )}
            {openForWork && (isWriter || isTech) && (
              <>
                {status !== 'in_progress' && (
                  <button className="btn" disabled={busy} onClick={() => setStatus('in_progress')}>
                    Start work
                  </button>
                )}
                {status !== 'waiting_parts' && (
                  <button className="btn" disabled={busy} onClick={() => setStatus('waiting_parts')}>
                    Waiting on parts
                  </button>
                )}
                {WO_TRANSITIONS[status].includes('complete') && (
                  <button className="btn btn-good" disabled={busy} onClick={() => setStatus('complete')}>
                    Mark complete
                  </button>
                )}
              </>
            )}
            {status === 'complete' && isWriter && (
              <>
                <button className="btn" disabled={busy} onClick={() => setStatus('in_progress')}>
                  Reopen
                </button>
                <button
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => run(async () => nav(`/invoices/${(await api.post(`/work-orders/${wo.id}/invoice`)).id}`), 'Invoice created')}
                >
                  Create invoice
                </button>
              </>
            )}
            {wo.invoice && isWriter && (
              <Link className="btn btn-dark" to={`/invoices/${wo.invoice.id}`}>
                View invoice {wo.invoice.number}
              </Link>
            )}
            <button className="btn btn-ghost" onClick={() => window.print()}>
              Print
            </button>
          </>
        }
      />

      <div className="status-flow no-print" aria-label="Work order progress">
        {WO_STATUSES.map((s, i) => (
          <div key={s} className={`step ${i < flowIdx ? 'done' : ''} ${s === status ? 'current' : ''}`}>
            {WO_STATUS_LABELS[s]}
          </div>
        ))}
      </div>

      {locked && <div className="callout" style={{ marginBottom: 16 }}>This work order has been invoiced and is locked.</div>}
      {wo.customer.notes && !locked && <div className="callout warn" style={{ marginBottom: 16 }}>{wo.customer.notes}</div>}

      <div className="grid grid-main">
        <div>
          {wo.lines.length === 0 && (
            <Card>
              <Empty>No jobs yet. Add the customer's complaints to build an estimate.</Empty>
            </Card>
          )}
          {wo.lines.map((l: any, i: number) => {
            const mine = current?.lineId === l.id;
            const canClock = openForWork && l.status === 'approved' && (isWriter || !l.technicianId || l.technicianId === user!.id) && can('technician');
            return (
              <div key={l.id} className={`job ${l.status === 'declined' ? 'declined' : ''}`}>
                <div className="job-head">
                  <span className="job-num">{i + 1}</span>
                  <span className="job-title">{l.title}</span>
                  <Badge tone={LINE_TONE[l.status]}>{l.status === 'pending' ? 'Needs approval' : l.status === 'approved' ? 'Approved' : 'Declined'}</Badge>
                  {l.done && <Badge tone="good">✓ Done</Badge>}
                  {l.pmScheduleId && <Badge tone="info">PM</Badge>}
                  <span className="spacer" />
                  {canClock &&
                    (mine ? (
                      <button className="btn btn-sm btn-danger" disabled={busy} onClick={clockOut}>
                        ■ Clock out
                      </button>
                    ) : (
                      <button className="btn btn-sm btn-good" disabled={busy} onClick={() => clockIn(l.id)}>
                        ▶ Clock in
                      </button>
                    ))}
                  {!locked && (isWriter || l.technicianId === user!.id) && (
                    <button className="btn btn-sm" onClick={() => setLineModal(l)}>
                      Edit
                    </button>
                  )}
                </div>
                <div className="job-body">
                  <div className="ccc">
                    {(['complaint', 'cause', 'correction'] as const).map((k) => (
                      <div key={k}>
                        <div className="lbl">{k}</div>
                        <div className="txt">{l[k] || <span className="faint">—</span>}</div>
                      </div>
                    ))}
                  </div>
                  {(l.parts.length > 0 || (isParts && !locked)) && (
                    <table className="table compact">
                      <thead>
                        <tr>
                          <th>Part</th>
                          <th>Description</th>
                          <th className="num">Qty</th>
                          <th className="num">Price</th>
                          <th className="num">Ext.</th>
                          {isParts && !locked && <th />}
                        </tr>
                      </thead>
                      <tbody>
                        {l.parts.map((p: any) => (
                          <tr key={p.id}>
                            <td className="mono">{p.partNumber}</td>
                            <td>
                              {p.description}
                              {!p.partId && <span className="faint small"> (non-stock)</span>}
                              {!p.taxable && <span className="faint small"> · non-taxable</span>}
                            </td>
                            <td className="num">{p.quantity}</td>
                            <td className="num">{formatMoney(p.unitPriceCents)}</td>
                            <td className="num">{formatMoney(p.extCents)}</td>
                            {isParts && !locked && (
                              <td className="right nowrap">
                                <button className="link-btn" onClick={() => setPartModal({ line: l, part: p })}>
                                  Edit
                                </button>{' '}
                                ·{' '}
                                <button className="link-btn danger" onClick={() => update(api.del(`/wo-parts/${p.id}`), 'Part removed')}>
                                  Remove
                                </button>
                              </td>
                            )}
                          </tr>
                        ))}
                        {isParts && !locked && (
                          <tr>
                            <td colSpan={6}>
                              <button className="link-btn" onClick={() => setPartModal({ line: l })}>
                                + Add part
                              </button>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  )}
                </div>
                <div className="job-foot">
                  <span>
                    <span className="muted">Tech: </span>
                    {isWriter && !locked ? (
                      <select
                        style={{ width: 'auto', padding: '3px 6px' }}
                        value={l.technicianId ?? ''}
                        onChange={(e) => update(api.put(`/lines/${l.id}`, { technicianId: e.target.value ? Number(e.target.value) : null }), 'Technician assigned')}
                      >
                        <option value="">Unassigned</option>
                        {techs.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <b>{l.technicianName ?? 'Unassigned'}</b>
                    )}
                  </span>
                  <span>
                    <span className="muted">Labor: </span>
                    {fmtHours(l.laborHours)} × {formatMoney(l.laborRateCents)} = <b>{formatMoney(l.laborCents)}</b>
                  </span>
                  <span title={l.timeEntries.map((e: any) => `${e.technicianName}: ${fmtDate(e.startedAt, true)} – ${e.endedAt ? fmtDate(e.endedAt, true) : 'now'}`).join('\n')}>
                    <span className="muted">Clocked: </span>
                    <b className={l.clockedHours > l.laborHours && l.laborHours > 0 ? 'text-bad' : ''}>{fmtHours(l.clockedHours)}</b>
                    {l.timeEntries.some((e: any) => !e.endedAt) && <Badge tone="info">● on the clock</Badge>}
                  </span>
                  <span className="spacer" />
                  <span>
                    Job total <b className="num">{formatMoney(l.laborCents + l.partsCents)}</b>
                  </span>
                </div>
              </div>
            );
          })}
          {isWriter && !locked && (
            <button className="btn" onClick={() => setLineModal({})}>
              + Add job
            </button>
          )}

          <div style={{ marginTop: 24 }}>
            <Tabs
              value={tab}
              onChange={setTab}
              tabs={[
                { id: 'notes', label: `Notes (${wo.notes.length})` },
                { id: 'files', label: `Photos & files (${wo.attachments.length})` },
                { id: 'inspections', label: `Inspections (${wo.inspections.length})` },
              ]}
            />
            {tab === 'notes' && <Notes wo={wo} onChange={reload} />}
            {tab === 'files' && <Files wo={wo} onChange={reload} />}
            {tab === 'inspections' && <Inspections wo={wo} onChange={reload} />}
          </div>
        </div>

        <div className="stack">
          <Card title={status === 'estimate' ? 'Estimate total' : 'Authorized total'}>
            <table className="totals">
              <tbody>
                <tr>
                  <td>Labor</td>
                  <td>{formatMoney(t.laborCents)}</td>
                </tr>
                <tr>
                  <td>Parts</td>
                  <td>{formatMoney(t.partsCents)}</td>
                </tr>
                <tr>
                  <td>Shop supplies</td>
                  <td>{formatMoney(t.shopSuppliesCents)}</td>
                </tr>
                <tr>
                  <td>Tax{wo.customer.taxExempt && ' (exempt)'}</td>
                  <td>{formatMoney(t.taxCents)}</td>
                </tr>
                <tr className="grand">
                  <td>Total</td>
                  <td>{formatMoney(t.totalCents)}</td>
                </tr>
              </tbody>
            </table>
            {status !== 'estimate' && wo.estimateTotals.totalCents !== wo.approvedTotals.totalCents && (
              <div className="callout warn small" style={{ marginTop: 12 }}>
                {formatMoney(wo.estimateTotals.totalCents - wo.approvedTotals.totalCents)} in jobs still need customer approval.
              </div>
            )}
            {t.declinedCents > 0 && <div className="small muted" style={{ marginTop: 8 }}>Declined work: {formatMoney(t.declinedCents)}</div>}
            <div className="small muted" style={{ marginTop: 8 }}>
              Clocked {fmtHours(wo.clockedHours)} · Billed {fmtHours(wo.lines.filter((l: any) => l.status === 'approved').reduce((a: number, l: any) => a + l.laborHours, 0))}
            </div>
          </Card>

          <Card title="Authorization">
            {wo.authorizedAt ? (
              <div className="callout good small">
                Authorized by <b>{wo.authorizedBy}</b> on {fmtDate(wo.authorizedAt, true)}
              </div>
            ) : wo.authSentAt ? (
              <div className="callout warn small">Sent to customer {fmtDate(wo.authSentAt, true)} — awaiting response.</div>
            ) : (
              <div className="muted small">Not yet sent to the customer.</div>
            )}
            {wo.authToken && isWriter && (
              <div className="small" style={{ marginTop: 10 }}>
                <a href={`/authorize/${wo.authToken}`} target="_blank" rel="noreferrer">
                  Open customer approval page ↗
                </a>
              </div>
            )}
          </Card>

          {isWriter && !locked && <HeaderCard wo={wo} onSaved={(w) => setData({ ...wo, ...w })} />}
          {(!isWriter || locked) && (
            <Card title="Details">
              <dl className="defs">
                <dt>Mileage in</dt>
                <dd>{fmtNum(wo.mileageIn, ' mi')}</dd>
                <dt>Engine hrs</dt>
                <dd>{fmtNum(wo.engineHoursIn)}</dd>
                <dt>PO #</dt>
                <dd>{wo.poNumber ?? '—'}</dd>
                <dt>Promised</dt>
                <dd>{fmtDate(wo.promisedAt)}</dd>
                <dt>VIN</dt>
                <dd className="mono">{wo.unit.vin}</dd>
              </dl>
            </Card>
          )}
          {isWriter && status === 'estimate' && (
            <button
              className="btn btn-danger"
              onClick={() => confirm(`Delete ${wo.number}? Parts will be returned to stock.`) && run(async () => { await api.del(`/work-orders/${wo.id}`); nav('/work-orders'); }, 'Estimate deleted')}
            >
              Delete estimate
            </button>
          )}
        </div>
      </div>

      {lineModal && (
        <LineModal
          wo={wo}
          line={lineModal.id ? lineModal : null}
          techs={techs}
          writer={isWriter}
          onClose={() => setLineModal(null)}
          onSaved={(w) => {
            setData({ ...wo, ...w });
            setLineModal(null);
          }}
        />
      )}
      {partModal && (
        <PartModal
          wo={wo}
          line={partModal.line}
          existing={partModal.part}
          onClose={() => setPartModal(null)}
          onSaved={(w) => {
            setData({ ...wo, ...w });
            setPartModal(null);
          }}
        />
      )}
      {authModal && (
        <AuthModal
          wo={wo}
          onClose={() => setAuthModal(false)}
          onSaved={(w) => {
            setData({ ...wo, ...w });
            setAuthModal(false);
          }}
        />
      )}
      {sendModal && <SendModal path={sendModal} wo={wo} onClose={() => setSendModal(null)} />}
    </>
  );
}

/* ------------------------------------------------------------------------ */

function HeaderCard({ wo, onSaved }: { wo: any; onSaved: (w: any) => void }) {
  const [f, setF] = useState({
    summary: wo.summary ?? '',
    priority: wo.priority,
    poNumber: wo.poNumber ?? '',
    mileageIn: wo.mileageIn ?? '',
    engineHoursIn: wo.engineHoursIn ?? '',
    promisedAt: wo.promisedAt ?? '',
  });
  const { busy, run } = useAction();
  const dirty = JSON.stringify(f) !== JSON.stringify({ summary: wo.summary ?? '', priority: wo.priority, poNumber: wo.poNumber ?? '', mileageIn: wo.mileageIn ?? '', engineHoursIn: wo.engineHoursIn ?? '', promisedAt: wo.promisedAt ?? '' });
  const set = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (
    <Card title="Details">
      <div className="stack">
        <Field label="Summary">
          <input value={f.summary} onChange={set('summary')} />
        </Field>
        <div className="form-grid">
          <Field label="Priority">
            <select value={f.priority} onChange={set('priority')}>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="down">Unit down</option>
            </select>
          </Field>
          <Field label="Promised">
            <input type="date" value={f.promisedAt} onChange={set('promisedAt')} />
          </Field>
          <Field label="Mileage in">
            <input inputMode="numeric" value={f.mileageIn} onChange={set('mileageIn')} />
          </Field>
          <Field label="Engine hrs">
            <input inputMode="decimal" value={f.engineHoursIn} onChange={set('engineHoursIn')} />
          </Field>
        </div>
        <Field label={`PO #${wo.customer.requiresPo ? ' (required)' : ''}`}>
          <input value={f.poNumber} onChange={set('poNumber')} />
        </Field>
        <div className="small muted mono">VIN {wo.unit.vin}</div>
        {dirty && (
          <button className="btn btn-primary" disabled={busy} onClick={() => run(async () => onSaved(await api.put(`/work-orders/${wo.id}`, f)), 'Saved')}>
            Save details
          </button>
        )}
      </div>
    </Card>
  );
}

function LineModal({ wo, line, techs, writer, onClose, onSaved }: { wo: any; line: any | null; techs: any[]; writer: boolean; onClose: () => void; onSaved: (w: any) => void }) {
  const [f, setF] = useState({
    title: line?.title ?? '',
    complaint: line?.complaint ?? '',
    cause: line?.cause ?? '',
    correction: line?.correction ?? '',
    laborHours: line?.laborHours ?? '',
    laborRateCents: line?.laborRateCents ?? wo.customer.laborRateCents ?? null,
    technicianId: line?.technicianId ?? '',
    done: line?.done ?? false,
  });
  const { busy, run } = useAction();
  const set = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = () =>
    run(async () => {
      const body = { ...f, laborHours: f.laborHours === '' ? 0 : Number(f.laborHours), technicianId: f.technicianId ? Number(f.technicianId) : null, laborRateCents: f.laborRateCents ?? undefined };
      onSaved(line ? await api.put(`/lines/${line.id}`, body) : await api.post(`/work-orders/${wo.id}/lines`, body));
    }, line ? 'Job updated' : 'Job added');
  return (
    <Modal
      title={line ? `Edit job — ${line.title}` : 'Add job'}
      onClose={onClose}
      wide
      footer={
        <>
          {line && writer && (
            <button className="btn btn-danger" style={{ marginRight: 'auto' }} disabled={busy} onClick={() => confirm('Remove this job and return its parts to stock?') && run(async () => onSaved(await api.del(`/lines/${line.id}`)), 'Job removed')}>
              Remove job
            </button>
          )}
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy || !f.title.trim()} onClick={save}>
            Save
          </button>
        </>
      }
    >
      <div className="form-grid cols-3">
        <Field label="Job title" span={3}>
          <input value={f.title} onChange={set('title')} disabled={!writer} autoFocus />
        </Field>
        <Field label="Complaint" span={3}>
          <textarea rows={2} value={f.complaint} onChange={set('complaint')} disabled={!writer} />
        </Field>
        <Field label="Cause" span={3} hint="What the technician found">
          <textarea rows={2} value={f.cause} onChange={set('cause')} />
        </Field>
        <Field label="Correction" span={3} hint="What was done to fix it">
          <textarea rows={3} value={f.correction} onChange={set('correction')} />
        </Field>
        {writer && (
          <>
            <Field label="Billed labor hours">
              <input inputMode="decimal" value={f.laborHours} onChange={set('laborHours')} />
            </Field>
            <Field label="Labor rate / hr">
              <MoneyInput cents={f.laborRateCents} onChange={(c) => setF({ ...f, laborRateCents: c })} placeholder="Shop default" />
            </Field>
            <Field label="Technician">
              <select value={f.technicianId} onChange={set('technicianId')}>
                <option value="">Unassigned</option>
                {techs.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </Field>
          </>
        )}
        {line && (
          <label className="check span-3">
            <input type="checkbox" checked={f.done} onChange={set('done')} /> Job finished
          </label>
        )}
      </div>
    </Modal>
  );
}

function PartModal({ wo, line, existing, onClose, onSaved }: { wo: any; line: any; existing?: any; onClose: () => void; onSaved: (w: any) => void }) {
  const [mode, setMode] = useState<'catalog' | 'nonstock'>(existing && !existing.partId ? 'nonstock' : 'catalog');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const { data: parts } = useApi<any[]>(mode === 'catalog' && !existing ? `/parts?q=${encodeURIComponent(dq)}` : null, [dq, mode]);
  const [picked, setPicked] = useState<any | null>(null);
  const [qty, setQty] = useState(String(existing?.quantity ?? 1));
  const [price, setPrice] = useState<number | null>(existing?.unitPriceCents ?? null);
  const [ns, setNs] = useState({ partNumber: existing?.partNumber ?? '', description: existing?.description ?? '', unitCostCents: existing?.unitCostCents ?? null, taxable: existing?.taxable ?? true });
  const { busy, run } = useAction();

  const pick = (p: any) =>
    run(async () => {
      setPicked(p);
      const pr = await api.get(`/parts/${p.id}/price?customerId=${wo.customerId}`);
      setPrice(pr.priceCents);
      setPicked({ ...p, quote: pr });
    });

  const save = () =>
    run(async () => {
      if (existing) {
        onSaved(await api.put(`/wo-parts/${existing.id}`, { quantity: Number(qty), unitPriceCents: price ?? undefined, ...(existing.partId ? {} : ns) }));
      } else if (mode === 'catalog') {
        onSaved(await api.post(`/lines/${line.id}/parts`, { partId: picked.id, quantity: Number(qty), unitPriceCents: price ?? undefined }));
      } else {
        onSaved(await api.post(`/lines/${line.id}/parts`, { ...ns, quantity: Number(qty), unitPriceCents: price }));
      }
    }, existing ? 'Part updated' : 'Part added');

  return (
    <Modal
      title={existing ? `Edit ${existing.partNumber}` : `Add part — ${line.title}`}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy || !(Number(qty) > 0) || (!existing && mode === 'catalog' && !picked)} onClick={save}>
            {existing ? 'Save' : 'Add to job'}
          </button>
        </>
      }
    >
      {!existing && (
        <div className="pill-tabs" style={{ marginBottom: 14 }}>
          <button className={mode === 'catalog' ? 'active' : ''} onClick={() => setMode('catalog')}>
            From inventory
          </button>
          <button className={mode === 'nonstock' ? 'active' : ''} onClick={() => { setMode('nonstock'); setPicked(null); setPrice(null); }}>
            Non-stock / special order
          </button>
        </div>
      )}
      {mode === 'catalog' && !existing && !picked && (
        <>
          <SearchInput value={q} onChange={setQ} placeholder="Search part #, description, category…" />
          <div className="table-wrap" style={{ maxHeight: 340, overflowY: 'auto', marginTop: 10 }}>
            <table className="table compact">
              <thead>
                <tr>
                  <th>Part #</th>
                  <th>Description</th>
                  <th className="num">On hand</th>
                  <th className="num">Price</th>
                </tr>
              </thead>
              <tbody>
                {parts?.filter((p) => p.active).map((p) => (
                  <tr key={p.id} className="clickable" onClick={() => pick(p)}>
                    <td className="mono">{p.partNumber}</td>
                    <td>
                      {p.description}
                      <div className="sub">{p.binLocation && `Bin ${p.binLocation}`}</div>
                    </td>
                    <td className="num">{p.qtyOnHand <= 0 ? <Badge tone="bad">{p.qtyOnHand}</Badge> : p.qtyOnHand}</td>
                    <td className="num">{formatMoney(p.priceCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {(picked || existing || mode === 'nonstock') && (
        <div className="form-grid cols-3">
          {picked && (
            <div className="span-3 callout">
              <b className="mono">{picked.partNumber}</b> — {picked.description} · {picked.qtyOnHand} on hand · cost {formatMoney(picked.costCents)}
              {picked.quote && (
                <div className="small">
                  Suggested price {formatMoney(picked.quote.priceCents)} ({picked.quote.markupPct}% markup from {picked.quote.source === 'matrix' ? 'shop matrix' : picked.quote.source === 'customer' ? 'customer pricing' : picked.quote.source === 'part' ? 'part markup' : 'list price'})
                </div>
              )}
              {!existing && (
                <button className="link-btn small" onClick={() => { setPicked(null); setPrice(null); }}>
                  Choose a different part
                </button>
              )}
            </div>
          )}
          {mode === 'nonstock' && (
            <>
              <Field label="Part number">
                <input value={ns.partNumber} onChange={(e) => setNs({ ...ns, partNumber: e.target.value })} />
              </Field>
              <Field label="Description" span={2}>
                <input value={ns.description} onChange={(e) => setNs({ ...ns, description: e.target.value })} />
              </Field>
              <Field label="Unit cost">
                <MoneyInput cents={ns.unitCostCents} onChange={(c) => setNs({ ...ns, unitCostCents: c })} />
              </Field>
            </>
          )}
          <Field label="Quantity">
            <input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
          </Field>
          <Field label="Sell price (each)">
            <MoneyInput cents={price} onChange={setPrice} />
          </Field>
          {mode === 'nonstock' && (
            <label className="check">
              <input type="checkbox" checked={ns.taxable} onChange={(e) => setNs({ ...ns, taxable: e.target.checked })} /> Taxable
            </label>
          )}
          {price != null && Number(qty) > 0 && (
            <div className="span-3 small muted">
              Extended: <b>{formatMoney(Math.round(price * Number(qty)))}</b>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function AuthModal({ wo, onClose, onSaved }: { wo: any; onClose: () => void; onSaved: (w: any) => void }) {
  const primary = wo.customer;
  const [name, setName] = useState('');
  const [decisions, setDecisions] = useState<Record<number, 'approved' | 'declined'>>(
    Object.fromEntries(wo.lines.map((l: any) => [l.id, l.status === 'declined' ? 'declined' : 'approved'])),
  );
  const { busy, run } = useAction();
  return (
    <Modal
      title="Record customer approval"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy || !name.trim()} onClick={() => run(async () => onSaved(await api.post(`/work-orders/${wo.id}/authorize`, { decisions, authorizedBy: name })), 'Approval recorded')}>
            Save approval
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="muted small">Use this when {primary.name} approves by phone, email or in person.</div>
        <Field label="Approved by (name)">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Gary Halvorsen" autoFocus />
        </Field>
        {wo.lines.map((l: any) => (
          <div key={l.id} className="row" style={{ justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
            <div>
              <b>{l.title}</b>
              <div className="small muted">{formatMoney(l.laborCents + l.partsCents)}</div>
            </div>
            <div className="seg">
              {(['approved', 'declined'] as const).map((d) => (
                <button key={d} className={decisions[l.id] === d ? `on-${d}` : ''} onClick={() => setDecisions({ ...decisions, [l.id]: d })}>
                  {d === 'approved' ? 'Approve' : 'Decline'}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function SendModal({ path, wo, onClose }: { path: string; wo: any; onClose: () => void }) {
  const url = `${window.location.origin}${path}`;
  const contact = wo.customer.email;
  return (
    <Modal title="Estimate ready for customer approval" onClose={onClose} footer={<button className="btn btn-primary" onClick={onClose}>Done</button>}>
      <div className="stack">
        <div>Share this secure link with the customer. They can review each job and approve or decline it online.</div>
        <div className="row">
          <input readOnly value={url} onFocus={(e) => e.target.select()} />
          <button className="btn" onClick={() => navigator.clipboard?.writeText(url).then(() => toast('Link copied'))}>
            Copy
          </button>
        </div>
        <div className="row">
          {contact && (
            <a className="btn" href={`mailto:${contact}?subject=${encodeURIComponent(`Estimate ${wo.number} for unit ${wo.unit.unitNumber}`)}&body=${encodeURIComponent(`Please review and approve the estimate here:\n${url}`)}`}>
              Email {contact}
            </a>
          )}
          <a className="btn btn-ghost" href={path} target="_blank" rel="noreferrer">
            Preview ↗
          </a>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------ Tab panels ------------------------------ */

function Notes({ wo, onChange }: { wo: any; onChange: () => void }) {
  const [body, setBody] = useState('');
  const [visible, setVisible] = useState(false);
  const { busy, run } = useAction();
  return (
    <Card>
      <div className="stack">
        <textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a note for the team…" />
        <div className="row">
          <label className="check small">
            <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} /> Show on customer invoice
          </label>
          <span className="spacer" />
          <button
            className="btn btn-dark btn-sm"
            disabled={busy || !body.trim()}
            onClick={() =>
              run(async () => {
                await api.post(`/work-orders/${wo.id}/notes`, { body, customerVisible: visible });
                setBody('');
                setVisible(false);
                onChange();
              })
            }
          >
            Add note
          </button>
        </div>
        {wo.notes.length === 0 ? (
          <Empty>No notes yet.</Empty>
        ) : (
          <ul className="timeline">
            {wo.notes.map((n: any) => (
              <li key={n.id}>
                <div className="meta">
                  <b>{n.userName ?? 'System'}</b> · {fmtDate(n.createdAt, true)} {n.customerVisible && <Badge tone="info">Customer visible</Badge>}{' '}
                  <button className="link-btn danger small" onClick={() => run(async () => { await api.del(`/notes/${n.id}`); onChange(); })}>
                    Delete
                  </button>
                </div>
                <div style={{ whiteSpace: 'pre-wrap' }}>{n.body}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function Files({ wo, onChange }: { wo: any; onChange: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [lineId, setLineId] = useState('');
  const { busy, run } = useAction();
  const upload = (files: FileList | null) =>
    files?.length &&
    run(async () => {
      const fd = new FormData();
      Array.from(files).forEach((f) => fd.append('files', f));
      if (lineId) fd.append('lineId', lineId);
      await api.post(`/work-orders/${wo.id}/attachments`, fd);
      if (ref.current) ref.current.value = '';
      onChange();
    }, 'Uploaded');
  return (
    <Card>
      <div className="row" style={{ marginBottom: 14 }}>
        <select value={lineId} onChange={(e) => setLineId(e.target.value)} style={{ width: 'auto' }}>
          <option value="">Whole work order</option>
          {wo.lines.map((l: any) => (
            <option key={l.id} value={l.id}>
              {l.title}
            </option>
          ))}
        </select>
        <input ref={ref} type="file" accept="image/*,video/*,application/pdf" capture="environment" multiple hidden onChange={(e) => upload(e.target.files)} />
        <button className="btn btn-dark" disabled={busy} onClick={() => ref.current?.click()}>
          {busy ? 'Uploading…' : '📷 Add photos / files'}
        </button>
      </div>
      {wo.attachments.length === 0 ? (
        <Empty>No photos yet. Techs can document damage and repairs from their phone.</Empty>
      ) : (
        <div className="thumbs">
          {wo.attachments.map((a: any) => (
            <a key={a.id} className="thumb" href={`/api/attachments/${a.id}/file`} target="_blank" rel="noreferrer" title={a.filename}>
              {a.mimeType.startsWith('image/') ? <img src={`/api/attachments/${a.id}/file`} alt={a.filename} loading="lazy" /> : <span>📄 {a.filename}</span>}
              <button
                className="del"
                onClick={(e) => {
                  e.preventDefault();
                  if (confirm('Delete this file?')) run(async () => { await api.del(`/attachments/${a.id}`); onChange(); });
                }}
              >
                ×
              </button>
            </a>
          ))}
        </div>
      )}
    </Card>
  );
}

function Inspections({ wo, onChange }: { wo: any; onChange: () => void }) {
  const { data: templates } = useApi<any[]>('/inspection-templates');
  const [tpl, setTpl] = useState('');
  const { busy, run } = useAction();
  const nav = useNavigate();
  return (
    <Card>
      <div className="row" style={{ marginBottom: 14 }}>
        <select value={tpl} onChange={(e) => setTpl(e.target.value)} style={{ width: 'auto' }}>
          <option value="">Choose a checklist…</option>
          {templates?.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <button className="btn btn-dark" disabled={busy || !tpl} onClick={() => run(async () => { const i = await api.post(`/work-orders/${wo.id}/inspections`, { templateId: Number(tpl) }); onChange(); nav(`/inspections/${i.id}`); })}>
          Start inspection
        </button>
      </div>
      {wo.inspections.length === 0 ? (
        <Empty>No inspections on this work order.</Empty>
      ) : (
        <table className="table compact">
          <tbody>
            {wo.inspections.map((i: any) => (
              <tr key={i.id} className="clickable" onClick={() => nav(`/inspections/${i.id}`)}>
                <td>
                  <b>{i.templateName}</b>
                  <div className="sub">Started {fmtDate(i.createdAt, true)}</div>
                </td>
                <td>{i.status === 'complete' ? <Badge tone="good">Complete</Badge> : <Badge tone="warn">In progress</Badge>}</td>
                <td>{i.checkedCount} checked</td>
                <td>{i.failCount > 0 ? <Badge tone="bad">{i.failCount} failed</Badge> : <span className="faint">No failures</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

