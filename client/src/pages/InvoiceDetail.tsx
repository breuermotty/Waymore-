import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PAYMENT_METHODS } from '../../../shared/constants';
import { formatMoney } from '../../../shared/money';
import { api } from '../api';
import { Logo } from '../App';
import { useAuth } from '../auth';
import { ErrorBox, Field, Loading, Modal, MoneyInput, PageHeader, fmtDate, fmtNum, unitLabel, useAction, useApi } from '../ui';
import { TERMS_LABEL } from './forms';
import { InvoiceStatus } from './Invoices';

const METHOD_LABEL: Record<string, string> = { check: 'Check', ach: 'ACH / wire', card: 'Credit card', cash: 'Cash', fleet_card: 'Fleet card', other: 'Other' };

export default function InvoiceDetail() {
  const { id } = useParams();
  const { data: inv, error, reload } = useApi<any>(`/invoices/${id}`, [id]);
  const [paying, setPaying] = useState(false);
  const { can } = useAuth();
  const { busy, run } = useAction();
  if (error) return <ErrorBox error={error} />;
  if (!inv) return <Loading />;
  const wo = inv.workOrder;
  const shop = inv.shop;
  const overdue = !inv.voided && inv.balanceCents > 0 && inv.dueAt < new Date().toISOString();

  return (
    <>
      <div className="no-print">
        <PageHeader
          back={{ to: '/invoices', label: 'Invoices' }}
          title={<>{inv.number} <InvoiceStatus status={inv.status} overdue={overdue} /></>}
          sub={<>From <Link to={`/work-orders/${wo.id}`}>{wo.number}</Link> · Balance due {formatMoney(inv.balanceCents)}</>}
          actions={
            <>
              {!inv.voided && inv.balanceCents > 0 && <button className="btn btn-primary" onClick={() => setPaying(true)}>Record payment</button>}
              <button className="btn btn-dark" onClick={() => window.print()}>Print / Save PDF</button>
              {can() && !inv.voided && inv.paidCents === 0 && (
                <button className="btn btn-danger" disabled={busy} onClick={() => confirm(`Void ${inv.number}? The work order will be unlocked so it can be corrected and re-invoiced.`) && run(async () => { await api.post(`/invoices/${inv.id}/void`); reload(); }, 'Invoice voided')}>Void</button>
              )}
            </>
          }
        />
      </div>

      <article className="doc">
        <div className="doc-head">
          <div className="row" style={{ alignItems: 'flex-start', gap: 14 }}>
            <Logo size={46} />
            <div>
              <div style={{ fontWeight: 800, fontSize: 18 }}>{shop.name}</div>
              <div className="small muted">
                {shop.address}<br />{[shop.city, shop.state].filter(Boolean).join(', ')} {shop.zip}<br />{shop.phone} · {shop.email}
              </div>
            </div>
          </div>
          <div>
            <div className="doc-title">{inv.voided ? 'VOID' : 'INVOICE'}</div>
            <dl className="defs small" style={{ marginTop: 8 }}>
              <dt>Invoice #</dt><dd>{inv.number}</dd>
              <dt>Date</dt><dd>{fmtDate(inv.issuedAt)}</dd>
              <dt>Due</dt><dd>{fmtDate(inv.dueAt)}</dd>
              <dt>Terms</dt><dd>{TERMS_LABEL[wo.customer.paymentTerms]}</dd>
            </dl>
          </div>
        </div>

        <div className="doc-meta">
          <div>
            <h4>Bill to</h4>
            <b>{wo.customer.name}</b>
            <div className="small">
              {wo.customer.billingAddress}<br />{[wo.customer.billingCity, wo.customer.billingState].filter(Boolean).join(', ')} {wo.customer.billingZip}
              {wo.customer.accountNumber && <><br />Acct {wo.customer.accountNumber}</>}
            </div>
          </div>
          <div>
            <h4>Unit</h4>
            <b>{wo.unit.unitNumber}</b> · {unitLabel(wo.unit)}
            <div className="small mono">VIN {wo.unit.vin}</div>
            <div className="small">Mileage {fmtNum(wo.mileageIn)}{wo.engineHoursIn != null && ` · Eng hrs ${fmtNum(wo.engineHoursIn)}`}</div>
          </div>
          <div>
            <h4>Reference</h4>
            <div className="small">Work order {wo.number}{wo.poNumber && <><br />PO # <b>{wo.poNumber}</b></>}<br />Authorized by {wo.authorizedBy ?? '—'}</div>
          </div>
        </div>

        {wo.lines.map((l: any, i: number) => (
          <div className="job-block" key={l.id}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <b>{i + 1}. {l.title}</b>
              <b className="num">{formatMoney(l.laborCents + l.partsCents)}</b>
            </div>
            <div className="small" style={{ marginTop: 4 }}>
              {l.complaint && <div><span className="muted">Complaint:</span> {l.complaint}</div>}
              {l.cause && <div><span className="muted">Cause:</span> {l.cause}</div>}
              {l.correction && <div><span className="muted">Correction:</span> {l.correction}</div>}
            </div>
            <table className="table compact" style={{ marginTop: 6 }}>
              <tbody>
                {l.laborHours > 0 && (
                  <tr><td>Labor{l.technicianName && ` — ${l.technicianName}`}</td><td className="num">{l.laborHours} hr @ {formatMoney(l.laborRateCents)}</td><td className="num">{formatMoney(l.laborCents)}</td></tr>
                )}
                {l.parts.map((p: any) => (
                  <tr key={p.id}><td><span className="mono">{p.partNumber}</span> {p.description}</td><td className="num">{p.quantity} @ {formatMoney(p.unitPriceCents)}</td><td className="num">{formatMoney(p.extCents)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

        <div className="row" style={{ alignItems: 'flex-start', marginTop: 16, gap: 24 }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            {inv.customerNotes.map((n: any, i: number) => <div key={i} className="callout small" style={{ marginBottom: 8 }}>{n.body}</div>)}
            {inv.status === 'paid' && <div className="paid-stamp">PAID</div>}
          </div>
          <table className="totals" style={{ maxWidth: 320 }}>
            <tbody>
              <tr><td>Labor</td><td>{formatMoney(inv.laborCents)}</td></tr>
              <tr><td>Parts</td><td>{formatMoney(inv.partsCents)}</td></tr>
              <tr><td>Shop supplies</td><td>{formatMoney(inv.shopSuppliesCents)}</td></tr>
              <tr><td>Sales tax{wo.customer.taxExempt ? ' (exempt)' : ''}</td><td>{formatMoney(inv.taxCents)}</td></tr>
              <tr className="grand"><td>Total</td><td>{formatMoney(inv.totalCents)}</td></tr>
              {inv.payments.map((p: any) => (
                <tr key={p.id}><td className="small muted">Payment {fmtDate(p.receivedAt)} · {METHOD_LABEL[p.method] ?? p.method} {p.reference}</td><td>−{formatMoney(p.amountCents)}</td></tr>
              ))}
              <tr><td><b>Balance due</b></td><td><b>{formatMoney(inv.voided ? 0 : inv.balanceCents)}</b></td></tr>
            </tbody>
          </table>
        </div>
        {shop.invoiceFooter && <div className="doc-foot">{shop.invoiceFooter}</div>}
      </article>

      {paying && <PaymentModal inv={inv} onClose={() => setPaying(false)} onSaved={() => { setPaying(false); reload(); }} />}
    </>
  );
}

function PaymentModal({ inv, onClose, onSaved }: { inv: any; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ amountCents: inv.balanceCents as number | null, method: 'check', reference: '', receivedAt: new Date().toISOString().slice(0, 10) });
  const { busy, run } = useAction();
  return (
    <Modal title={`Record payment — ${inv.number}`} onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy || !f.amountCents} onClick={() => run(async () => { await api.post(`/invoices/${inv.id}/payments`, { ...f, receivedAt: new Date(`${f.receivedAt}T12:00:00`).toISOString() }); onSaved(); }, 'Payment recorded')}>Save payment</button>
      </>
    }>
      <div className="form-grid">
        <Field label="Amount" hint={`Balance ${formatMoney(inv.balanceCents)}`}><MoneyInput cents={f.amountCents} onChange={(c) => setF({ ...f, amountCents: c })} autoFocus /></Field>
        <Field label="Date received"><input type="date" value={f.receivedAt} onChange={(e) => setF({ ...f, receivedAt: e.target.value })} /></Field>
        <Field label="Method">
          <select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{PAYMENT_METHODS.map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}</select>
        </Field>
        <Field label="Reference (check #, auth code)"><input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
