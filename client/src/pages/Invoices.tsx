import { useNavigate, useSearchParams } from 'react-router-dom';
import { Badge, Card, Empty, ErrorBox, Loading, Money, PageHeader, fmtDate, useApi } from '../ui';

export const INV_STATUS: Record<string, [string, string]> = {
  unpaid: ['Unpaid', 'st-unpaid'],
  partial: ['Partially paid', 'st-partial'],
  paid: ['Paid', 'st-paid'],
  void: ['Void', 'st-void'],
};

export function InvoiceStatus({ status, overdue }: { status: string; overdue?: boolean }) {
  if (overdue) return <span className="badge st-overdue">Overdue</span>;
  const [label, cls] = INV_STATUS[status] ?? [status, ''];
  return <span className={`badge ${cls}`}>{label}</span>;
}

export default function Invoices() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const { data, error } = useApi<any[]>(`/invoices${status ? `?status=${status}` : ''}`);
  const nav = useNavigate();
  const totals = data?.reduce((a, i) => ({ total: a.total + (i.voided ? 0 : i.totalCents), bal: a.bal + (i.voided ? 0 : i.balanceCents) }), { total: 0, bal: 0 });
  return (
    <>
      <PageHeader title="Invoices" sub={totals && <>Showing {data!.length} · <Money cents={totals.total} /> billed · <Money cents={totals.bal} /> outstanding</>} />
      <div className="toolbar">
        <div className="pill-tabs">
          {[['', 'All'], ['open', 'Open'], ['unpaid', 'Unpaid'], ['partial', 'Partial'], ['paid', 'Paid'], ['void', 'Void']].map(([v, l]) => (
            <button key={v} className={status === v ? 'active' : ''} onClick={() => setParams(v ? { status: v } : {})}>{l}</button>
          ))}
        </div>
      </div>
      <ErrorBox error={error} />
      <Card pad={false}>
        {!data ? <Loading /> : !data.length ? <Empty>No invoices.</Empty> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Invoice</th><th>Customer</th><th>Work order</th><th>Issued</th><th>Due</th><th>Status</th><th className="num">Total</th><th className="num">Balance</th></tr></thead>
            <tbody>{data.map((i) => (
              <tr key={i.id} className="clickable" onClick={() => nav(`/invoices/${i.id}`)}>
                <td><b>{i.number}</b></td>
                <td>{i.customerName}<div className="sub">Unit {i.unitNumber}</div></td>
                <td>{i.workOrderNumber}</td>
                <td className="nowrap">{fmtDate(i.issuedAt)}</td>
                <td className="nowrap">{fmtDate(i.dueAt)}</td>
                <td><InvoiceStatus status={i.status} overdue={i.overdue} /></td>
                <td className="num"><Money cents={i.totalCents} /></td>
                <td className="num">{i.balanceCents > 0 && !i.voided ? <Money cents={i.balanceCents} /> : <span className="faint">—</span>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      {data && !data.length && status === '' && <Badge>Invoices are created from completed work orders.</Badge>}
    </>
  );
}
