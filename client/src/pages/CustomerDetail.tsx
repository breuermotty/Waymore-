import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth';
import { Badge, Card, Empty, ErrorBox, Loading, Money, PageHeader, StatusBadge, Tabs, fmtDate, fmtNum, unitLabel, useApi } from '../ui';
import { ContactModal, CustomerModal, TERMS_LABEL, UNIT_TYPE_LABEL, UnitModal } from './forms';

export default function CustomerDetail() {
  const { id } = useParams();
  const { data: c, error, reload } = useApi<any>(`/customers/${id}`, [id]);
  const [tab, setTab] = useState<'units' | 'wos' | 'invoices'>('units');
  const [edit, setEdit] = useState(false);
  const [contact, setContact] = useState<any | null>(null);
  const [unitModal, setUnitModal] = useState(false);
  const { can } = useAuth();
  const nav = useNavigate();
  if (error) return <ErrorBox error={error} />;
  if (!c) return <Loading />;
  const w = can('service_writer');
  const balance = c.invoices.filter((i: any) => !i.voided).reduce((a: number, i: any) => a + i.balanceCents, 0);

  return (
    <>
      <PageHeader
        back={{ to: '/customers', label: 'Customers' }}
        title={<>{c.name} {c.taxExempt && <Badge tone="info">Tax exempt</Badge>}</>}
        sub={[c.accountNumber, c.phone, c.email].filter(Boolean).join(' · ')}
        actions={w && (
          <>
            <button className="btn" onClick={() => setEdit(true)}>Edit</button>
            <Link className="btn btn-primary" to={`/work-orders/new?customerId=${c.id}`}>+ New work order</Link>
          </>
        )}
      />
      <div className="grid grid-main">
        <div>
          <Tabs value={tab} onChange={setTab} tabs={[
            { id: 'units', label: `Units (${c.units.length})` },
            { id: 'wos', label: `Work orders (${c.workOrders.length})` },
            { id: 'invoices', label: `Invoices (${c.invoices.length})` },
          ]} />
          {tab === 'units' && (
            <Card pad={false} title="Fleet" actions={w && <button className="btn btn-sm" onClick={() => setUnitModal(true)}>+ Add unit</button>}>
              {!c.units.length ? <Empty>No units yet.</Empty> : (
                <div className="table-wrap"><table className="table">
                  <thead><tr><th>Unit</th><th>Type</th><th>VIN</th><th className="num">Odometer</th><th className="num">Eng. hrs</th></tr></thead>
                  <tbody>{c.units.map((u: any) => (
                    <tr key={u.id} className="clickable" onClick={() => nav(`/units/${u.id}`)}>
                      <td><b>{u.unitNumber}</b> {!u.active && <Badge>Inactive</Badge>}<div className="sub">{unitLabel(u)}</div></td>
                      <td>{UNIT_TYPE_LABEL[u.type] ?? u.type}</td>
                      <td className="mono">{u.vin}</td>
                      <td className="num">{fmtNum(u.mileage)}</td>
                      <td className="num">{fmtNum(u.engineHours)}</td>
                    </tr>
                  ))}</tbody>
                </table></div>
              )}
            </Card>
          )}
          {tab === 'wos' && (
            <Card pad={false}>
              {!c.workOrders.length ? <Empty>No work orders.</Empty> : (
                <table className="table"><tbody>{c.workOrders.map((wo: any) => (
                  <tr key={wo.id} className="clickable" onClick={() => nav(`/work-orders/${wo.id}`)}>
                    <td><b>{wo.number}</b><div className="sub">{wo.summary}</div></td>
                    <td>Unit {wo.unitNumber}</td>
                    <td><StatusBadge status={wo.status} /></td>
                    <td className="nowrap">{fmtDate(wo.createdAt)}</td>
                  </tr>
                ))}</tbody></table>
              )}
            </Card>
          )}
          {tab === 'invoices' && (
            <Card pad={false}>
              {!c.invoices.length ? <Empty>No invoices.</Empty> : (
                <table className="table">
                  <thead><tr><th>Invoice</th><th>Issued</th><th>Due</th><th className="num">Total</th><th className="num">Balance</th></tr></thead>
                  <tbody>{c.invoices.map((i: any) => (
                    <tr key={i.id} className="clickable" onClick={() => w && nav(`/invoices/${i.id}`)}>
                      <td><b>{i.number}</b> {!!i.voided && <Badge>Void</Badge>}</td>
                      <td>{fmtDate(i.issuedAt)}</td>
                      <td>{fmtDate(i.dueAt)}</td>
                      <td className="num"><Money cents={i.totalCents} /></td>
                      <td className="num">{i.voided ? '—' : i.balanceCents > 0 ? <Money cents={i.balanceCents} /> : <Badge tone="good">Paid</Badge>}</td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
            </Card>
          )}
        </div>
        <div className="stack">
          <Card title="Billing">
            <dl className="defs">
              <dt>Balance due</dt><dd><Money cents={balance} /></dd>
              <dt>Terms</dt><dd>{TERMS_LABEL[c.paymentTerms]}</dd>
              <dt>Labor rate</dt><dd>{c.laborRateCents ? <Money cents={c.laborRateCents} /> : 'Shop default'}</dd>
              <dt>Parts markup</dt><dd>{c.partsMarkupPct != null ? `${c.partsMarkupPct}% flat` : 'Shop matrix'}</dd>
              <dt>PO required</dt><dd>{c.requiresPo ? 'Yes' : 'No'}</dd>
              <dt>Address</dt><dd>{[c.billingAddress, [c.billingCity, c.billingState, c.billingZip].filter(Boolean).join(' ')].filter(Boolean).join(', ') || '—'}</dd>
            </dl>
            {c.notes && <div className="callout warn small" style={{ marginTop: 12 }}>{c.notes}</div>}
          </Card>
          <Card title="Contacts" pad={false} actions={w && <button className="btn btn-sm" onClick={() => setContact({})}>+ Add</button>}>
            {!c.contacts.length ? <Empty>No contacts.</Empty> : (
              <ul className="timeline" style={{ padding: '0 18px' }}>
                {c.contacts.map((ct: any) => (
                  <li key={ct.id}>
                    <div className="row">
                      <b>{ct.name}</b>
                      {ct.isPrimary && <Badge tone="info">Primary</Badge>}
                      {ct.canAuthorize && <Badge>Can authorize</Badge>}
                      <span className="spacer" />
                      {w && <button className="link-btn small" onClick={() => setContact(ct)}>Edit</button>}
                    </div>
                    <div className="small muted">{ct.title}</div>
                    <div className="small">{ct.phone && <a href={`tel:${ct.phone}`}>{ct.phone}</a>} {ct.email && <> · <a href={`mailto:${ct.email}`}>{ct.email}</a></>}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
      {edit && <CustomerModal customer={c} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); reload(); }} />}
      {contact && <ContactModal customerId={c.id} contact={contact.id ? contact : undefined} onClose={() => setContact(null)} onSaved={() => { setContact(null); reload(); }} />}
      {unitModal && <UnitModal customerId={c.id} onClose={() => setUnitModal(false)} onSaved={(u) => nav(`/units/${u.id}`)} />}
    </>
  );
}
