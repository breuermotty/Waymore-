import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { Badge, Empty, ErrorBox, Loading, PageHeader, PriorityBadge, StatusBadge, fmtHours, useAction, useApi, useElapsed } from '../ui';

export default function MyJobs() {
  const { user } = useAuth();
  const { data: jobs, error, reload } = useApi<any[]>('/my/jobs');
  const { data: current, reload: reloadClock } = useApi<any>('/time/current');
  const { busy, run } = useAction();
  const elapsed = useElapsed(current?.startedAt);

  const refresh = () => Promise.all([reload(), reloadClock()]);
  const clockIn = (lineId: number) => run(async () => { await api.post(`/lines/${lineId}/clock-in`); await refresh(); }, 'Clocked in');
  const clockOut = () => run(async () => { await api.post('/time/clock-out'); await refresh(); }, 'Clocked out');
  const markDone = (lineId: number, done: boolean) => run(async () => { await api.put(`/lines/${lineId}`, { done }); if (done && current?.lineId === lineId) await api.post('/time/clock-out'); await refresh(); }, done ? 'Job marked done' : undefined);

  if (error) return <ErrorBox error={error} />;
  if (!jobs) return <Loading />;
  const mine = jobs.filter((j) => j.technicianId === user!.id);
  const open = jobs.filter((j) => !j.technicianId);

  const card = (j: any) => {
    const active = current?.lineId === j.lineId;
    const over = j.laborHours > 0 && j.clockedHours > j.laborHours;
    return (
      <div key={j.lineId} className={`job-card ${active ? 'active' : ''}`}>
        <div className="row">
          <Link to={`/work-orders/${j.workOrderId}`}><b>{j.number}</b></Link>
          <StatusBadge status={j.status} />
          <PriorityBadge priority={j.priority} />
          {j.done && <Badge tone="good">✓ Done</Badge>}
        </div>
        <h3>{j.title}</h3>
        <div className="small muted">
          Unit <b>{j.unitNumber}</b> · {j.unitLabel} · {j.customerName}
        </div>
        {j.complaint && <div className="small"><span className="muted">Complaint:</span> {j.complaint}</div>}
        <div className="row small">
          <span>Book <b>{fmtHours(j.laborHours)}</b></span>
          <span>· Clocked <b style={{ color: over ? 'var(--bad)' : undefined }}>{fmtHours(j.clockedHours)}</b></span>
        </div>
        {active && <div className="big-timer">{elapsed}</div>}
        <div className="row">
          {active ? (
            <button className="btn btn-danger btn-lg" disabled={busy} onClick={clockOut}>■ Clock out</button>
          ) : (
            <button className="btn btn-good btn-lg" disabled={busy || j.done || j.status === 'waiting_parts'} onClick={() => clockIn(j.lineId)}>▶ Clock in</button>
          )}
          {j.technicianId === user!.id && (
            <button className="btn" disabled={busy} onClick={() => markDone(j.lineId, !j.done)}>{j.done ? 'Reopen' : 'Mark done'}</button>
          )}
          <Link className="btn btn-ghost" to={`/work-orders/${j.workOrderId}`}>Open →</Link>
        </div>
        {j.status === 'waiting_parts' && <div className="callout warn small">Waiting on parts — clock in when they arrive.</div>}
      </div>
    );
  };

  return (
    <>
      <PageHeader title="My jobs" sub={current ? `On the clock: ${current.workOrderNumber} — ${current.lineTitle}` : 'You are not clocked in to a job.'} />
      <h2 style={{ fontSize: 16, margin: '4px 0 12px' }}>Assigned to me ({mine.length})</h2>
      {mine.length ? <div className="job-cards">{mine.map(card)}</div> : <Empty>Nothing assigned to you right now.</Empty>}
      <h2 style={{ fontSize: 16, margin: '28px 0 12px' }}>Unassigned approved jobs ({open.length})</h2>
      {open.length ? <div className="job-cards">{open.map(card)}</div> : <Empty>No unassigned work. Nice.</Empty>}
    </>
  );
}
