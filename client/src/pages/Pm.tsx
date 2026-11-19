import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Card, Empty, ErrorBox, Loading, PageHeader, fmtNum, useApi } from '../ui';
import { PmNext, PmStatus, pmInterval } from './UnitDetail';

export default function Pm() {
  const { data, error } = useApi<any[]>('/pm');
  const [filter, setFilter] = useState<'due' | 'all'>('due');
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const rows = filter === 'due' ? data.filter((p) => p.due.status !== 'ok') : data;
  const overdue = data.filter((p) => p.due.status === 'overdue').length;
  const soon = data.filter((p) => p.due.status === 'due_soon').length;
  return (
    <>
      <PageHeader title="Preventive maintenance" sub="Due by date, mileage or engine hours, whichever comes first" />
      <div className="stats">
        <div className="stat stat-bad"><div className="stat-label">Overdue</div><div className="stat-value">{overdue}</div></div>
        <div className="stat stat-warn"><div className="stat-label">Due soon</div><div className="stat-value">{soon}</div><div className="stat-hint">within 14 days / 1,500 mi / 50 hrs</div></div>
        <div className="stat"><div className="stat-label">Schedules tracked</div><div className="stat-value">{data.length}</div></div>
      </div>
      <div className="toolbar">
        <div className="pill-tabs">
          <button className={filter === 'due' ? 'active' : ''} onClick={() => setFilter('due')}>Due & overdue</button>
          <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>All schedules</button>
        </div>
      </div>
      <Card pad={false}>
        {!rows.length ? <Empty>Nothing due. Every unit is up to date.</Empty> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Unit</th><th>Customer</th><th>Service</th><th>Interval</th><th>Next due</th><th>Status</th><th /></tr></thead>
            <tbody>{rows.map((p) => (
              <tr key={p.id}>
                <td><Link to={`/units/${p.unitId}`}><b>{p.unitNumber}</b></Link><div className="sub">{p.unitLabel}</div></td>
                <td><Link to={`/customers/${p.customerId}`}>{p.customerName}</Link></td>
                <td>{p.name}<div className="sub">{p.due.reasons.join(' · ')}</div></td>
                <td className="small">{pmInterval(p)}<div className="sub">Now: {fmtNum(p.mileage, ' mi')}{p.engineHours != null && ` · ${fmtNum(p.engineHours)} hrs`}</div></td>
                <td className="small"><PmNext pm={p} /></td>
                <td><PmStatus due={p.due} /></td>
                <td className="right">{p.onOpenWorkOrder ? <Badge tone="info">On open WO</Badge> : p.due.status !== 'ok' && <Link className="btn btn-sm" to={`/work-orders/new?unitId=${p.unitId}&pmId=${p.id}`}>Create WO</Link>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
    </>
  );
}
