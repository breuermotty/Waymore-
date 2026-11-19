import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth';
import { Badge, Card, Empty, ErrorBox, Loading, PageHeader, StatusBadge, fmtDate, fmtNum, unitLabel, useApi } from '../ui';
import { PmModal, UNIT_TYPE_LABEL, UnitModal } from './forms';

export function PmStatus({ due }: { due: any }) {
  return due.status === 'overdue' ? <Badge tone="bad">Overdue</Badge> : due.status === 'due_soon' ? <Badge tone="warn">Due soon</Badge> : <Badge tone="good">OK</Badge>;
}

export function PmNext({ pm }: { pm: any }) {
  const parts = [];
  if (pm.due.nextDueDate) parts.push(fmtDate(pm.due.nextDueDate));
  if (pm.due.nextDueMiles != null) parts.push(`${fmtNum(pm.due.nextDueMiles)} mi`);
  if (pm.due.nextDueHours != null) parts.push(`${fmtNum(pm.due.nextDueHours)} hrs`);
  return <>{parts.join(' or ') || '—'}</>;
}

export function pmInterval(pm: any) {
  return [pm.intervalDays && `${pm.intervalDays} days`, pm.intervalMiles && `${fmtNum(pm.intervalMiles)} mi`, pm.intervalHours && `${fmtNum(pm.intervalHours)} hrs`].filter(Boolean).join(' / ');
}

export default function UnitDetail() {
  const { id } = useParams();
  const { data: u, error, reload } = useApi<any>(`/units/${id}`, [id]);
  const [edit, setEdit] = useState(false);
  const [pm, setPm] = useState<any | null>(null);
  const { can } = useAuth();
  const nav = useNavigate();
  if (error) return <ErrorBox error={error} />;
  if (!u) return <Loading />;
  const w = can('service_writer');
  return (
    <>
      <PageHeader
        back={{ to: '/units', label: 'Units' }}
        title={<>Unit {u.unitNumber} {!u.active && <Badge>Inactive</Badge>}</>}
        sub={<>{unitLabel(u)} · <Link to={`/customers/${u.customer.id}`}>{u.customer.name}</Link></>}
        actions={w && (
          <>
            <button className="btn" onClick={() => setEdit(true)}>Edit</button>
            <Link className="btn btn-primary" to={`/work-orders/new?customerId=${u.customerId}&unitId=${u.id}`}>+ New work order</Link>
          </>
        )}
      />
      <div className="grid grid-main">
        <div className="stack">
          <Card title="Preventive maintenance" pad={false} actions={w && <button className="btn btn-sm" onClick={() => setPm({})}>+ Add schedule</button>}>
            {!u.pmSchedules.length ? <Empty>No PM schedules. Add one to get reminders by date, miles or engine hours.</Empty> : (
              <div className="table-wrap"><table className="table">
                <thead><tr><th>Service</th><th>Interval</th><th>Last done</th><th>Next due</th><th>Status</th><th /></tr></thead>
                <tbody>{u.pmSchedules.map((p: any) => (
                  <tr key={p.id}>
                    <td><b>{p.name}</b>{!p.active && <Badge>Paused</Badge>}<div className="sub">{p.due.reasons.join(' · ')}</div></td>
                    <td className="small">{pmInterval(p)}</td>
                    <td className="small">{[p.lastDoneAt && fmtDate(p.lastDoneAt), p.lastDoneMiles != null && `${fmtNum(p.lastDoneMiles)} mi`, p.lastDoneHours != null && `${fmtNum(p.lastDoneHours)} hrs`].filter(Boolean).join(' · ') || '—'}</td>
                    <td className="small"><PmNext pm={p} /></td>
                    <td><PmStatus due={p.due} /></td>
                    <td className="right nowrap">
                      {w && p.due.status !== 'ok' && <Link className="btn btn-sm" to={`/work-orders/new?unitId=${u.id}&pmId=${p.id}`}>Schedule</Link>}{' '}
                      {w && <button className="link-btn small" onClick={() => setPm(p)}>Edit</button>}
                    </td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </Card>
          <Card title="Service history" pad={false}>
            {!u.history.length ? <Empty>No work orders for this unit yet.</Empty> : (
              <table className="table"><tbody>{u.history.map((h: any) => (
                <tr key={h.id} className="clickable" onClick={() => nav(`/work-orders/${h.id}`)}>
                  <td className="nowrap">{fmtDate(h.createdAt)}</td>
                  <td><b>{h.number}</b><div className="sub">{h.jobs ?? h.summary}</div></td>
                  <td className="num">{fmtNum(h.mileageIn, ' mi')}</td>
                  <td><StatusBadge status={h.status} /></td>
                </tr>
              ))}</tbody></table>
            )}
          </Card>
        </div>
        <Card title="Unit details">
          <dl className="defs">
            <dt>Type</dt><dd>{UNIT_TYPE_LABEL[u.type] ?? u.type}</dd>
            <dt>VIN</dt><dd className="mono">{u.vin ?? '—'}</dd>
            <dt>Year/Make</dt><dd>{unitLabel(u) || '—'}</dd>
            <dt>Engine</dt><dd>{u.engine ?? '—'}</dd>
            <dt>Plate</dt><dd>{u.licensePlate ?? '—'}</dd>
            <dt>Odometer</dt><dd>{fmtNum(u.mileage, ' mi')}</dd>
            <dt>Eng. hours</dt><dd>{fmtNum(u.engineHours)}</dd>
          </dl>
          {u.notes && <div className="callout small" style={{ marginTop: 12 }}>{u.notes}</div>}
        </Card>
      </div>
      {edit && <UnitModal unit={u} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); reload(); }} />}
      {pm && <PmModal unitId={u.id} pm={pm.id ? pm : undefined} onClose={() => setPm(null)} onSaved={() => { setPm(null); reload(); }} />}
    </>
  );
}
