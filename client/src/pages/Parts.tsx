import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { formatMoney } from '../../../shared/money';
import { api } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, Empty, ErrorBox, Field, Loading, Modal, MoneyInput, PageHeader, SearchInput, fmtDate, useAction, useApi, useDebounced } from '../ui';

export default function Parts() {
  const [params, setParams] = useSearchParams();
  const low = params.get('low') === '1';
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const { data, error, reload } = useApi<any[]>(`/parts?q=${encodeURIComponent(dq)}${low ? '&low=1' : ''}`);
  const { can } = useAuth();
  const [editing, setEditing] = useState<any | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  const { busy, run } = useAction();
  const nav = useNavigate();
  const mgr = can('parts_manager');
  const value = data?.reduce((a, p) => a + Math.max(0, p.qtyOnHand) * p.costCents, 0) ?? 0;

  return (
    <>
      <PageHeader
        title="Parts inventory"
        sub={data && `${data.length} parts · ${formatMoney(Math.round(value))} on hand at cost`}
        actions={mgr && (
          <>
            <button className="btn" disabled={busy} onClick={() => run(async () => { const r = await api.post('/purchase-orders/auto-reorder'); if (r.created.length) nav('/purchase-orders'); return r; }, 'Reorder check complete')}>Auto-reorder low stock</button>
            <button className="btn btn-primary" onClick={() => setEditing({})}>+ New part</button>
          </>
        )}
      />
      <div className="toolbar">
        <SearchInput value={q} onChange={setQ} placeholder="Search part #, description, manufacturer, category…" />
        <div className="pill-tabs">
          <button className={!low ? 'active' : ''} onClick={() => setParams({})}>All parts</button>
          <button className={low ? 'active' : ''} onClick={() => setParams({ low: '1' })}>Low stock</button>
        </div>
      </div>
      <ErrorBox error={error} />
      <Card pad={false}>
        {!data ? <Loading /> : !data.length ? <Empty>No parts found.</Empty> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Part #</th><th>Description</th><th>Vendor</th><th>Bin</th><th className="num">On hand</th><th className="num">On order</th><th className="num">Cost</th><th className="num">Sell</th><th className="num">Markup</th></tr></thead>
            <tbody>{data.map((p) => (
              <tr key={p.id} className="clickable" onClick={() => setViewing(p.id)}>
                <td className="mono"><b>{p.partNumber}</b></td>
                <td>{p.description} {!p.active && <Badge>Inactive</Badge>}<div className="sub">{[p.manufacturer, p.category].filter(Boolean).join(' · ')}</div></td>
                <td className="small">{p.vendorName}</td>
                <td className="mono">{p.binLocation}</td>
                <td className="num">{p.lowStock ? <Badge tone={p.qtyOnHand <= 0 ? 'bad' : 'warn'}>{p.qtyOnHand}</Badge> : p.qtyOnHand}<div className="sub">min {p.reorderPoint}</div></td>
                <td className="num">{p.onOrder || ''}</td>
                <td className="num">{formatMoney(p.costCents)}</td>
                <td className="num">{formatMoney(p.priceCents)}</td>
                <td className="num small">{p.effectiveMarkupPct}%<div className="sub">{p.priceSource === 'matrix' ? 'matrix' : p.priceSource === 'list' ? 'list price' : 'fixed'}</div></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      {editing && <PartModal part={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      {viewing && <PartView id={viewing} canEdit={mgr} onEdit={(p) => { setViewing(null); setEditing(p); }} onClose={() => { setViewing(null); reload(); }} />}
    </>
  );
}

function PartView({ id, canEdit, onEdit, onClose }: { id: number; canEdit: boolean; onEdit: (p: any) => void; onClose: () => void }) {
  const { data: p, reload } = useApi<any>(`/parts/${id}`, [id]);
  const [count, setCount] = useState('');
  const { busy, run } = useAction();
  return (
    <Modal title={p ? `${p.partNumber} — ${p.description}` : 'Part'} onClose={onClose} wide footer={canEdit && p && <button className="btn btn-primary" onClick={() => onEdit(p)}>Edit part</button>}>
      {!p ? <Loading /> : (
        <div className="stack">
          <div className="row">
            <Badge tone="info">On hand: {p.qtyOnHand}</Badge>
            <Badge>Reorder at {p.reorderPoint}</Badge>
            <Badge>Bin {p.binLocation ?? '—'}</Badge>
            <span className="spacer" />
            {canEdit && (
              <>
                <input style={{ width: 110 }} inputMode="decimal" placeholder="Counted qty" value={count} onChange={(e) => setCount(e.target.value)} />
                <button className="btn btn-sm" disabled={busy || count === ''} onClick={() => run(async () => { await api.post(`/parts/${id}/adjust`, { newQty: Number(count), note: 'Cycle count' }); setCount(''); reload(); }, 'Stock adjusted')}>Adjust stock</button>
              </>
            )}
          </div>
          <h3 style={{ fontSize: 14 }}>Stock history</h3>
          {!p.moves.length ? <Empty>No movements.</Empty> : (
            <div className="table-wrap" style={{ maxHeight: 320, overflowY: 'auto' }}><table className="table compact">
              <thead><tr><th>Date</th><th>Reason</th><th>Reference</th><th>By</th><th className="num">Qty</th></tr></thead>
              <tbody>{p.moves.map((m: any) => (
                <tr key={m.id}>
                  <td className="nowrap">{fmtDate(m.created_at, true)}</td>
                  <td>{m.reason.replace('_', ' ')}{m.note && <div className="sub">{m.note}</div>}</td>
                  <td>{m.wo_number ?? m.po_number ?? ''}</td>
                  <td className="small">{m.user_name}</td>
                  <td className="num" style={{ color: m.qty < 0 ? 'var(--bad)' : 'var(--good)' }}>{m.qty > 0 ? '+' : ''}{m.qty}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
      )}
    </Modal>
  );
}

function PartModal({ part, onClose, onSaved }: { part: any | null; onClose: () => void; onSaved: () => void }) {
  const { data: vendors } = useApi<any[]>('/vendors');
  const [f, setF] = useState<any>({
    partNumber: '', description: '', manufacturer: '', category: '', vendorId: '', costCents: 0, markupPct: '', listPriceCents: null,
    reorderPoint: 0, reorderQty: 0, binLocation: '', taxable: true, active: true, qtyOnHand: 0, ...(part ?? {}),
  });
  const { busy, run } = useAction();
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = () => run(async () => {
    const { id, moves, createdAt, ...rest } = f;
    void moves; void createdAt;
    const body = { ...rest, vendorId: f.vendorId ? Number(f.vendorId) : null, markupPct: f.markupPct === '' || f.markupPct == null ? null : Number(f.markupPct) };
    if (part) { delete body.qtyOnHand; await api.put(`/parts/${id}`, body); } else await api.post('/parts', body);
    onSaved();
  }, 'Part saved');
  return (
    <Modal title={part ? `Edit ${part.partNumber}` : 'New part'} onClose={onClose} wide footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || !f.partNumber || !f.description} onClick={save}>Save</button></>}>
      <div className="form-grid cols-3">
        <Field label="Part #"><input className="mono" value={f.partNumber} onChange={set('partNumber')} autoFocus /></Field>
        <Field label="Description" span={2}><input value={f.description} onChange={set('description')} /></Field>
        <Field label="Manufacturer"><input value={f.manufacturer ?? ''} onChange={set('manufacturer')} /></Field>
        <Field label="Category"><input value={f.category ?? ''} onChange={set('category')} /></Field>
        <Field label="Vendor">
          <select value={f.vendorId ?? ''} onChange={set('vendorId')}><option value="">—</option>{vendors?.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
        </Field>
        <Field label="Cost"><MoneyInput cents={f.costCents} onChange={(c) => setF({ ...f, costCents: c ?? 0 })} /></Field>
        <Field label="Markup % override" hint="Blank = shop matrix"><input inputMode="decimal" value={f.markupPct ?? ''} onChange={set('markupPct')} /></Field>
        <Field label="Fixed sell price" hint="Overrides markup"><MoneyInput cents={f.listPriceCents} onChange={(c) => setF({ ...f, listPriceCents: c })} /></Field>
        {!part && <Field label="Opening qty on hand"><input inputMode="decimal" value={f.qtyOnHand} onChange={set('qtyOnHand')} /></Field>}
        <Field label="Reorder point"><input inputMode="decimal" value={f.reorderPoint} onChange={set('reorderPoint')} /></Field>
        <Field label="Reorder qty"><input inputMode="decimal" value={f.reorderQty} onChange={set('reorderQty')} /></Field>
        <Field label="Bin location"><input value={f.binLocation ?? ''} onChange={set('binLocation')} /></Field>
        <label className="check"><input type="checkbox" checked={f.taxable} onChange={set('taxable')} /> Taxable</label>
        <label className="check"><input type="checkbox" checked={f.active} onChange={set('active')} /> Active</label>
      </div>
    </Modal>
  );
}
