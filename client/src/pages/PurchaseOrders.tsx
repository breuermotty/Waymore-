import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { Badge, Card, Empty, ErrorBox, Field, Loading, Modal, Money, PageHeader, fmtDate, useAction, useApi } from '../ui';

export const PO_TONE: Record<string, string> = { draft: 'neutral', ordered: 'info', partial: 'warn', received: 'good', cancelled: 'bad' };

export default function PurchaseOrders() {
  const { data, error } = useApi<any[]>('/purchase-orders');
  const { data: vendors } = useApi<any[]>('/vendors');
  const [creating, setCreating] = useState(false);
  const [vendorId, setVendorId] = useState('');
  const { busy, run } = useAction();
  const nav = useNavigate();
  return (
    <>
      <PageHeader title="Purchase orders" actions={<button className="btn btn-primary" onClick={() => setCreating(true)}>+ New PO</button>} />
      <ErrorBox error={error} />
      <Card pad={false}>
        {!data ? <Loading /> : !data.length ? <Empty>No purchase orders.</Empty> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>PO</th><th>Vendor</th><th>Status</th><th>Created</th><th>Ordered</th><th className="num">Lines</th><th className="num">Total</th></tr></thead>
            <tbody>{data.map((p) => (
              <tr key={p.id} className="clickable" onClick={() => nav(`/purchase-orders/${p.id}`)}>
                <td><b>{p.number}</b></td>
                <td>{p.vendorName}</td>
                <td><Badge tone={PO_TONE[p.status]}>{p.status}</Badge></td>
                <td>{fmtDate(p.createdAt)}</td>
                <td>{fmtDate(p.orderedAt)}</td>
                <td className="num">{p.lineCount}</td>
                <td className="num"><Money cents={p.totalCents} /></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      {creating && (
        <Modal title="New purchase order" onClose={() => setCreating(false)} footer={<><button className="btn" onClick={() => setCreating(false)}>Cancel</button><button className="btn btn-primary" disabled={busy || !vendorId} onClick={() => run(async () => nav(`/purchase-orders/${(await api.post('/purchase-orders', { vendorId: Number(vendorId) })).id}`))}>Create</button></>}>
          <Field label="Vendor">
            <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} autoFocus>
              <option value="">Select…</option>
              {vendors?.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </Field>
        </Modal>
      )}
    </>
  );
}
