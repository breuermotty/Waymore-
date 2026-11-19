/* Shared create/edit modals for customers, contacts, units and PM schedules. */
import { useState } from 'react';
import { PAYMENT_TERMS, UNIT_TYPES } from '../../../shared/constants';
import { api } from '../api';
import { Field, Modal, MoneyInput, useAction } from '../ui';

export const TERMS_LABEL: Record<string, string> = { due_on_receipt: 'Due on receipt', net15: 'Net 15', net30: 'Net 30', net45: 'Net 45', net60: 'Net 60' };
export const UNIT_TYPE_LABEL: Record<string, string> = {
  tractor: 'Tractor',
  straight_truck: 'Straight truck',
  trailer: 'Trailer',
  bus: 'Bus',
  pickup: 'Pickup / light duty',
  reefer: 'Reefer trailer',
  equipment: 'Equipment',
  other: 'Other',
};

const Foot = ({ onClose, onSave, busy, disabled }: { onClose: () => void; onSave: () => void; busy: boolean; disabled?: boolean }) => (
  <>
    <button className="btn" onClick={onClose}>Cancel</button>
    <button className="btn btn-primary" disabled={busy || disabled} onClick={onSave}>Save</button>
  </>
);

export function CustomerModal({ customer, onClose, onSaved }: { customer?: any; onClose: () => void; onSaved: (c: any) => void }) {
  const [f, setF] = useState<any>({
    name: '', accountNumber: '', phone: '', email: '', billingAddress: '', billingCity: '', billingState: '', billingZip: '',
    paymentTerms: 'due_on_receipt', taxExempt: false, laborRateCents: null, partsMarkupPct: '', requiresPo: false, notes: '',
    ...(customer ?? {}),
  });
  const { busy, run } = useAction();
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = () => run(async () => {
    const body = { ...f, partsMarkupPct: f.partsMarkupPct === '' || f.partsMarkupPct == null ? null : Number(f.partsMarkupPct) };
    onSaved(customer ? await api.put(`/customers/${customer.id}`, body) : await api.post('/customers', body));
  }, 'Customer saved');
  return (
    <Modal title={customer ? 'Edit customer' : 'New customer'} onClose={onClose} wide footer={<Foot onClose={onClose} onSave={save} busy={busy} disabled={!f.name?.trim()} />}>
      <div className="form-grid cols-3">
        <Field label="Company name" span={2}><input value={f.name} onChange={set('name')} autoFocus /></Field>
        <Field label="Account #"><input value={f.accountNumber ?? ''} onChange={set('accountNumber')} /></Field>
        <Field label="Phone"><input value={f.phone ?? ''} onChange={set('phone')} /></Field>
        <Field label="Email" span={2}><input type="email" value={f.email ?? ''} onChange={set('email')} /></Field>
        <Field label="Billing address" span={3}><input value={f.billingAddress ?? ''} onChange={set('billingAddress')} /></Field>
        <Field label="City"><input value={f.billingCity ?? ''} onChange={set('billingCity')} /></Field>
        <Field label="State"><input value={f.billingState ?? ''} onChange={set('billingState')} maxLength={2} /></Field>
        <Field label="ZIP"><input value={f.billingZip ?? ''} onChange={set('billingZip')} /></Field>
        <Field label="Payment terms">
          <select value={f.paymentTerms} onChange={set('paymentTerms')}>{PAYMENT_TERMS.map((t) => <option key={t} value={t}>{TERMS_LABEL[t]}</option>)}</select>
        </Field>
        <Field label="Labor rate override" hint="Blank = shop default"><MoneyInput cents={f.laborRateCents} onChange={(c) => setF({ ...f, laborRateCents: c })} /></Field>
        <Field label="Parts markup override %" hint="Blank = shop matrix"><input inputMode="decimal" value={f.partsMarkupPct ?? ''} onChange={set('partsMarkupPct')} /></Field>
        <label className="check"><input type="checkbox" checked={f.taxExempt} onChange={set('taxExempt')} /> Tax exempt</label>
        <label className="check span-2"><input type="checkbox" checked={f.requiresPo} onChange={set('requiresPo')} /> Requires PO # on invoices</label>
        <Field label="Notes (shown to service writers)" span={3}><textarea rows={2} value={f.notes ?? ''} onChange={set('notes')} /></Field>
      </div>
    </Modal>
  );
}

