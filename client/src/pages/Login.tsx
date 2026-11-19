import { useState, type FormEvent } from 'react';
import { Logo } from '../App';
import { useAuth } from '../auth';

const DEMO = [
  ['admin@waymore.dev', 'Admin'],
  ['writer@waymore.dev', 'Service writer'],
  ['tech@waymore.dev', 'Technician'],
  ['parts@waymore.dev', 'Parts manager'],
];

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e?: FormEvent, creds?: [string, string]) => {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(creds?.[0] ?? email, creds?.[1] ?? password);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <div className="login-hero">
        <div className="row" style={{ gap: 12, fontWeight: 800, fontSize: 20 }}>
          <Logo size={36} /> Waymore
        </div>
        <div>
          <h1>Run the whole shop, from check-in to paid invoice.</h1>
          <p>
            Work orders, estimates and customer approvals, technician time, inspections, parts and PM schedules for
            heavy-duty and fleet service shops, all in one place.
          </p>
        </div>
        <div className="faint small">© {new Date().getFullYear()} Waymore</div>
        <svg className="road" width="520" height="520" viewBox="0 0 64 64" aria-hidden>
          <path d="M12 18l8 28 12-20 12 20 8-28" fill="none" stroke="#ff7a1a" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <div className="login-form">
        <form onSubmit={submit} className="stack">
          <div>
            <h2>Sign in</h2>
            <div className="muted">Welcome back. Enter your shop credentials.</div>
          </div>
          {error && <div className="error-box">{error}</div>}
          <label className="field">
            <span className="field-label">Email</span>
            <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label className="field">
            <span className="field-label">Password</span>
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          <button className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          <div className="demo-users">
            <div className="muted">Demo accounts (password <code>waymore123</code>):</div>
            {DEMO.map(([em, role]) => (
              <button type="button" key={em} onClick={() => submit(undefined, [em, 'waymore123'])} disabled={busy}>
                <span>{role}</span>
                <span className="muted">{em}</span>
              </button>
            ))}
          </div>
        </form>
      </div>
    </div>
  );
}
