import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { Badge, Card, Empty, ErrorBox, Loading, PageHeader, SearchInput, fmtNum, unitLabel, useApi, useDebounced } from '../ui';
import { UNIT_TYPE_LABEL, UnitModal } from './forms';

export default function Units() {
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const { data, error } = useApi<any[]>(`/units?q=${encodeURIComponent(dq)}`);
  const { data: customers } = useApi<any[]>('/customers');
  const [creating, setCreating] = useState(false);
  const { can } = useAuth();
  const nav = useNavigate();
  return (
    <>
      <PageHeader title="Units" sub="Every truck, trailer and piece of equipment you service" actions={can('service_writer') && <button className="btn btn-primary" onClick={() => setCreating(true)}>+ Add unit</button>} />
      <div className="toolbar"><SearchInput value={q} onChange={setQ} placeholder="Search unit #, VIN, make, customer…" /></div>
      <ErrorBox error={error} />
      <Card pad={false}>
        {!data ? <Loading /> : !data.length ? <Empty>No units found.</Empty> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Unit</th><th>Customer</th><th>Type</th><th>VIN</th><th className="num">Odometer</th><th className="num">Eng. hrs</th></tr></thead>
            <tbody>{data.map((u) => (
              <tr key={u.id} className="clickable" onClick={() => nav(`/units/${u.id}`)}>
                <td><b>{u.unitNumber}</b> {!u.active && <Badge>Inactive</Badge>}<div className="sub">{unitLabel(u)}</div></td>
                <td>{u.customerName}</td>
                <td>{UNIT_TYPE_LABEL[u.type] ?? u.type}</td>
                <td className="mono">{u.vin}</td>
                <td className="num">{fmtNum(u.mileage)}</td>
                <td className="num">{fmtNum(u.engineHours)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      {creating && customers && <UnitModal customers={customers} onClose={() => setCreating(false)} onSaved={(u) => nav(`/units/${u.id}`)} />}
    </>
  );
}