export function ContactModal({ customerId, contact, onClose, onSaved }: { customerId: number; contact?: any; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<any>({ name: '', title: '', phone: '', email: '', isPrimary: false, canAuthorize: true, ...(contact ?? {}) });
  const { busy, run } = useAction();
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = () => run(async () => {
    if (contact) await api.put(`/contacts/${contact.id}`, f);
    else await api.post(`/customers/${customerId}/contacts`, f);
    onSaved();
  }, 'Contact saved');
  return (
    <Modal title={contact ? 'Edit contact' : 'Add contact'} onClose={onClose} footer={
      <>
        {contact && <button className="btn btn-danger" style={{ marginRight: 'auto' }} onClick={() => run(async () => { await api.del(`/contacts/${contact.id}`); onSaved(); })}>Delete</button>}
        <Foot onClose={onClose} onSave={save} busy={busy} disabled={!f.name?.trim()} />
      </>
    }>
      <div className="form-grid">
        <Field label="Name"><input value={f.name} onChange={set('name')} autoFocus /></Field>
        <Field label="Title"><input value={f.title ?? ''} onChange={set('title')} /></Field>
        <Field label="Phone"><input value={f.phone ?? ''} onChange={set('phone')} /></Field>
        <Field label="Email"><input value={f.email ?? ''} onChange={set('email')} /></Field>
        <label className="check"><input type="checkbox" checked={f.isPrimary} onChange={set('isPrimary')} /> Primary contact</label>
        <label className="check"><input type="checkbox" checked={f.canAuthorize} onChange={set('canAuthorize')} /> Can authorize repairs</label>
      </div>
    </Modal>
  );
}

export function UnitModal({ unit, customerId, customers, onClose, onSaved }: { unit?: any; customerId?: number; customers?: any[]; onClose: () => void; onSaved: (u: any) => void }) {
  const [f, setF] = useState<any>({
    customerId: customerId ?? '', unitNumber: '', vin: '', year: '', make: '', model: '', type: 'tractor', licensePlate: '', engine: '', mileage: '', engineHours: '', notes: '', active: true,
    ...(unit ?? {}),
  });
  const { busy, run } = useAction();
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = () => run(async () => {
    const body = { ...f, customerId: Number(f.customerId) };
    onSaved(unit ? await api.put(`/units/${unit.id}`, body) : await api.post('/units', body));
  }, 'Unit saved');
  return (
    <Modal title={unit ? `Edit unit ${unit.unitNumber}` : 'Add unit'} onClose={onClose} wide footer={<Foot onClose={onClose} onSave={save} busy={busy} disabled={!f.unitNumber?.trim() || !f.customerId} />}>
      <div className="form-grid cols-3">
        {customers && (
          <Field label="Customer" span={3}>
            <select value={f.customerId} onChange={set('customerId')}>
              <option value="">Select…</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Unit #"><input value={f.unitNumber} onChange={set('unitNumber')} autoFocus /></Field>
        <Field label="Type">
          <select value={f.type} onChange={set('type')}>{UNIT_TYPES.map((t) => <option key={t} value={t}>{UNIT_TYPE_LABEL[t]}</option>)}</select>
        </Field>
        <Field label="License plate"><input value={f.licensePlate ?? ''} onChange={set('licensePlate')} /></Field>
        <Field label="VIN" span={2}><input className="mono" value={f.vin ?? ''} onChange={set('vin')} maxLength={17} style={{ textTransform: 'uppercase' }} /></Field>
        <Field label="Year"><input inputMode="numeric" value={f.year ?? ''} onChange={set('year')} /></Field>
        <Field label="Make"><input value={f.make ?? ''} onChange={set('make')} /></Field>
        <Field label="Model"><input value={f.model ?? ''} onChange={set('model')} /></Field>
        <Field label="Engine"><input value={f.engine ?? ''} onChange={set('engine')} /></Field>
        <Field label="Odometer (mi)"><input inputMode="numeric" value={f.mileage ?? ''} onChange={set('mileage')} /></Field>
        <Field label="Engine / reefer hours"><input inputMode="decimal" value={f.engineHours ?? ''} onChange={set('engineHours')} /></Field>
        <label className="check"><input type="checkbox" checked={f.active} onChange={set('active')} /> Active in fleet</label>
        <Field label="Notes" span={3}><textarea rows={2} value={f.notes ?? ''} onChange={set('notes')} /></Field>
      </div>
    </Modal>
  );
}

export function PmModal({ unitId, pm, onClose, onSaved }: { unitId: number; pm?: any; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<any>({ name: '', intervalDays: '', intervalMiles: '', intervalHours: '', lastDoneAt: '', lastDoneMiles: '', lastDoneHours: '', notes: '', active: true, ...(pm ?? {}) });
  const { busy, run } = useAction();
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const { due, id, unitId: _u, ...body } = f;
  void due; void id; void _u;
  const save = () => run(async () => {
    if (pm) await api.put(`/pm/${pm.id}`, body);
    else await api.post(`/units/${unitId}/pm`, body);
    onSaved();
  }, 'PM schedule saved');
  return (
    <Modal title={pm ? 'Edit PM schedule' : 'Add PM schedule'} onClose={onClose} footer={
      <>
        {pm && <button className="btn btn-danger" style={{ marginRight: 'auto' }} onClick={() => confirm('Delete this PM schedule?') && run(async () => { await api.del(`/pm/${pm.id}`); onSaved(); })}>Delete</button>}
        <Foot onClose={onClose} onSave={save} busy={busy} disabled={!f.name?.trim()} />
      </>
    }>
      <div className="stack">
        <Field label="Service name"><input value={f.name} onChange={set('name')} placeholder="e.g. PM-A (oil & filters)" autoFocus /></Field>
        <div className="small muted">Due at whichever interval comes first. Leave an interval blank to ignore it.</div>
        <div className="form-grid cols-3">
          <Field label="Every (days)"><input inputMode="numeric" value={f.intervalDays ?? ''} onChange={set('intervalDays')} /></Field>
          <Field label="Every (miles)"><input inputMode="numeric" value={f.intervalMiles ?? ''} onChange={set('intervalMiles')} /></Field>
          <Field label="Every (engine hrs)"><input inputMode="numeric" value={f.intervalHours ?? ''} onChange={set('intervalHours')} /></Field>
          <Field label="Last done (date)"><input type="date" value={f.lastDoneAt ?? ''} onChange={set('lastDoneAt')} /></Field>
          <Field label="Last done (miles)"><input inputMode="numeric" value={f.lastDoneMiles ?? ''} onChange={set('lastDoneMiles')} /></Field>
          <Field label="Last done (hrs)"><input inputMode="decimal" value={f.lastDoneHours ?? ''} onChange={set('lastDoneHours')} /></Field>
        </div>
        <Field label="Notes"><input value={f.notes ?? ''} onChange={set('notes')} /></Field>
        <label className="check"><input type="checkbox" checked={f.active} onChange={set('active')} /> Active</label>
      </div>
    </Modal>
  );
}
