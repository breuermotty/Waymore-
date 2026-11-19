import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { Card, Empty, ErrorBox, Loading, Money, PageHeader, SearchInput, useApi, useDebounced } from '../ui';
import { CustomerModal, TERMS_LABEL } from './forms';

export default function Customers() {
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const { data, error } = useApi<any[]>(`/customers?q=${encodeURIComponent(dq)}`);
  const [creating, setCreating] = useState(false);
  const { can } = useAuth();
  const nav = useNavigate();
  return (
    <>
      <PageHeader title="Customers" sub="Fleet accounts, contacts and billing" actions={can('service_writer') && <button className="btn btn-primary" onClick={() => setCreating(true)}>+ New customer</button>} />
      <div className="toolbar"><SearchInput value={q} onChange={setQ} placeholder="Search name, account #, phone…" /></div>
      <ErrorBox error={error} />
      <Card pad={false}>
        {!data ? <Loading /> : !data.length ? <Empty>No customers found.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Customer</th><th>Contact</th><th>Terms</th><th className="num">Units</th><th className="num">Open WOs</th><th className="num">Balance</th></tr></thead>
              <tbody>
                {data.map((c) => (
                  <tr key={c.id} className="clickable" onClick={() => nav(`/customers/${c.id}`)}>
                    <td><b>{c.name}</b><div className="sub">{c.accountNumber} {c.billingCity && `· ${c.billingCity}, ${c.billingState}`}</div></td>
                    <td className="small">{c.phone}<div className="sub">{c.email}</div></td>
                    <td>{TERMS_LABEL[c.paymentTerms]}</td>
                    <td className="num">{c.unitCount}</td>
                    <td className="num">{c.openWorkOrders}</td>
                    <td className="num">{c.balanceCents > 0 ? <Money cents={c.balanceCents} /> : <span className="faint">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {creating && <CustomerModal onClose={() => setCreating(false)} onSaved={(c) => nav(`/customers/${c.id}`)} />}
    </>
  );
}
