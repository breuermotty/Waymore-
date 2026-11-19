import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatMoney } from '../../../shared/money';
import { useAuth } from '../auth';
import { Card, Empty, Loading, Money, PageHeader, Tabs, fmtHours, useApi } from '../ui';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const PRESETS: [string, () => [string, string]][] = [
  ['Last 30 days', () => [iso(new Date(Date.now() - 29 * 864e5)), iso(new Date())]],
  ['This month', () => { const n = new Date(); return [iso(new Date(Date.UTC(n.getFullYear(), n.getMonth(), 1))), iso(n)]; }],
  ['Last 90 days', () => [iso(new Date(Date.now() - 89 * 864e5)), iso(new Date())]],
  ['Year to date', () => [`${new Date().getFullYear()}-01-01`, iso(new Date())]],
];

export default function Reports() {
  const [tab, setTab] = useState<'tech' | 'revenue' | 'parts' | 'ar'>('tech');
  const [[from, to], setRange] = useState<[string, string]>(PRESETS[2][1]());
  const { can } = useAuth();
  const q = `from=${from}&to=${to}`;
  return (
    <>
      <PageHeader title="Reports" />
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'tech', label: 'Technician productivity' },
        { id: 'revenue', label: 'Revenue' },
        { id: 'parts', label: 'Parts usage' },
        { id: 'ar', label: 'A/R aging' },
      ]} />
      {tab !== 'ar' && (
        <div className="toolbar">
          <input type="date" value={from} onChange={(e) => setRange([e.target.value, to])} style={{ width: 'auto' }} />
          <span className="muted">to</span>
          <input type="date" value={to} onChange={(e) => setRange([from, e.target.value])} style={{ width: 'auto' }} />
          <div className="pill-tabs">
            {PRESETS.map(([l, f]) => <button key={l} onClick={() => setRange(f())}>{l}</button>)}
          </div>
        </div>
      )}
      {tab === 'tech' && <TechReport q={q} />}
      {tab === 'revenue' && <RevenueReport q={q} />}
      {tab === 'parts' && can('service_writer', 'parts_manager') && <PartsReport q={q} />}
      {tab === 'ar' && <ArReport />}
    </>
  );
}

function TechReport({ q }: { q: string }) {
  const { data } = useApi<any>(`/reports/technicians?${q}`, [q]);
  if (!data) return <Loading />;
  const tone = (e: number | null) => (e == null ? '' : e >= 100 ? '' : e >= 85 ? 'warn' : 'bad');
  return (
    <Card pad={false} title="Clocked vs. billed hours" actions={<span className="small muted">Efficiency = billed (book) hours ÷ actual hours on completed jobs</span>}>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>Technician</th><th className="num">Hours clocked</th><th className="num">Jobs completed</th><th className="num">Billed hours</th><th className="num">Actual on those jobs</th><th>Efficiency</th><th className="num">Labor sold</th></tr></thead>
        <tbody>{data.rows.map((r: any) => (
          <tr key={r.id}>
            <td><b>{r.name}</b></td>
            <td className="num">{fmtHours(r.clockedHours)}</td>
            <td className="num">{r.jobsCompleted}</td>
            <td className="num">{fmtHours(r.billedHours)}</td>
            <td className="num">{fmtHours(r.actualHoursOnCompleted)}</td>
            <td style={{ minWidth: 160 }}>
              {r.efficiencyPct == null ? <span className="faint">—</span> : (
                <div className="row" style={{ flexWrap: 'nowrap' }}>
                  <div className={`meter ${tone(r.efficiencyPct)}`} style={{ flex: 1 }}><span style={{ width: `${Math.min(100, r.efficiencyPct / 1.5)}%` }} /></div>
                  <b className="num">{r.efficiencyPct}%</b>
                </div>
              )}
            </td>
            <td className="num"><Money cents={r.laborSoldCents} /></td>
          </tr>
        ))}</tbody>
      </table></div>
    </Card>
  );
}

