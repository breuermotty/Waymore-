import { Link, useNavigate } from 'react-router-dom';
import { WO_STATUS_LABELS, WO_STATUSES } from '../../../shared/constants';
import { formatMoney } from '../../../shared/money';
import { useAuth } from '../auth';
import { Card, Empty, ErrorBox, Loading, PageHeader, PriorityBadge, Stat, StatusBadge, fmtDate, useApi, useElapsed } from '../ui';

function Elapsed({ since }: { since: string }) {
  return <span className="mono">{useElapsed(since)}</span>;
}

export default function Dashboard() {
  const { data, error } = useApi<any>('/dashboard');
  const { user, can } = useAuth();
  const nav = useNavigate();
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const max = Math.max(1, ...data.months.map((m: any) => m.revenueCents));
  const greeting = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <>
      <PageHeader
        title={`${greeting}, ${user!.name.split(' ')[0]}`}
        sub={new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        actions={
          can('service_writer') && (
            <Link className="btn btn-primary" to="/work-orders/new">
              + New work order
            </Link>
          )
        }
      />
      <div className="stats">
        <Stat label="Open work orders" value={data.openCount} hint={`${data.awaitingAuth} awaiting customer approval`} to="/work-orders" />
        <Stat label="Revenue this month" value={formatMoney(data.revenueMonthCents)} hint={`${data.invoicesMonth} invoices, before tax`} tone="good" />
        <Stat label="Accounts receivable" value={formatMoney(data.arCents)} hint={`${formatMoney(data.arOverdueCents)} overdue`} tone={data.arOverdueCents > 0 ? 'warn' : undefined} to="/invoices?status=open" />
        <Stat label="PM due" value={data.pm.overdue + data.pm.due_soon} hint={`${data.pm.overdue} overdue · ${data.pm.due_soon} due soon`} tone={data.pm.overdue ? 'bad' : undefined} to="/pm" />
        <Stat label="Low stock parts" value={data.lowStock} hint="at or below reorder point" tone={data.lowStock ? 'warn' : undefined} to="/parts?low=1" />
      </div>

      <div className="grid grid-main">
        <div className="stack">
          <Card title="Shop floor" actions={<Link to="/work-orders">All work orders →</Link>} pad={false}>
            <div className="card-body" style={{ paddingBottom: 4 }}>
              <div className="row" style={{ gap: 6 }}>
                {WO_STATUSES.filter((s) => s !== 'invoiced').map((s) => (
                  <Link key={s} to={`/work-orders?status=${s}`} className="badge" style={{ textDecoration: 'none' }}>
                    {WO_STATUS_LABELS[s]} <b>{data.byStatus[s] ?? 0}</b>
                  </Link>
                ))}
              </div>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Work order</th>
                    <th>Customer / unit</th>
                    <th>Status</th>
                    <th>Promised</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map((w: any) => (
                    <tr key={w.id} className="clickable" onClick={() => nav(`/work-orders/${w.id}`)}>
                      <td>
                        <b>{w.number}</b> <PriorityBadge priority={w.priority} />
                        <div className="sub">{w.summary}</div>
                      </td>
                      <td>
                        {w.customerName}
                        <div className="sub">Unit {w.unitNumber}</div>
                      </td>
                      <td>
                        <StatusBadge status={w.status} />
                      </td>
                      <td className="nowrap">{fmtDate(w.promisedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card
            title="Revenue — last 6 months"
            actions={
              <div className="legend">
                <span><i style={{ background: 'var(--ink-3)' }} />Labor</span>
                <span><i style={{ background: 'var(--accent)' }} />Parts</span>
                <span><i style={{ background: '#b8c4d4' }} />Supplies</span>
              </div>
            }
          >
            <div className="bars">
              {data.months.map((m: any) => {
                const other = Math.max(0, m.revenueCents - m.laborCents - m.partsCents);
                const h = (c: number) => `${(c / max) * 160}px`;
                return (
                  <div className="bar-col" key={m.month} title={`${m.month}: ${formatMoney(m.revenueCents)}`}>
                    <div className="bar-val">{formatMoney(m.revenueCents).replace(/\.\d\d$/, '')}</div>
                    <div className="bar-stack">
                      <div className="seg-labor" style={{ height: h(m.laborCents) }} />
                      <div className="seg-parts" style={{ height: h(m.partsCents) }} />
                      <div className="seg-other" style={{ height: h(other) }} />
                    </div>
                    <div className="bar-label">{new Date(`${m.month}-15`).toLocaleDateString('en-US', { month: 'short' })}</div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        <div className="stack">
          <Card title="Technicians on the clock" pad={false}>
            {data.clockedIn.length === 0 ? (
              <Empty>No one is clocked in.</Empty>
            ) : (
              <ul className="timeline" style={{ padding: '0 18px' }}>
                {data.clockedIn.map((c: any, i: number) => (
                  <li key={i}>
                    <div className="row">
                      <b>{c.name}</b>
                      <span className="spacer" />
                      <Elapsed since={c.startedAt} />
                    </div>
                    <div className="small muted">
                      <Link to={`/work-orders/${c.workOrderId}`}>{c.number}</Link> · {c.title}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Quick links">
            <div className="stack small">
              <div><Link to="/work-orders?status=estimate">Estimates waiting for approval →</Link></div>
              <div><Link to="/work-orders?status=complete">Completed work ready to invoice →</Link></div>
              <div><Link to="/work-orders?status=waiting_parts">Jobs waiting on parts →</Link></div>
              <div><Link to="/pm">Units due for PM →</Link></div>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
