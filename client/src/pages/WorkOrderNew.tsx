import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { Card, Field, PageHeader, unitLabel, useAction, useApi } from '../ui';

interface Line {
  title: string;
  complaint: string;
  laborHours: string;
  pmScheduleId?: number | null;
}

export default function WorkOrderNew() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const { busy, run } = useAction();
  const { data: customers } = useApi<any[]>('/customers');
  const [customerId, setCustomerId] = useState<number | ''>(params.get('customerId') ? Number(params.get('customerId')) : '');
  const [unitId, setUnitId] = useState<number | ''>(params.get('unitId') ? Number(params.get('unitId')) : '');
  const { data: customer } = useApi<any>(customerId ? `/customers/${customerId}` : null, [customerId]);
  const { data: unit } = useApi<any>(unitId ? `/units/${unitId}` : null, [unitId]);
  const [header, setHeader] = useState({ summary: '', priority: 'normal', poNumber: '', mileageIn: '', engineHoursIn: '', promisedAt: '' });
  const [lines, setLines] = useState<Line[]>([{ title: '', complaint: '', laborHours: '' }]);

  // If we arrived with only a unit, look up its customer.
  useEffect(() => {
    if (unit && !customerId) setCustomerId(unit.customerId);
  }, [unit, customerId]);
  useEffect(() => {
    if (unit) setHeader((h) => ({ ...h, mileageIn: h.mileageIn || String(unit.mileage ?? ''), engineHoursIn: h.engineHoursIn || String(unit.engineHours ?? '') }));
  }, [unit]);
  // Prefill a PM line when coming from the PM schedule.
  useEffect(() => {
    const pmId = Number(params.get('pmId'));
    if (unit && pmId) {
      const pm = unit.pmSchedules.find((p: any) => p.id === pmId);
      if (pm) setLines([{ title: pm.name, complaint: `Scheduled maintenance: ${pm.due.reasons.join(', ') || 'due'}`, laborHours: '', pmScheduleId: pm.id }]);
    }
  }, [unit, params]);

  const setLine = (i: number, k: keyof Line, v: string) => setLines((ls) => ls.map((l, j) => (i === j ? { ...l, [k]: v } : l)));

  const submit = () =>
    run(async () => {
      if (!customerId || !unitId) throw new Error('Choose a customer and unit');
      const wo = await api.post('/work-orders', {
        customerId,
        unitId,
        summary: header.summary,
        priority: header.priority,
        poNumber: header.poNumber,
        mileageIn: header.mileageIn,
        engineHoursIn: header.engineHoursIn,
        promisedAt: header.promisedAt,
        lines: lines.filter((l) => l.title.trim()).map((l) => ({ ...l, laborHours: l.laborHours || 0 })),
      });
      nav(`/work-orders/${wo.id}`);
    }, 'Work order created');

  const pmDue = unit?.pmSchedules?.filter((p: any) => p.due.status !== 'ok') ?? [];

  return (
    <>
      <PageHeader title="New work order" back={{ to: '/work-orders', label: 'Work orders' }} />
      <div className="grid grid-main">
        <div className="stack">
          <Card title="Customer & unit">
            <div className="form-grid">
              <Field label="Customer">
                <select value={customerId} onChange={(e) => { setCustomerId(Number(e.target.value) || ''); setUnitId(''); }}>
                  <option value="">Select a customer…</option>
                  {customers?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Unit">
                <select value={unitId} onChange={(e) => setUnitId(Number(e.target.value) || '')} disabled={!customer}>
                  <option value="">{customer ? 'Select a unit…' : 'Choose a customer first'}</option>
                  {customer?.units
                    .filter((u: any) => u.active)
                    .map((u: any) => (
                      <option key={u.id} value={u.id}>
                        {u.unitNumber} — {unitLabel(u)}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Mileage in">
                <input inputMode="numeric" value={header.mileageIn} onChange={(e) => setHeader({ ...header, mileageIn: e.target.value })} />
              </Field>
              <Field label="Engine hours in">
                <input inputMode="decimal" value={header.engineHoursIn} onChange={(e) => setHeader({ ...header, engineHoursIn: e.target.value })} />
              </Field>
              <Field label="Summary" span={2}>
                <input value={header.summary} onChange={(e) => setHeader({ ...header, summary: e.target.value })} placeholder="e.g. Brakes pulling left, PM due" />
              </Field>
              <Field label="Priority">
                <select value={header.priority} onChange={(e) => setHeader({ ...header, priority: e.target.value })}>
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="down">Unit down</option>
                </select>
              </Field>
              <Field label="Promised date">
                <input type="date" value={header.promisedAt} onChange={(e) => setHeader({ ...header, promisedAt: e.target.value })} />
              </Field>
              <Field label={`Customer PO #${customer?.requiresPo ? ' (required for invoicing)' : ''}`}>
                <input value={header.poNumber} onChange={(e) => setHeader({ ...header, poNumber: e.target.value })} />
              </Field>
            </div>
          </Card>

          <Card title="Complaints / jobs" actions={<button className="btn btn-sm" onClick={() => setLines([...lines, { title: '', complaint: '', laborHours: '' }])}>+ Add job</button>}>
            <div className="stack">
              {lines.map((l, i) => (
                <div key={i} className="form-grid" style={{ gridTemplateColumns: '2fr 1fr auto', alignItems: 'end' }}>
                  <Field label={`Job ${i + 1}`}>
                    <input value={l.title} onChange={(e) => setLine(i, 'title', e.target.value)} placeholder="e.g. Diagnose air leak" />
                  </Field>
                  <Field label="Est. labor hrs">
                    <input inputMode="decimal" value={l.laborHours} onChange={(e) => setLine(i, 'laborHours', e.target.value)} />
                  </Field>
                  <button className="btn btn-ghost" onClick={() => setLines(lines.filter((_, j) => j !== i))} disabled={lines.length === 1} aria-label="Remove job">
                    ×
                  </button>
                  <Field label="Complaint (as described by customer/driver)" span={3}>
                    <textarea rows={2} value={l.complaint} onChange={(e) => setLine(i, 'complaint', e.target.value)} />
                  </Field>
                </div>
              ))}
            </div>
          </Card>
          <div className="row">
            <span className="spacer" />
            <button className="btn btn-primary btn-lg" onClick={submit} disabled={busy || !customerId || !unitId}>
              Create work order
            </button>
          </div>
        </div>

        <div className="stack">
          {customer && (
            <Card title={customer.name}>
              <dl className="defs">
                <dt>Terms</dt>
                <dd>{customer.paymentTerms.replace('_', ' ')}</dd>
                <dt>Labor rate</dt>
                <dd>{customer.laborRateCents ? `$${(customer.laborRateCents / 100).toFixed(2)}/hr` : 'Shop default'}</dd>
                <dt>Tax</dt>
                <dd>{customer.taxExempt ? 'Exempt' : 'Taxable'}</dd>
              </dl>
              {customer.notes && <div className="callout warn" style={{ marginTop: 12 }}>{customer.notes}</div>}
            </Card>
          )}
          {unit && (
            <Card title={`Unit ${unit.unitNumber}`}>
              <div className="muted small">{unitLabel(unit)}</div>
              <div className="mono" style={{ marginTop: 4 }}>{unit.vin}</div>
              {pmDue.length > 0 && (
                <div className="stack" style={{ marginTop: 12 }}>
                  <div className="small muted">Add due PM to this work order:</div>
                  {pmDue.map((p: any) => (
                    <button
                      key={p.id}
                      className="btn btn-sm"
                      onClick={() =>
                        setLines((ls) => [...ls.filter((l) => l.title.trim()), { title: p.name, complaint: `Scheduled maintenance: ${p.due.reasons.join(', ')}`, laborHours: '', pmScheduleId: p.id }])
                      }
                    >
                      + {p.name} <span className={`badge ${p.due.status === 'overdue' ? 'badge-bad' : 'badge-warn'}`}>{p.due.status === 'overdue' ? 'Overdue' : 'Due soon'}</span>
                    </button>
                  ))}
                </div>
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
