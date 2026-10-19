import { NavLink } from 'react-router-dom';
import Icon, { Logo } from '../lib/Icon.jsx';
import { useApp } from '../context/AppContext.jsx';
import { ROLE_LABEL } from '../lib/format.js';

export default function Sidebar() {
  const { summary, user, me, logout } = useApp();
  const link = ({ isActive }) => (isActive ? 'on' : '');
  return (
    <aside style={{ width: 224, flexShrink: 0, borderRight: '1px solid var(--ln)', display: 'flex', flexDirection: 'column', gap: 24, padding: '18px 12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '0 10px', height: 28 }}>
        <Logo />
        <span style={{ fontWeight: 600, fontSize: 15, letterSpacing: '-.01em' }}>Stitch</span>
      </div>
      <nav className="nav" aria-label="Main">
        <NavLink to="/" end className={link}><Icon name="home" />Home</NavLink>
        <NavLink to="/leads" className={link}><Icon name="leads" />Leads<span className="m mut" style={{ marginLeft: 'auto', fontSize: 11 }}>{summary.leads}</span></NavLink>
        <NavLink to="/orders" className={link}><Icon name="orders" />Orders<span className="m mut" style={{ marginLeft: 'auto', fontSize: 11 }}>{summary.orders}</span></NavLink>
        <NavLink to="/gaps" className={link}><Icon name="gaps" />Gaps<span className="chip amb m" style={{ marginLeft: 'auto', height: 18 }}>{summary.gaps}</span></NavLink>
        <NavLink to="/dispatches" className={link}><Icon name="truck" />Dispatches</NavLink>
      </nav>
      <div style={{ flexGrow: 1 }} />
      <nav className="nav" aria-label="Admin">
        <NavLink to="/settings" className={link}><Icon name="settings" />Settings</NavLink>
      </nav>
      <div className="hl" style={{ padding: '12px 10px 0', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span className="av" style={{ width: 28, height: 28 }}>{user?.initials ?? '··'}</span>
        <div style={{ lineHeight: 1.25, minWidth: 0 }}>
          <div style={{ fontWeight: 500 }}>{user?.name ?? 'Loading…'}</div>
          <div className="mut" style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user ? [ROLE_LABEL[user.role], ...(me?.teams ?? []).map((t) => t.name)].join(' · ') : ''}
          </div>
          <button type="button" onClick={logout} style={{ all: 'unset', cursor: 'pointer', fontSize: 11, color: 'var(--goldT)' }}>Sign out</button>
        </div>
      </div>
    </aside>
  );
}
