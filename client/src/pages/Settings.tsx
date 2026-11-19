import { useEffect, useState } from 'react';
import { ROLES, ROLE_LABELS } from '../../../shared/constants';
import { formatMoney } from '../../../shared/money';
import { api } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, ErrorBox, Field, Loading, Modal, MoneyInput, PageHeader, Tabs, useAction, useApi } from '../ui';

export default function Settings() {
  const [tab, setTab] = useState<'shop' | 'users' | 'inspections'>('shop');
  const { can } = useAuth();
  if (!can()) return <ErrorBox error="Only admins can change settings." />;
  return (
    <>
      <PageHeader title="Settings" />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'shop', label: 'Shop & pricing' }, { id: 'users', label: 'Users & roles' }, { id: 'inspections', label: 'Inspection checklists' }]} />
      {tab === 'shop' && <ShopSettings />}
      {tab === 'users' && <Users />}
      {tab === 'inspections' && <Checklists />}
    </>
  );
}

function ShopSettings() {
  const { data, setData } = useApi<any>('/settings');
  const [f, setF] = useState<any>(null);
  const { busy, run } = useAction();
  useEffect(() => { if (data) setF(data); }, [data]);
  if (!f) return <Loading />;
  const set = (k: string, num = false) => (e: any) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : num ? Number(e.target.value) : e.target.value });
  const setTier = (i: number, patch: any) => setF({ ...f, markupMatrix: f.markupMatrix.map((t: any, j: number) => (i === j ? { ...t, ...patch } : t)) });
  const { id, ...body } = f;
  void id;
  return (
    <div className="grid grid-2">
      <Card title="Shop">
        <div className="form-grid">
          <Field label="Shop name" span={2}><input value={f.name} onChange={set('name')} /></Field>
          <Field label="Address" span={2}><input value={f.address ?? ''} onChange={set('address')} /></Field>
          <Field label="City"><input value={f.city ?? ''} onChange={set('city')} /></Field>
          <Field label="State / ZIP"><div className="row" style={{ flexWrap: 'nowrap' }}><input value={f.state ?? ''} onChange={set('state')} style={{ width: 70 }} /><input value={f.zip ?? ''} onChange={set('zip')} /></div></Field>
          <Field label="Phone"><input value={f.phone ?? ''} onChange={set('phone')} /></Field>
          <Field label="Email"><input value={f.email ?? ''} onChange={set('email')} /></Field>
          <Field label="Invoice footer" span={2}><textarea rows={3} value={f.invoiceFooter ?? ''} onChange={set('invoiceFooter')} /></Field>
        </div>
      </Card>
      <div className="stack">
        <Card title="Labor, tax & fees">
          <div className="form-grid">
            <Field label="Default labor rate / hr"><MoneyInput cents={f.defaultLaborRateCents} onChange={(c) => setF({ ...f, defaultLaborRateCents: c ?? 0 })} /></Field>
            <Field label="Parts sales tax %"><input inputMode="decimal" value={f.partsTaxRatePct} onChange={set('partsTaxRatePct', true)} /></Field>
            <Field label="Labor tax %" hint="0 if labor isn't taxable"><input inputMode="decimal" value={f.laborTaxRatePct} onChange={set('laborTaxRatePct', true)} /></Field>
            <Field label="Shop supplies %"><input inputMode="decimal" value={f.shopSuppliesPct} onChange={set('shopSuppliesPct', true)} /></Field>
            <Field label="Shop supplies based on">
              <select value={f.shopSuppliesBase} onChange={set('shopSuppliesBase')}><option value="labor">Labor</option><option value="labor_parts">Labor + parts</option></select>
            </Field>
            <Field label="Shop supplies cap" hint="0 = no cap"><MoneyInput cents={f.shopSuppliesCapCents} onChange={(c) => setF({ ...f, shopSuppliesCapCents: c ?? 0 })} /></Field>
            <label className="check"><input type="checkbox" checked={f.shopSuppliesTaxable} onChange={set('shopSuppliesTaxable')} /> Shop supplies are taxable</label>
          </div>
        </Card>
        <Card title="Parts markup matrix" actions={<button className="btn btn-sm" onClick={() => setF({ ...f, markupMatrix: [...f.markupMatrix.slice(0, -1), { upToCents: (f.markupMatrix.at(-2)?.upToCents ?? 0) + 10000, markupPct: 30 }, f.markupMatrix.at(-1)] })}>+ Tier</button>}>
          <div className="small muted" style={{ marginBottom: 10 }}>Markup applied by part cost. Customer and part-level overrides take precedence.</div>
          <table className="table compact">
            <thead><tr><th>Cost up to</th><th>Markup %</th><th>Example</th><th /></tr></thead>
            <tbody>{f.markupMatrix.map((t: any, i: number) => (
              <tr key={i}>
                <td>{t.upToCents == null ? <span className="muted">and above</span> : <MoneyInput cents={t.upToCents} onChange={(c) => setTier(i, { upToCents: c ?? 0 })} />}</td>
                <td><input inputMode="decimal" value={t.markupPct} onChange={(e) => setTier(i, { markupPct: Number(e.target.value) })} style={{ width: 80 }} /></td>
                <td className="small muted">{t.upToCents != null && `${formatMoney(t.upToCents)} → ${formatMoney(Math.round(t.upToCents * (1 + t.markupPct / 100)))}`}</td>
                <td>{t.upToCents != null && f.markupMatrix.length > 2 && <button className="link-btn danger" onClick={() => setF({ ...f, markupMatrix: f.markupMatrix.filter((_: any, j: number) => j !== i) })}>Remove</button>}</td>
              </tr>
            ))}</tbody>
          </table>
        </Card>
        <div className="row"><span className="spacer" /><button className="btn btn-primary" disabled={busy} onClick={() => run(async () => setData(await api.put('/settings', body)), 'Settings saved')}>Save settings</button></div>
      </div>
    </div>
  );
}

