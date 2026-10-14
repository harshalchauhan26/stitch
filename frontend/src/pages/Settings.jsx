import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, Navigate, useParams } from 'react-router-dom';
import Toast from '../components/Toast.jsx';
import { api } from '../api/index.js';
import { useApp } from '../context/AppContext.jsx';

const LEVELS = [['optional', 'Optional'], ['needed', 'Needed'], ['blocking', 'Blocking']];
const ROLES = [['admin', 'Admin'], ['pod_lead', 'Pod lead'], ['sales', 'Sales associate'], ['ops', 'Ops'], ['qc', 'QC']];

function useToast() {
  const [msg, setMsg] = useState(null); const t = useRef();
  const say = useCallback((m) => { clearTimeout(t.current); setMsg(m); t.current = setTimeout(() => setMsg(null), 3600); }, []);
  useEffect(() => () => clearTimeout(t.current), []);
  return [msg, say];
}
const Seg = ({ value, options, onChange, disabled }) => (
  <div className="seg" role="group">{options.map(([k, l]) => <button key={k} type="button" disabled={disabled} className={value === k ? 'on' : ''} onClick={() => onChange(k)}>{l}</button>)}</div>
);

// ---------------------------------------------------------------------------------------------
function RequiredTab({ canEdit, say }) {
  const { user } = useApp();
  const brands = user?.brands ?? [];
  const [meta, setMeta] = useState(null);
  const [brand, setBrand] = useState('');
  const [record, setRecord] = useState('lead');
  const [rules, setRules] = useState([]);
  const [adding, setAdding] = useState({});             // stage -> field to add
  useEffect(() => { api.meta().then(setMeta).catch((e) => say(e.message)); }, [say]);
  useEffect(() => { if (!brand && brands.length) setBrand(brands[0].code); }, [brands, brand]);
  const load = useCallback(() => (brand ? api.rules({ brand, record }).then(setRules).catch((e) => say(e.message)) : Promise.resolve()), [brand, record, say]);
  useEffect(() => { load(); }, [load]);

  if (!brands.length) return <p className="mut">No brands yet. Add one in the Brands tab first.</p>;
  const stages = (record === 'lead' ? meta?.leadStages : meta?.orderStages) ?? [];
  const fieldLabel = (f) => meta?.fields?.[f]?.label ?? f;
  const save = async (stage, field, level) => {
    try { await api.saveRule({ brand, record, stage, field, level }); await load(); say(`${fieldLabel(field)} is now ${level} at ${stage}`); } catch (e) { say(e.message); }
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 820 }}>
      <p style={{ margin: 0, color: 'var(--ink2)' }}>Choose what each brand must fill in at every stage. <b>Needed</b> fields show up as gaps. <b>Blocking</b> fields also stop the record moving on until they are filled.{!canEdit && ' You can view these, but only admins and pod leads can change them.'}</p>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <select className="inp" aria-label="Brand" value={brand} onChange={(e) => setBrand(e.target.value)}>{brands.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}</select>
        <Seg value={record} options={[['lead', 'Lead stages'], ['order', 'Order stages']]} onChange={setRecord} />
      </div>
      {stages.map((stage) => {
        const here = rules.filter((r) => r.stage === stage);
        const free = Object.entries(meta?.fields ?? {}).filter(([k, f]) => !f.system && f.records?.includes(record) && !here.some((r) => r.field === k)).map(([k]) => k);
        return (
          <section key={stage} className="tbl" aria-label={stage}>
            <div className="r h" style={{ gridTemplateColumns: '1fr 280px' }}><span>{stage}</span><span>Level</span></div>
            {here.map((r) => (
              <div key={r.field} className="r" style={{ gridTemplateColumns: '1fr 280px' }}>
                <span>{fieldLabel(r.field)} {meta?.gateFields?.includes(r.field) && <span className="chip amb" title="Gate field: only an admin can lower it">gate</span>}</span>
                <Seg value={r.level} options={LEVELS} disabled={!canEdit} onChange={(lv) => save(stage, r.field, lv)} />
              </div>
            ))}
            {here.length === 0 && <div className="r mut" style={{ gridTemplateColumns: '1fr' }}>Nothing required at this stage.</div>}
            {canEdit && (
              <div className="r" style={{ gridTemplateColumns: '1fr auto', background: 'var(--sf2)' }}>
                <select className="inp" aria-label={`Add field to ${stage}`} value={adding[stage] ?? ''} onChange={(e) => setAdding((a) => ({ ...a, [stage]: e.target.value }))} style={{ height: 28, fontSize: 12 }}>
                  <option value="">Add a field…</option>{free.map((f) => <option key={f} value={f}>{fieldLabel(f)}</option>)}
                </select>
                <button type="button" className="btn sm" disabled={!adding[stage]} onClick={async () => { await save(stage, adding[stage], 'needed'); setAdding((a) => ({ ...a, [stage]: '' })); }}>Add as needed</button>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
function BrandsTab({ say }) {
  const { reloadMe } = useApp();
  const [list, setList] = useState([]);
  const [form, setForm] = useState({ code: '', name: '' });
  const load = useCallback(() => api.adminBrands().then(setList).catch((e) => say(e.message)), [say]);
  useEffect(() => { load(); }, [load]);
  const after = async (m) => { say(m); await load(); reloadMe(); };
  const add = async () => { try { await api.addBrand({ code: form.code.trim().toUpperCase(), name: form.name.trim() }); setForm({ code: '', name: '' }); await after('Brand added with the default required fields'); } catch (e) { say(e.message); } };
  const edit = async (code, body, m) => { try { await api.editBrand(code, body); await after(m); } catch (e) { say(e.message); } };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 720 }}>
      <p style={{ margin: 0, color: 'var(--ink2)' }}>Each brand has its own required fields. When a chat's greeting names a brand here (for example "Team Ridhi Mehra"), Stitch picks that brand automatically.</p>
      <div className="tbl">
        <div className="r h" style={{ gridTemplateColumns: '70px 1fr 160px' }}><span>Code</span><span>Name</span><span>Status</span></div>
        {list.map((b) => (
          <div key={b.code} className="r" style={{ gridTemplateColumns: '70px 1fr 160px' }}>
            <span className="bd" style={{ justifySelf: 'start' }}>{b.code}</span>
            <input className="inp" defaultValue={b.name} key={b.name} aria-label={`${b.code} name`} onBlur={(e) => e.target.value.trim() !== b.name && edit(b.code, { name: e.target.value }, 'Brand renamed')} />
            <Seg value={b.active ? 'on' : 'off'} options={[['on', 'Active'], ['off', 'Hidden']]} onChange={(v) => edit(b.code, { active: v === 'on' }, v === 'on' ? 'Brand is active' : 'Brand hidden')} />
          </div>
        ))}
        {list.length === 0 && <div className="r mut" style={{ gridTemplateColumns: '1fr' }}>No brands yet. Add your first one below.</div>}
        <div className="r" style={{ gridTemplateColumns: '70px 1fr auto', background: 'var(--sf2)' }}>
          <input className="inp" placeholder="RM" aria-label="New brand code" maxLength={4} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} style={{ height: 28 }} />
          <input className="inp" placeholder="Brand name, e.g. Ridhi Mehra" aria-label="New brand name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ height: 28 }} />
          <button type="button" className="btn pri sm" disabled={!/^[A-Z]{2,4}$/.test(form.code) || !form.name.trim()} onClick={add}>Add brand</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
function TeamsTab({ say }) {
  const { reloadMe } = useApp();
  const [teams, setTeams] = useState([]); const [brands, setBrands] = useState([]);
  const [form, setForm] = useState({ name: '', brands: [] });
  const load = useCallback(() => Promise.all([api.adminTeams(), api.adminBrands()]).then(([t, b]) => { setTeams(t); setBrands(b); }).catch((e) => say(e.message)), [say]);
  useEffect(() => { load(); }, [load]);
  const toggle = (arr, c) => (arr.includes(c) ? arr.filter((x) => x !== c) : [...arr, c]);
  const save = async (t, patch, m) => { try { await api.editTeam(t.id, patch); say(m); await load(); reloadMe(); } catch (e) { say(e.message); } };
  const add = async () => { try { await api.addTeam(form); setForm({ name: '', brands: [] }); say('Team added'); await load(); } catch (e) { say(e.message); } };
  const picks = (value, onToggle) => <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>{brands.map((b) => (
    <label key={b.code} style={{ display: 'flex', gap: 5, alignItems: 'center', fontSize: 12 }}><input type="checkbox" checked={value.includes(b.code)} onChange={() => onToggle(b.code)} />{b.name}</label>))}{brands.length === 0 && <span className="mut" style={{ fontSize: 12 }}>Add brands first.</span>}</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 820 }}>
      <p style={{ margin: 0, color: 'var(--ink2)' }}>A team only sees the brands you tick here. Admins always see every brand.</p>
      <div className="tbl">
        <div className="r h" style={{ gridTemplateColumns: '200px 1fr 80px' }}><span>Team</span><span>Can see</span><span>People</span></div>
        {teams.map((t) => (
          <div key={t.id} className="r" style={{ gridTemplateColumns: '200px 1fr 80px' }}>
            <input className="inp" defaultValue={t.name} key={t.name} aria-label={`Team ${t.name}`} onBlur={(e) => e.target.value.trim() !== t.name && save(t, { name: e.target.value }, 'Team renamed')} />
            {picks(t.brands, (c) => save(t, { brands: toggle(t.brands, c) }, 'Team brands updated'))}
            <span className="m">{t.members}</span>
          </div>
        ))}
        {teams.length === 0 && <div className="r mut" style={{ gridTemplateColumns: '1fr' }}>No teams yet.</div>}
        <div className="r" style={{ gridTemplateColumns: '200px 1fr auto', background: 'var(--sf2)' }}>
          <input className="inp" placeholder="New team name" aria-label="New team name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ height: 28 }} />
          {picks(form.brands, (c) => setForm({ ...form, brands: toggle(form.brands, c) }))}
          <button type="button" className="btn pri sm" disabled={!form.name.trim()} onClick={add}>Add team</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
function UsersTab({ say }) {
  const [users, setUsers] = useState([]); const [teams, setTeams] = useState([]);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'sales', teamId: '' });
  const [pw, setPw] = useState({});
  const load = useCallback(() => Promise.all([api.adminUsers(), api.adminTeams()]).then(([u, t]) => { setUsers(u); setTeams(t); }).catch((e) => say(e.message)), [say]);
  useEffect(() => { load(); }, [load]);
  const edit = async (u, body, m) => { try { await api.editUser(u.id, body); say(m); await load(); } catch (e) { say(e.message); } };
  const add = async () => { try { await api.addUser({ ...form, teamId: form.teamId ? Number(form.teamId) : null }); setForm({ name: '', email: '', password: '', role: 'sales', teamId: '' }); say('Person added'); await load(); } catch (e) { say(e.message); } };
  const teamSel = (value, onChange, label) => <select className="inp" aria-label={label} value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} style={{ height: 28, fontSize: 12 }}><option value="">No team</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>;
  const G = '1.1fr 1.3fr 150px 140px 110px 200px';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ margin: 0, color: 'var(--ink2)' }}>Everyone who can sign in. Deactivating someone signs them out straight away.</p>
      <div className="tbl">
        <div className="r h" style={{ gridTemplateColumns: G }}><span>Name</span><span>Email</span><span>Role</span><span>Team</span><span>Status</span><span>Password</span></div>
        {users.map((u) => (
          <div key={u.id} className="r" style={{ gridTemplateColumns: G }}>
            <span style={{ fontWeight: 500 }}>{u.name}</span><span className="m" style={{ fontSize: 12 }}>{u.email}</span>
            <select className="inp" aria-label={`${u.name} role`} value={u.role} onChange={(e) => edit(u, { role: e.target.value }, 'Role updated')} style={{ height: 28, fontSize: 12 }}>{ROLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            {teamSel(u.teamId, (v) => edit(u, { teamId: v }, 'Team updated'), `${u.name} team`)}
            <Seg value={u.active ? 'on' : 'off'} options={[['on', 'Active'], ['off', 'Off']]} onChange={(v) => edit(u, { active: v === 'on' }, v === 'on' ? 'Person activated' : 'Person deactivated')} />
            <div style={{ display: 'flex', gap: 4 }}>
              <input className="inp" type="password" placeholder="New password" aria-label={`${u.name} new password`} value={pw[u.id] || ''} onChange={(e) => setPw({ ...pw, [u.id]: e.target.value })} style={{ height: 28, fontSize: 12, width: 120 }} />
              <button type="button" className="btn sm" disabled={(pw[u.id] || '').length < 8} onClick={async () => { await edit(u, { password: pw[u.id] }, 'Password changed'); setPw({ ...pw, [u.id]: '' }); }}>Set</button>
            </div>
          </div>
        ))}
        <div className="r" style={{ gridTemplateColumns: G, background: 'var(--sf2)' }}>
          <input className="inp" placeholder="Full name" aria-label="New person name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ height: 28 }} />
          <input className="inp" placeholder="email@company.com" aria-label="New person email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} style={{ height: 28 }} />
          <select className="inp" aria-label="New person role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} style={{ height: 28, fontSize: 12 }}>{ROLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          {teamSel(form.teamId === '' ? null : Number(form.teamId), (v) => setForm({ ...form, teamId: v ?? '' }), 'New person team')}
          <input className="inp" type="password" placeholder="Password (8+)" aria-label="New person password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} style={{ height: 28 }} />
          <button type="button" className="btn pri sm" disabled={!form.name.trim() || !form.email.includes('@') || form.password.length < 8} onClick={add}>Add person</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
export default function Settings() {
  const { tab } = useParams();
  const { user } = useApp();
  const [toast, say] = useToast();
  if (!user) return null;
  const admin = user.role === 'admin', canRules = admin || user.role === 'pod_lead';
  const tabs = [['required', 'Required fields'], ...(admin ? [['brands', 'Brands'], ['teams', 'Teams'], ['people', 'People']] : [])];
  if (!tabs.some(([k]) => k === tab)) return <Navigate to="/settings/required" replace />;
  return (
    <main style={{ flexGrow: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '24px 28px 14px' }}><h1 className="ttl">Settings</h1></div>
      <nav className="tabs" aria-label="Settings">{tabs.map(([k, l]) => <NavLink key={k} to={`/settings/${k}`} className={({ isActive }) => (isActive ? 'on' : '')}>{l}</NavLink>)}</nav>
      <div style={{ padding: '20px 28px 40px' }}>
        {tab === 'required' && <RequiredTab canEdit={canRules} say={say} />}
        {tab === 'brands' && <BrandsTab say={say} />}
        {tab === 'teams' && <TeamsTab say={say} />}
        {tab === 'people' && <UsersTab say={say} />}
      </div>
      <Toast message={toast} />
    </main>
  );
}
