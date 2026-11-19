import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { formatMoney } from '../../../shared/money';
import { api } from '../api';
import { Logo } from '../App';
import { Badge, Card, ErrorBox, Field, Loading, fmtDate, unitLabel, useAction, useApi } from '../ui';

export default function Authorize() {
  const { token } = useParams();
  const { data, error, reload } = useApi<any>(`/public/authorize/${token}`, [token]);
  const [decisions, setDecisions] = useState<Record<number, 'approved' | 'declined'>>({});
  const [name, setName] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const { busy, run } = useAction();

  useEffect(() => {
    if (data) setDecisions(Object.fromEntries(data.lines.map((l: any) => [l.id, l.status === 'declined' ? 'declined' : 'approved'])));
  }, [data]);

  if (error) return <div className="public"><ErrorBox error={error === 'Estimate not found' ? 'This approval link is invalid or has expired. Please contact the shop.' : error} /></div>;
  if (!data) return <Loading />;

  const approvedTotal = data.lines.filter((l: any) => decisions[l.id] === 'approved').reduce((a: number, l: any) => a + l.laborCents + l.partsCents, 0);
  const canRespond = !data.locked && ['estimate', 'approved', 'in_progress', 'waiting_parts'].includes(data.status);

  return (
    <div className="public">
      <div className="public-brand">
        <div className="row" style={{ gap: 12 }}>
          <Logo size={40} />
          <div>
            <div style={{ fontWeight: 800, fontSize: 18 }}>{data.shop.name}</div>
            <div className="small muted">{[data.shop.address, data.shop.city, data.shop.state].filter(Boolean).join(', ')} · {data.shop.phone}</div>
          </div>
        </div>
        <div className="right">
          <div className="muted small">Estimate</div>
          <div style={{ fontWeight: 800, fontSize: 18 }}>{data.number}</div>
        </div>
      </div>

      <Card>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <div className="muted small">Prepared for</div>
            <b>{data.customer.name}</b>
          </div>
          <div>
            <div className="muted small">Unit</div>
            <b>{data.unit.unitNumber}</b> · {unitLabel(data.unit)}
          </div>
          <div>
            <div className="muted small">Date</div>
            <b>{fmtDate(data.createdAt)}</b>
          </div>
        </div>
      </Card>

      {submitted && <div className="callout good" style={{ margin: '16px 0' }}>Thank you, your response has been sent to the shop. You can close this page.</div>}
      {data.authorizedAt && !submitted && <div className="callout" style={{ margin: '16px 0' }}>Last response: {data.authorizedBy} on {fmtDate(data.authorizedAt, true)}. You can update your decisions below.</div>}

      <h2 style={{ fontSize: 17, margin: '20px 0 10px' }}>Recommended work</h2>
      {data.lines.map((l: any, i: number) => (
        <div key={l.id} className="job">
          <div className="job-head">
            <span className="job-num">{i + 1}</span>
            <span className="job-title">{l.title}</span>
            <span className="spacer" />
            <b className="num">{formatMoney(l.laborCents + l.partsCents)}</b>
          </div>
          <div className="job-body">
            {l.complaint && <div><span className="muted">Concern:</span> {l.complaint}</div>}
            {l.cause && <div><span className="muted">Finding:</span> {l.cause}</div>}
            <div className="small muted" style={{ marginTop: 6 }}>
              Labor {formatMoney(l.laborCents)} · Parts {formatMoney(l.partsCents)}
              {l.parts.length > 0 && ` (${l.parts.map((p: any) => `${p.quantity}× ${p.description}`).join(', ')})`}
            </div>
          </div>
          <div className="job-foot">
            {canRespond ? (
              <div className="seg">
                <button className={decisions[l.id] === 'approved' ? 'on-approved' : ''} onClick={() => setDecisions({ ...decisions, [l.id]: 'approved' })}>✓ Approve</button>
                <button className={decisions[l.id] === 'declined' ? 'on-declined' : ''} onClick={() => setDecisions({ ...decisions, [l.id]: 'declined' })}>✕ Decline</button>
              </div>
            ) : (
              <Badge tone={l.status === 'approved' ? 'good' : l.status === 'declined' ? 'bad' : 'warn'}>{l.status}</Badge>
            )}
          </div>
        </div>
      ))}

      <Card title="Summary">
        <table className="totals">
          <tbody>
            <tr><td>All recommended work (labor + parts)</td><td>{formatMoney(data.lines.reduce((a: number, l: any) => a + l.laborCents + l.partsCents, 0))}</td></tr>
            <tr><td>Approved work (labor + parts)</td><td>{formatMoney(approvedTotal)}</td></tr>
            <tr><td className="small muted" colSpan={2}>Shop supplies and applicable taxes will be added to the final invoice.</td></tr>
          </tbody>
        </table>
        {canRespond && (
          <div className="stack" style={{ marginTop: 16 }}>
            <Field label="Your name (authorizing signature)">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="First and last name" />
            </Field>
            <div className="small muted">By submitting, you authorize {data.shop.name} to perform the approved work on the unit above.</div>
            <button
              className="btn btn-primary btn-lg"
              disabled={busy || name.trim().length < 2}
              onClick={() => run(async () => { await api.post(`/public/authorize/${token}`, { name, decisions }); setSubmitted(true); reload(); window.scrollTo({ top: 0, behavior: 'smooth' }); })}
            >
              Submit response
            </button>
          </div>
        )}
      </Card>
    </div>
  );
}
