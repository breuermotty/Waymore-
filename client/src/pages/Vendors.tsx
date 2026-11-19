import { useState } from 'react';
import { api } from '../api';
import { Card, Empty, ErrorBox, Field, Loading, Modal, PageHeader, useAction, useApi } from '../ui';

export default function Vendors() {
  const { data, error, reload } = useApi<any[]>('/vendors');
  const [editing, setEditing] = useState<any | null>(null);
  return (
    <>
      <PageHeader title="Vendors" sub="Parts suppliers" actions={<button className="btn btn-primary" onClick={() => setEditing({})}>+ New vendor</button>} />
      <ErrorBox error={error} />
      <Card pad={false}>
        {!data ? <Loading /> : !data.length ? <Empty>No vendors.</Empty> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Vendor</th><th>Contact</th><th>Account #</th><th className="num">Parts</th><th className="num">Open POs</th></tr></thead>
            <tbody>{data.map((v) => (
              <tr key={v.id} className="clickable" onClick={() => setEditing(v)}>
                <td><b>{v.name}</b><div className="sub">{v.address}</div></td>
                <td className="small">{v.contactName}<div className="sub">{[v.phone, v.email].filter(Boolean).join(' · ')}</div></td>
                <td className="mono">{v.accountNumber}</td>
                <td className="num">{v.partCount}</td>
                <td className="num">{v.openPoCount}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      {editing && <VendorModal vendor={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </>
  );
}

function VendorModal({ vendor, onClose, onSaved }: { vendor: any | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<any>({ name: '', contactName: '', phone: '', email: '', accountNumber: '', address: '', notes: '', ...(vendor ?? {}) });
  const { busy, run } = useAction();
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const save = () => run(async () => {
    const { id, partCount, openPoCount, ...body } = f;
    void partCount; void openPoCount;
    if (vendor) await api.put(`/vendors/${id}`, body); else await api.post('/vendors', body);
    onSaved();
  }, 'Vendor saved');
  return (
    <Modal title={vendor ? 'Edit vendor' : 'New vendor'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || !f.name} onClick={save}>Save</button></>}>
      <div className="form-grid">
        <Field label="Name" span={2}><input value={f.name} onChange={set('name')} autoFocus /></Field>
        <Field label="Contact"><input value={f.contactName ?? ''} onChange={set('contactName')} /></Field>
        <Field label="Account #"><input value={f.accountNumber ?? ''} onChange={set('accountNumber')} /></Field>
        <Field label="Phone"><input value={f.phone ?? ''} onChange={set('phone')} /></Field>
        <Field label="Email"><input value={f.email ?? ''} onChange={set('email')} /></Field>
        <Field label="Address" span={2}><input value={f.address ?? ''} onChange={set('address')} /></Field>
        <Field label="Notes" span={2}><textarea rows={2} value={f.notes ?? ''} onChange={set('notes')} /></Field>
      </div>
    </Modal>
  );
}