function RevenueReport({ q }: { q: string }) {
  const { data } = useApi<any>(`/reports/revenue?${q}`, [q]);
  if (!data) return <Loading />;
  const sum = (k: string) => data.rows.reduce((a: number, r: any) => a + r[k], 0);
  const gp = sum('partsCents') - sum('partsCostCents');
  return (
    <div className="stack">
      <div className="stats">
        <div className="stat"><div className="stat-label">Revenue (pre-tax)</div><div className="stat-value">{formatMoney(sum('totalCents') - sum('taxCents'))}</div></div>
        <div className="stat"><div className="stat-label">Labor</div><div className="stat-value">{formatMoney(sum('laborCents'))}</div></div>
        <div className="stat"><div className="stat-label">Parts</div><div className="stat-value">{formatMoney(sum('partsCents'))}</div></div>
        <div className="stat stat-good"><div className="stat-label">Parts gross profit</div><div className="stat-value">{formatMoney(gp)}</div><div className="stat-hint">{sum('partsCents') ? Math.round((gp / sum('partsCents')) * 100) : 0}% margin</div></div>
      </div>
      <div className="grid grid-2">
        <Card pad={false} title="By month">
          {!data.rows.length ? <Empty>No invoices in range.</Empty> : (
            <div className="table-wrap"><table className="table compact">
              <thead><tr><th>Month</th><th className="num">Inv.</th><th className="num">Labor</th><th className="num">Parts</th><th className="num">Supplies</th><th className="num">Tax</th><th className="num">Total</th></tr></thead>
              <tbody>{data.rows.map((r: any) => (
                <tr key={r.month}><td>{r.month}</td><td className="num">{r.invoices}</td><td className="num">{formatMoney(r.laborCents)}</td><td className="num">{formatMoney(r.partsCents)}</td><td className="num">{formatMoney(r.shopSuppliesCents)}</td><td className="num">{formatMoney(r.taxCents)}</td><td className="num"><b>{formatMoney(r.totalCents)}</b></td></tr>
              ))}</tbody>
            </table></div>
          )}
        </Card>
        <Card pad={false} title="Top customers">
          {!data.byCustomer.length ? <Empty>No invoices in range.</Empty> : (
            <table className="table compact"><tbody>{data.byCustomer.map((c: any) => (
              <tr key={c.id}><td><Link to={`/customers/${c.id}`}>{c.name}</Link></td><td className="num">{c.invoices} inv.</td><td className="num"><b>{formatMoney(c.revenueCents)}</b></td></tr>
            ))}</tbody></table>
          )}
        </Card>
      </div>
    </div>
  );
}

function PartsReport({ q }: { q: string }) {
  const { data } = useApi<any>(`/reports/parts-usage?${q}`, [q]);
  if (!data) return <Loading />;
  return (
    <Card pad={false} title="Parts sold on work orders">
      {!data.rows.length ? <Empty>No parts used in range.</Empty> : (
        <div className="table-wrap"><table className="table compact">
          <thead><tr><th>Part #</th><th>Description</th><th className="num">Qty</th><th className="num">WOs</th><th className="num">Revenue</th><th className="num">Cost</th><th className="num">Margin</th></tr></thead>
          <tbody>{data.rows.map((r: any) => (
            <tr key={r.partNumber}><td className="mono">{r.partNumber}</td><td>{r.description}</td><td className="num">{r.qty}</td><td className="num">{r.workOrders}</td><td className="num">{formatMoney(r.revenueCents)}</td><td className="num">{formatMoney(r.costCents)}</td><td className="num">{r.revenueCents ? Math.round(((r.revenueCents - r.costCents) / r.revenueCents) * 100) : 0}%</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </Card>
  );
}

function ArReport() {
  const { data } = useApi<any>('/reports/ar-aging');
  if (!data) return <Loading />;
  const total = (b: string) => data.rows.reduce((a: number, r: any) => a + r[b], 0);
  return (
    <Card pad={false} title="Accounts receivable aging (days past due)">
      {!data.rows.length ? <Empty>No open balances. Everyone's paid up.</Empty> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Customer</th>{data.buckets.map((b: string) => <th key={b} className="num">{b === 'current' ? 'Current' : b}</th>)}<th className="num">Total</th></tr></thead>
          <tbody>{data.rows.map((r: any) => (
            <tr key={r.customerId}><td><Link to={`/customers/${r.customerId}`}>{r.customerName}</Link></td>{data.buckets.map((b: string) => <td key={b} className="num" style={{ color: b !== 'current' && r[b] ? 'var(--bad)' : undefined }}>{r[b] ? formatMoney(r[b]) : '—'}</td>)}<td className="num"><b>{formatMoney(r.total)}</b></td></tr>
          ))}</tbody>
          <tfoot><tr><td>Total</td>{data.buckets.map((b: string) => <td key={b} className="num">{formatMoney(total(b))}</td>)}<td className="num">{formatMoney(total('total'))}</td></tr></tfoot>
        </table></div>
      )}
    </Card>
  );
}
