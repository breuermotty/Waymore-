import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ROLE_LABELS, type Role } from '../../shared/constants';
import { useAuth } from './auth';
import { Toaster, useApi, useElapsed } from './ui';
import Authorize from './pages/Authorize';
import CustomerDetail from './pages/CustomerDetail';
import Customers from './pages/Customers';
import Dashboard from './pages/Dashboard';
import Inspection from './pages/Inspection';
import InvoiceDetail from './pages/InvoiceDetail';
import Invoices from './pages/Invoices';
import Login from './pages/Login';
import MyJobs from './pages/MyJobs';
import Parts from './pages/Parts';
import Pm from './pages/Pm';
import PurchaseOrderDetail from './pages/PurchaseOrderDetail';
import PurchaseOrders from './pages/PurchaseOrders';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import UnitDetail from './pages/UnitDetail';
import Units from './pages/Units';
import Vendors from './pages/Vendors';
import WorkOrderDetail from './pages/WorkOrderDetail';
import WorkOrderNew from './pages/WorkOrderNew';
import WorkOrders from './pages/WorkOrders';

export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <rect width="64" height="64" rx="14" fill="#ff7a1a" />
      <path d="M12 18l8 28 12-20 12 20 8-28" fill="none" stroke="#0e1a2b" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const I = {
  dash: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z',
  wo: 'M9 2h6a1 1 0 011 1v1h3a1 1 0 011 1v16a1 1 0 01-1 1H5a1 1 0 01-1-1V5a1 1 0 011-1h3V3a1 1 0 011-1zm0 2v2h6V4H9zm-1 7h8v-2H8v2zm0 4h8v-2H8v2zm0 4h5v-2H8v2z',
  wrench: 'M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z',
  people: 'M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z',
  truck: 'M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2c0 1.66 1.34 3 3 3s3-1.34 3-3h6c0 1.66 1.34 3 3 3s3-1.34 3-3h2v-5l-3-4zM6 18.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm13.5-9l1.96 2.5H17V9.5h2.5zm-1.5 9c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z',
  cal: 'M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-2 .9-2 2v14a2 2 0 002 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11zM7 11h5v5H7z',
  box: 'M21 16.5c0 .38-.21.71-.53.88l-7.9 4.44c-.16.12-.36.18-.57.18-.21 0-.41-.06-.57-.18l-7.9-4.44A.991.991 0 013 16.5v-9c0-.38.21-.71.53-.88l7.9-4.44c.16-.12.36-.18.57-.18.21 0 .41.06.57.18l7.9 4.44c.32.17.53.5.53.88v9zM12 4.15L6.04 7.5 12 10.85l5.96-3.35L12 4.15z',
  store: 'M20 4H4v2h16V4zm1 10v-2l-1-5H4l-1 5v2h1v6h10v-6h4v6h2v-6h1zm-9 4H6v-4h6v4z',
  cart: 'M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zM1 2v2h2l3.6 7.59-1.35 2.45c-.16.28-.25.61-.25.96 0 1.1.9 2 2 2h12v-2H7.42c-.14 0-.25-.11-.25-.25l.03-.12.9-1.63h7.45c.75 0 1.41-.41 1.75-1.03l3.58-6.49A1.003 1.003 0 0020 4H5.21l-.94-2H1z',
  invoice: 'M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 7V3.5L18.5 9H13zM8 13h8v2H8v-2zm0 4h8v2H8v-2z',
  chart: 'M5 9.2h3V19H5V9.2zM10.6 5h2.8v14h-2.8V5zm5.6 8H19v6h-2.8v-6z',
  gear: 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.488.488 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z',
};

const Icon = ({ d }: { d: string }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d={d} />
  </svg>
);

