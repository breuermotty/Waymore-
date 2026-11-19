import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { formatMoney } from '../../../shared/money';
import { api } from '../api';
import { Badge, Card, Empty, ErrorBox, Field, Loading, MoneyInput, PageHeader, fmtDate, useAction, useApi } from '../ui';
import { PO_TONE } from './PurchaseOrders';

export default function PurchaseOrderDetail() {
  const { id } = useParams();
  const { data: po, setData, error } = useApi<any>(`/purchase-orders/${id}`, [id]);
  const { data: parts } = useApi<any[]>('/parts');
  const [add, setAdd] = useState<{ partId: string; quantity: string; unitCostCents: number | null }>({ partId: '', quantity: '1', unitCostCents: null });
  const [recv, setRecv] = useState<Record<number, string>>({});
  const { busy, run } = useAction();
  if (error) return <ErrorBox error={error} />;
  if (!po) return <Loading />;
  const draft = po.status === 'draft';
  const receiving = ['ordered', 'partial'].includes(po.status);
  const vendorParts = parts?.filter((p) => p.active) ?? [];

  return (
    <>
      <PageHeader
        back={{ to: '/purchase-orders', label: 'Purchase orders' }}
        title={<>{po.number} <Badge tone={PO_TONE[po.status]}>{po.status}</Badge></>}
        sub={`${po.vendor.name} · Acct ${po.vendor.accountNumber ?? '—'} · Created ${fmtDate(po.createdAt)}${po.orderedAt ? ` · Ordered ${fmtDate(po.orderedAt)}` : ''}${po.receivedAt ? ` · Received ${fmtDate(po.receivedAt)}` : ''}`}
        actions={
          <>
            {draft && <button className="btn btn-primary" disabled={busy || !po.lines.length} onClick={() => run(async () => setData(await api.post(`/purchase-orders/${id}/status`, { status: 'ordered' })), 'Marked as ordered')}>Mark ordered</button>}
            {['draft', 'ordered'].includes(po.status) && <button className="btn btn-danger" disabled={busy} onClick={() => confirm('Cancel this PO?') && run(async () => setData(await api.post(`/purchase-orders/${id}/status`, { status: 'cancelled' })))}>Cancel PO</button>}
            <button className="btn btn-ghost" onClick={() => window.print()}>Print</button>
          </>
        }
      />
      <Card pad={false} title="Lines">
        {!po.lines.length ? <Empty>No lines yet.</Empty> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Part #</th><th>Description</th><th className="num">Ordered</th><th className="num">Received</th><th className="num">Unit cost</th><th className="num">Ext.</th>{(draft || receiving) && <th />}</tr></thead>
            <tbody>{po.lines.map((l: any) => (
              <tr key={l.id}>
                <td className="mono">{l.partNumber}</td>
                <td>{l.description}<div className="sub">On hand: {l.qtyOnHand}</div></td>
                <td className="num">{l.quantity}</td>
                <td className="num">{l.receivedQty >= l.quantity ? <Badge tone="good">{l.receivedQty}</Badge> : l.receivedQty}</td>
                <td className="num">{formatMoney(l.unitCostCents)}</td>
                <td className="num">{formatMoney(Math.round(l.quantity * l.unitCostCents))}</td>
                {draft && <td className="right"><button className="link-btn danger" onClick={() => run(async () => setData(await api.del(`/purchase-order-lines/${l.id}`)))}>Remove</button></td>}
                {receiving && (
                  <td className="right">
                    {l.receivedQty < l.quantity && (
                      <input style={{ width: 90 }} inputMode="decimal" placeholder={`max ${l.quantity - l.receivedQty}`} value={recv[l.id] ?? ''} onChange={(e) => setRecv({ ...recv, [l.id]: e.target.value })} />
                    )}
                  </td>
                )}
              </tr>
            ))}</tbody>
            <tfoot><tr><td colSpan={5}>Total</td><td className="num">{formatMoney(po.totalCents)}</td>{(draft || receiving) && <td />}</tr></tfoot>
          </table></div>
        )}
        {receiving && (
          <div className="card-body row">
            <button className="btn" onClick={() => setRecv(Object.fromEntries(po.lines.map((l: any) => [l.id, String(l.quantity - l.receivedQty)])))}>Fill all remaining</button>
            <span className="spacer" />
            <button className="btn btn-good" disabled={busy || !Object.values(recv).some((v) => Number(v) > 0)} onClick={() => run(async () => { setData(await api.post(`/purchase-orders/${id}/receive`, { lines: Object.entries(recv).map(([lineId, qty]) => ({ lineId: Number(lineId), qty: Number(qty) || 0 })) })); setRecv({}); }, 'Parts received into stock')}>
              Receive into stock
            </button>
          </div>
        )}
      </Card>
      {draft && (
        <Card title="Add line" className="no-print">
          <div className="form-grid" style={{ gridTemplateColumns: '3fr 1fr 1fr auto', alignItems: 'end' }}>
            <Field label="Part">
              <select value={add.partId} onChange={(e) => { const p = vendorParts.find((x) => x.id === Number(e.target.value)); setAdd({ ...add, partId: e.target.value, unitCostCents: p?.costCents ?? null, quantity: String(p?.reorderQty || 1) }); }}>
                <option value="">Select a part…</option>
                {vendorParts.map((p) => <option key={p.id} value={p.id}>{p.partNumber} — {p.description} ({p.qtyOnHand} on hand){p.vendorId === po.vendorId ? '' : ' · other vendor'}</option>)}
              </select>
            </Field>
            <Field label="Qty"><input inputMode="decimal" value={add.quantity} onChange={(e) => setAdd({ ...add, quantity: e.target.value })} /></Field>
            <Field label="Unit cost"><MoneyInput cents={add.unitCostCents} onChange={(c) => setAdd({ ...add, unitCostCents: c })} /></Field>
            <button className="btn btn-dark" disabled={busy || !add.partId || !(Number(add.quantity) > 0)} onClick={() => run(async () => { setData(await api.post(`/purchase-orders/${id}/lines`, { partId: Number(add.partId), quantity: Number(add.quantity), unitCostCents: add.unitCostCents ?? undefined })); setAdd({ partId: '', quantity: '1', unitCostCents: null }); })}>Add</button>
          </div>
        </Card>
      )}
      {po.notes && <div className="callout small" style={{ marginTop: 16 }}>{po.notes}</div>}
    </>
  );
}