function Users() {
  const { data, reload } = useApi<any[]>('/users');
  const [editing, setEditing] = useState<any | null>(null);
  if (!data) return <Loading />;
  return (
    <>
      <Card pad={false} title="Team" actions={<button className="btn btn-primary btn-sm" onClick={() => setEditing({})}>+ Add user</button>}>
        <table className="table">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th></tr></thead>
          <tbody>{data.map((u) => (
            <tr key={u.id} className="clickable" onClick={() => setEditing(u)}>
              <td><b>{u.name}</b><div className="sub">{u.phone}</div></td>
              <td>{u.email}</td>
              <td>{ROLE_LABELS[u.role as keyof typeof ROLE_LABELS]}</td>
              <td>{u.active ? <Badge tone="good">Active</Badge> : <Badge>Inactive</Badge>}</td>
            </tr>
          ))}</tbody>
        </table>
      </Card>
      <Card title="What each role can do" className="small" >
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li><b>Admin</b>: everything, including settings, users, voiding invoices and deleting payments.</li>
          <li><b>Service writer</b>: customers, units, estimates and work orders, approvals, invoices and payments, reports.</li>
          <li><b>Technician</b>: assigned jobs, clocking in and out, cause and correction notes, photos and inspections.</li>
          <li><b>Parts manager</b>: inventory, vendors, purchase orders and receiving, and adding parts to jobs.</li>
        </ul>
      </Card>
      {editing && <UserModal user={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </>
  );
}

function UserModal({ user, onClose, onSaved }: { user: any | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<any>({ name: '', email: '', role: 'technician', phone: '', active: true, password: '', ...(user ?? {}) });
  const { busy, run } = useAction();
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = () => run(async () => {
    const { id, password, ...rest } = f;
    const body = password ? { ...rest, password } : rest;
    if (user) await api.put(`/users/${id}`, body); else await api.post('/users', body);
    onSaved();
  }, 'User saved');
  return (
    <Modal title={user ? `Edit ${user.name}` : 'Add user'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={save}>Save</button></>}>
      <div className="form-grid">
        <Field label="Name"><input value={f.name} onChange={set('name')} autoFocus /></Field>
        <Field label="Email"><input type="email" value={f.email} onChange={set('email')} /></Field>
        <Field label="Role"><select value={f.role} onChange={set('role')}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select></Field>
        <Field label="Phone"><input value={f.phone ?? ''} onChange={set('phone')} /></Field>
        <Field label={user ? 'New password (optional)' : 'Password'} hint="At least 8 characters"><input type="password" autoComplete="new-password" value={f.password} onChange={set('password')} /></Field>
        <label className="check"><input type="checkbox" checked={f.active} onChange={set('active')} /> Active</label>
      </div>
    </Modal>
  );
}

function Checklists() {
  const { data, reload } = useApi<any[]>('/inspection-templates');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [text, setText] = useState('Section name\n- Item one\n- Item two');
  const { busy, run } = useAction();
  if (!data) return <Loading />;
  const parse = () => {
    const sections: { section: string; items: string[] }[] = [];
    text.split('\n').map((l) => l.trim()).filter(Boolean).forEach((l) => {
      if (l.startsWith('-')) sections.at(-1)?.items.push(l.slice(1).trim());
      else sections.push({ section: l, items: [] });
    });
    return sections.filter((s) => s.items.length);
  };
  return (
    <>
      <div className="grid grid-3">
        {data.map((t) => (
          <Card key={t.id} title={t.name}>
            <div className="small muted" style={{ marginBottom: 8 }}>{t.description}</div>
            {t.sections.map((s: any) => <div key={s.section} className="small"><b>{s.section}</b> · {s.items.length} items</div>)}
          </Card>
        ))}
      </div>
      <div style={{ marginTop: 16 }}><button className="btn" onClick={() => setCreating(true)}>+ New checklist</button></div>
      {creating && (
        <Modal title="New inspection checklist" onClose={() => setCreating(false)} footer={<><button className="btn" onClick={() => setCreating(false)}>Cancel</button><button className="btn btn-primary" disabled={busy || !name || !parse().length} onClick={() => run(async () => { await api.post('/inspection-templates', { name, sections: parse() }); setCreating(false); reload(); }, 'Checklist created')}>Create</button></>}>
          <div className="stack">
            <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Liftgate inspection" /></Field>
            <Field label="Sections and items" hint="One section per line, items start with a dash"><textarea rows={10} className="mono" value={text} onChange={(e) => setText(e.target.value)} /></Field>
          </div>
        </Modal>
      )}
    </>
  );
}