interface NavItem {
  to: string;
  label: string;
  icon: string;
  roles?: Role[];
  end?: boolean;
}
const NAV: { section?: string; items: NavItem[] }[] = [
  {
    items: [
      { to: '/', label: 'Dashboard', icon: I.dash, roles: ['service_writer', 'parts_manager'], end: true },
      { to: '/my-jobs', label: 'My Jobs', icon: I.wrench, roles: ['technician'] },
      { to: '/work-orders', label: 'Work Orders', icon: I.wo },
    ],
  },
  {
    section: 'Fleet',
    items: [
      { to: '/customers', label: 'Customers', icon: I.people, roles: ['service_writer', 'parts_manager'] },
      { to: '/units', label: 'Units', icon: I.truck, roles: ['service_writer', 'parts_manager'] },
      { to: '/pm', label: 'PM Schedule', icon: I.cal, roles: ['service_writer'] },
    ],
  },
  {
    section: 'Parts',
    items: [
      { to: '/parts', label: 'Inventory', icon: I.box, roles: ['service_writer', 'parts_manager'] },
      { to: '/purchase-orders', label: 'Purchase Orders', icon: I.cart, roles: ['parts_manager'] },
      { to: '/vendors', label: 'Vendors', icon: I.store, roles: ['parts_manager'] },
    ],
  },
  {
    section: 'Office',
    items: [
      { to: '/invoices', label: 'Invoices', icon: I.invoice, roles: ['service_writer'] },
      { to: '/reports', label: 'Reports', icon: I.chart, roles: ['service_writer'] },
      { to: '/settings', label: 'Settings', icon: I.gear, roles: [] },
    ],
  },
];

function ClockBanner() {
  const loc = useLocation();
  const { data } = useApi<any>('/time/current', [loc.pathname]);
  const elapsed = useElapsed(data?.startedAt);
  if (!data) return null;
  return (
    <div className="clock-banner no-print">
      <span className="dot" />
      <span>
        Clocked in on <Link to={`/work-orders/${data.workOrderId}`}>{data.workOrderNumber}</Link> — {data.lineTitle}
      </span>
      <span className="timer">{elapsed}</span>
    </div>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const { user, logout, can } = useAuth();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  return (
    <div className={`shell ${open ? 'nav-open' : ''}`}>
      <aside className="sidebar">
        <Link to="/" className="brand" style={{ textDecoration: 'none' }}>
          <Logo />
          <div>
            Waymore
            <small>Shop Manager</small>
          </div>
        </Link>
        <nav className="nav">
          {NAV.map((group, gi) => {
            const items = group.items.filter((it) => !it.roles || can(...it.roles));
            if (!items.length) return null;
            return (
              <div key={gi}>
                {group.section && <div className="nav-section">{group.section}</div>}
                {items.map((it) => (
                  <NavLink key={it.to} to={it.to} end={it.end}>
                    <Icon d={it.icon} />
                    {it.label}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          <div className="who">{user!.name}</div>
          <div className="faint">{ROLE_LABELS[user!.role]}</div>
          <button className="btn btn-ghost btn-sm" onClick={logout}>
            Sign out
          </button>
        </div>
      </aside>
      <div className="main">
        <div className="topbar no-print">
          <button onClick={() => setOpen((o) => !o)} aria-label="Menu">
            ☰
          </button>
          <Logo size={24} /> Waymore
        </div>
        {can('technician') && <ClockBanner />}
        <main className="content">{children}</main>
      </div>
      {open && <div className="modal-backdrop" style={{ zIndex: 35 }} onClick={() => setOpen(false)} />}
    </div>
  );
}

function Home() {
  const { user } = useAuth();
  return user!.role === 'technician' ? <Navigate to="/my-jobs" replace /> : <Dashboard />;
}

export default function App() {
  const { user, ready } = useAuth();
  const loc = useLocation();

  if (loc.pathname.startsWith('/authorize/')) {
    return (
      <>
        <Routes>
          <Route path="/authorize/:token" element={<Authorize />} />
        </Routes>
        <Toaster />
      </>
    );
  }
  if (!ready) return null;
  if (!user)
    return (
      <>
        <Login />
        <Toaster />
      </>
    );

  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/my-jobs" element={<MyJobs />} />
        <Route path="/work-orders" element={<WorkOrders />} />
        <Route path="/work-orders/new" element={<WorkOrderNew />} />
        <Route path="/work-orders/:id" element={<WorkOrderDetail />} />
        <Route path="/inspections/:id" element={<Inspection />} />
        <Route path="/customers" element={<Customers />} />
        <Route path="/customers/:id" element={<CustomerDetail />} />
        <Route path="/units" element={<Units />} />
        <Route path="/units/:id" element={<UnitDetail />} />
        <Route path="/pm" element={<Pm />} />
        <Route path="/parts" element={<Parts />} />
        <Route path="/vendors" element={<Vendors />} />
        <Route path="/purchase-orders" element={<PurchaseOrders />} />
        <Route path="/purchase-orders/:id" element={<PurchaseOrderDetail />} />
        <Route path="/invoices" element={<Invoices />} />
        <Route path="/invoices/:id" element={<InvoiceDetail />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<div className="empty">Page not found. <Link to="/">Go home</Link></div>} />
      </Routes>
      <Toaster />
    </Shell>
  );
}
