import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { WO_STATUS_LABELS, WO_STATUSES } from '../../../shared/constants';
import { useAuth } from '../auth';
import { Card, Empty, ErrorBox, Loading, Money, PageHeader, PriorityBadge, SearchInput, StatusBadge, fmtDate, useApi, useDebounced } from '../ui';

export default function WorkOrders() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? 'open';
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const { can } = useAuth();
  const nav = useNavigate();
  const qs = new URLSearchParams({ q: dq, ...(status === 'open' ? { open: '1' } : status === 'all' ? {} : { status }) });
  const { data, error, loading } = useApi<any[]>(`/work-orders?${qs}`);

  return (
    <>
      <PageHeader
        title="Work orders"
        actions={
          can('service_writer') && (
            <Link className="btn btn-primary" to="/work-orders/new">
              + New work order
            </Link>
          )
        }
      />
      <div className="toolbar">
        <SearchInput value={q} onChange={setQ} placeholder="Search WO #, customer, unit, VIN…" />
        <div className="pill-tabs">
          {['open', ...WO_STATUSES, 'all'].map((s) => (
            <button key={s} className={status === s ? 'active' : ''} onClick={() => setParams(s === 'open' ? {} : { status: s })}>
              {s === 'open' ? 'All open' : s === 'all' ? 'Everything' : WO_STATUS_LABELS[s as keyof typeof WO_STATUS_LABELS]}
            </button>
          ))}
        </div>
      </div>
      <ErrorBox error={error} />
      <Card pad={false}>
        {!data && loading ? (
          <Loading />
        ) : !data?.length ? (
          <Empty>No work orders match.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Work order</th>
                  <th>Customer</th>
                  <th>Unit</th>
                  <th>Technicians</th>
                  <th>Status</th>
                  <th>Opened</th>
                  <th className="num">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {data.map((w) => (
                  <tr key={w.id} className="clickable" onClick={() => nav(`/work-orders/${w.id}`)}>
                    <td>
                      <b>{w.number}</b> <PriorityBadge priority={w.priority} />
                      <div className="sub">{w.summary || `${w.lineCount} job(s)`}</div>
                    </td>
                    <td>{w.customerName}</td>
                    <td>
                      {w.unitNumber}
                      <div className="sub">{w.unitLabel}</div>
                    </td>
                    <td className="small">{w.technicians ?? <span className="faint">Unassigned</span>}</td>
                    <td>
                      <StatusBadge status={w.status} />
                      {w.status === 'estimate' && w.authSentAt && <div className="sub">Sent for approval</div>}
                    </td>
                    <td className="nowrap">{fmtDate(w.createdAt)}</td>
                    <td className="num">
                      <Money cents={w.subtotalCents} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
