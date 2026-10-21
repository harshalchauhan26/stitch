import { useState } from 'react';
import { Logo } from '../lib/Icon.jsx';
import { useApp } from '../context/AppContext.jsx';

export default function Login() {
  const { dark, login } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);              // show / hide the password while typing

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { await login(email, password); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <div className={`app st${dark ? ' dark' : ''}`} style={{ alignItems: 'center', justifyContent: 'center' }}>
      <form onSubmit={submit} style={{ width: 340, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}><Logo /><span style={{ fontWeight: 600, fontSize: 15 }}>Stitch</span></div>
        <h1 className="ttl">Sign in</h1>
        <input className="inp" type="email" placeholder="Email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        <div style={{ position: 'relative', display: 'flex' }}>
          <input className="inp" type={show ? 'text' : 'password'} placeholder="Password" autoComplete="current-password" value={password}
            onChange={(e) => setPassword(e.target.value)} style={{ flexGrow: 1, paddingRight: 64 }} />
          <button type="button" className="btn gh sm" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}
            style={{ position: 'absolute', right: 2, top: 2, height: 28 }}>{show ? 'Hide' : 'Show'}</button>
        </div>
        {error && <span className="err-t">{error}</span>}
        <button className="btn pri" type="submit" disabled={busy || !email || !password} style={{ justifyContent: 'center' }}>{busy ? 'Signing in…' : 'Sign in'}</button>
        {import.meta.env.DEV && <span className="mut" style={{ fontSize: 11 }}>Demo logins: admin@stitch.test, priya@stitch.test (sales), meera@stitch.test (pod lead). Password stitch123.</span>}
      </form>
    </div>
  );
}
