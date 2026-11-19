import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { WO_STATUS_LABELS, type WorkOrderStatus } from '../../shared/constants';
import { formatMoney } from '../../shared/money';
import { api } from './api';

/* ------------------------------- Data hook ------------------------------- */

export function useApi<T = any>(url: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!url);
  const seq = useRef(0);

  const reload = useCallback(async () => {
    if (!url) return;
    const n = ++seq.current;
    setLoading(true);
    try {
      const d = await api.get<T>(url);
      if (n === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (e: any) {
      if (n === seq.current) setError(e.message);
    } finally {
      if (n === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, ...deps]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, setData, error, loading, reload };
}

/** Wrap an async action with busy state + toast on error. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
    setBusy(true);
    try {
      const r = await fn();
      if (success) toast(success);
      return r;
    } catch (e: any) {
      toast(e.message ?? 'Something went wrong', 'error');
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, run };
}

/* -------------------------------- Toasts -------------------------------- */

type ToastItem = { id: number; msg: string; kind: 'ok' | 'error' };
let pushToast: (t: ToastItem) => void = () => {};
let toastId = 0;
export function toast(msg: string, kind: 'ok' | 'error' = 'ok') {
  pushToast({ id: ++toastId, msg, kind });
}

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => {
    pushToast = (t) => {
      setItems((xs) => [...xs, t]);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== t.id)), t.kind === 'error' ? 6000 : 3000);
    };
  }, []);
  return (
    <div className="toaster" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          {t.msg}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------- Layout bits ------------------------------ */

export function PageHeader({ title, sub, actions, back }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; back?: { to: string; label: string } }) {
  return (
    <div className="page-header">
      <div>
        {back && (
          <Link className="back-link" to={back.to}>
            ← {back.label}
          </Link>
        )}
        <h1>{title}</h1>
        {sub && <div className="page-sub">{sub}</div>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className = '', pad = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-head">
          <h2>{title}</h2>
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      <div className={pad ? 'card-body' : ''}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, tone, to }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'warn' | 'bad' | 'good'; to?: string }) {
  const body = (
    <>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </>
  );
  return to ? (
    <Link to={to} className={`stat stat-link ${tone ? `stat-${tone}` : ''}`}>
      {body}
    </Link>
  ) : (
    <div className={`stat ${tone ? `stat-${tone}` : ''}`}>{body}</div>
  );
}

export function Loading() {
  return <div className="loading">Loading…</div>;
}

export function ErrorBox({ error }: { error: string | null }) {
  return error ? <div className="error-box">{error}</div> : null;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function StatusBadge({ status }: { status: WorkOrderStatus }) {
  return <span className={`badge status-${status}`}>{WO_STATUS_LABELS[status] ?? status}</span>;
}

export function PriorityBadge({ priority }: { priority: string }) {
  if (priority === 'normal') return null;
  const label = { down: 'Unit down', high: 'High', low: 'Low' }[priority] ?? priority;
  return <span className={`badge prio-${priority}`}>{label}</span>;
}

export const Money = ({ cents, className }: { cents: number | null | undefined; className?: string }) => (
  <span className={`num ${className ?? ''}`}>{formatMoney(cents)}</span>
);

/* -------------------------------- Modal --------------------------------- */

export function Modal({ title, onClose, children, wide, footer }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

/* -------------------------------- Forms --------------------------------- */

export function Field({ label, children, hint, span }: { label: string; children: ReactNode; hint?: ReactNode; span?: 1 | 2 | 3 }) {
  return (
    <label className={`field ${span ? `span-${span}` : ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

/** Text input bound to a dollar amount, emitting integer cents. */
export function MoneyInput({ cents, onChange, ...rest }: { cents: number | null | undefined; onChange: (c: number | null) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'>) {
  const [text, setText] = useState(cents == null ? '' : (cents / 100).toFixed(2));
  useEffect(() => {
    const cur = text === '' ? null : Math.round(parseFloat(text) * 100);
    if (cur !== cents) setText(cents == null ? '' : (cents / 100).toFixed(2));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cents]);
  return (
    <div className="money-input">
      <span>$</span>
      <input
        inputMode="decimal"
        value={text}
        onChange={(e) => {
          const v = e.target.value.replace(/[^0-9.]/g, '');
          setText(v);
          onChange(v === '' ? null : Math.round(Number((parseFloat(v) * 100).toFixed(4))));
        }}
        {...rest}
      />
    </div>
  );
}

/** Generic form state helper. */
export function useForm<T extends Record<string, any>>(initial: T) {
  const [values, setValues] = useState<T>(initial);
  const set = <K extends keyof T>(k: K) => (e: { target: { value: string; type?: string; checked?: boolean } } | T[K]) => {
    const v =
      e && typeof e === 'object' && 'target' in (e as any)
        ? (e as any).target.type === 'checkbox'
          ? (e as any).target.checked
          : (e as any).target.value
        : e;
    setValues((cur) => ({ ...cur, [k]: v }));
  };
  return { values, setValues, set };
}

/* ------------------------------ Formatting ------------------------------ */

export function fmtDate(d: string | null | undefined, withTime = false) {
  if (!d) return '—';
  const date = d.length === 10 ? new Date(`${d}T12:00:00`) : new Date(d);
  return withTime
    ? date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function fmtHours(h: number | null | undefined) {
  if (h == null) return '—';
  return `${(Math.round(h * 100) / 100).toFixed(2)} h`;
}

export function fmtNum(n: number | null | undefined, suffix = '') {
  return n == null ? '—' : `${Math.round(n).toLocaleString('en-US')}${suffix}`;
}

export function unitLabel(u: { year?: number | null; make?: string | null; model?: string | null }) {
  return [u.year, u.make, u.model].filter(Boolean).join(' ');
}

export function useElapsed(since: string | null | undefined) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!since) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [since]);
  if (!since) return '';
  const secs = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} className={value === t.id ? 'tab active' : 'tab'} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="search">
      <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden>
        <circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M14 14l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder ?? 'Search…'} />
    </div>
  );
}

export function useDebounced<T>(value: T, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
