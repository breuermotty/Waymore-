import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { InspectionResult } from '../../../shared/constants';
import { api } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, ErrorBox, Loading, PageHeader, fmtDate, unitLabel, useAction, useApi } from '../ui';

const OPTIONS: { v: InspectionResult; label: string }[] = [
  { v: 'pass', label: 'Pass' },
  { v: 'fail', label: 'Fail' },
  { v: 'repaired', label: 'Repaired' },
  { v: 'na', label: 'N/A' },
];

export default function Inspection() {
  const { id } = useParams();
  const { data, setData, error } = useApi<any>(`/inspections/${id}`, [id]);
  const [results, setResults] = useState<Record<string, { result: InspectionResult; note?: string }>>({});
  const { busy, run } = useAction();
  const { can } = useAuth();

  useEffect(() => {
    if (data) setResults(data.results);
  }, [data]);

  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const readOnly = data.status === 'complete' && !can('service_writer');
  const total = data.template.sections.reduce((n: number, s: any) => n + s.items.length, 0);
  const checked = Object.keys(results).length;
  const fails = Object.values(results).filter((r) => r.result === 'fail').length;

  const set = (key: string, patch: Partial<{ result: InspectionResult; note: string }>) =>
    setResults((r) => ({ ...r, [key]: { ...(r[key] ?? { result: 'pass' }), ...patch } as any }));
  const passRest = () =>
    setResults((r) => {
      const next = { ...r };
      data.template.sections.forEach((s: any, si: number) => s.items.forEach((_: string, ii: number) => (next[`${si}.${ii}`] ??= { result: 'pass' })));
      return next;
    });
  const save = (complete = false) => run(async () => setData(await api.put(`/inspections/${id}`, { results, complete })), complete ? 'Inspection completed' : 'Saved');

  return (
    <>
      <PageHeader
        back={{ to: `/work-orders/${data.workOrder.id}`, label: data.workOrder.number }}
        title={<>{data.template.name} {data.status === 'complete' ? <Badge tone="good">Complete</Badge> : <Badge tone="warn">In progress</Badge>}</>}
        sub={`Unit ${data.unit.unitNumber} · ${unitLabel(data.unit)} · VIN ${data.unit.vin ?? '—'} · ${data.customerName}${data.technicianName ? ` · Inspector: ${data.technicianName}` : ''}${data.completedAt ? ` · Completed ${fmtDate(data.completedAt, true)}` : ''}`}
        actions={
          <>
            {!readOnly && <button className="btn" onClick={passRest}>Pass all unchecked</button>}
            {!readOnly && <button className="btn" disabled={busy} onClick={() => save(false)}>Save progress</button>}
            {!readOnly && data.status !== 'complete' && <button className="btn btn-primary" disabled={busy || checked < total} onClick={() => save(true)}>Complete inspection</button>}
            <button className="btn btn-ghost" onClick={() => window.print()}>Print</button>
          </>
        }
      />
      <div className="stats">
        <div className="stat"><div className="stat-label">Checked</div><div className="stat-value">{checked}/{total}</div></div>
        <div className={`stat ${fails ? 'stat-bad' : 'stat-good'}`}><div className="stat-label">Failed items</div><div className="stat-value">{fails}</div></div>
      </div>
      <Card>
        {data.template.sections.map((sec: any, si: number) => (
          <div className="insp-section" key={si}>
            <h3>{sec.section}</h3>
            {sec.items.map((item: string, ii: number) => {
              const key = `${si}.${ii}`;
              const r = results[key];
              return (
                <div key={key} className={`insp-item ${r?.result === 'fail' ? 'failed' : ''}`}>
                  <div>{item}</div>
                  <div className="seg" role="radiogroup" aria-label={item}>
                    {OPTIONS.map((o) => (
                      <button key={o.v} disabled={readOnly} className={r?.result === o.v ? `on-${o.v}` : ''} onClick={() => set(key, { result: o.v })} aria-pressed={r?.result === o.v}>
                        {o.label}
                      </button>
                    ))}
                  </div>
                  {(r?.result === 'fail' || r?.result === 'repaired' || r?.note) && (
                    <input className="note" disabled={readOnly} placeholder={r?.result === 'fail' ? 'Describe the defect (required)…' : 'Note…'} value={r?.note ?? ''} onChange={(e) => set(key, { note: e.target.value })} />
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </Card>
    </>
  );
}
