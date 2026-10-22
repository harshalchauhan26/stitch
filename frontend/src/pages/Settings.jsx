import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, Navigate, useParams } from 'react-router-dom';
import Icon from '../lib/Icon.jsx';
import { LevelChip } from '../components/FieldControl.jsx';
import { api } from '../api/index.js';
import { useApp } from '../context/AppContext.jsx';
import { phone, ROLE_LABEL } from '../lib/format.js';

const TYPES = [['text', 'Text'], ['longtext', 'Long text'], ['number', 'Number'], ['currency', 'Amount (₹)'], ['date', 'Date'], ['select', 'Dropdown'], ['bool', 'Yes / No'], ['url', 'Link']];
const DEFAULT_PIPELINE = [['New', 'open'], ['Qualifying', 'open'], ['Customising', 'open'], ['Quoted', 'open'], ['Awaiting payment', 'open'], ['Won', 'won'], ['Lost', 'lost']];
const box = { padding: 16, display: 'flex', flexDirection: 'column', gap: 12 };

// ------------------------------------------------------------------ pipeline editor
function PipelineEditor({ stages, onChange }) {
  const open = stages.filter((s) => s.type === 'open');
  const set = (i, patch) => onChange(stages.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const moveOpen = (i, dir) => {
    const j = i + dir;
    if (j < 0 || stages[j]?.type !== 'open') return;
    const next = [...stages]; [next[i], next[j]] = [next[j], next[i]]; onChange(next);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {stages.map((s, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span className="m mut" style={{ width: 18, fontSize: 11 }}>{s.type === 'open' ? open.indexOf(s) + 1 : ''}</span>
          <input className="inp" value={s.name} onChange={(e) => set(i, { name: e.target.value })} style={{ width: 220 }} aria-label="Stage name" />
          <span className={`chip ${s.type === 'won' ? 'grn' : s.type === 'lost' ? '' : 'blu'}`}>{s.type === 'won' ? 'won · creates the order' : s.type === 'lost' ? 'lost · closes the lead' : 'open'}</span>
          {s.type === 'open' && <>
            <button type="button" className="tw" aria-label="Up" onClick={() => moveOpen(i, -1)}><Icon name="up" small /></button>
            <button type="button" className="tw" aria-label="Down" onClick={() => moveOpen(i, 1)}><Icon name="down" small /></button>
            {open.length > 1 && <button type="button" className="tw" aria-label="Remove" onClick={() => onChange(stages.filter((_, j) => j !== i))}><Icon name="x" small /></button>}
          </>}
        </div>
      ))}
      <button type="button" className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => { const at = stages.findIndex((s) => s.type !== 'open'); const next = [...stages]; next.splice(at, 0, { name: '', type: 'open' }); onChange(next); }}><Icon name="plus" small />Add custom stage</button>
    </div>
  );
}

// ------------------------------------------------------------------ one brand's setup: pipeline + fields
function BrandSetup({ brand, onSaved }) {
  const { say, user, reloadMe } = useApp();
  const [data, setData] = useState(null);
  const [stages, setStages] = useState(null);
  const [nf, setNf] = useState(null);
  const [add, setAdd] = useState({ key: '', stage: '', level: 'optional' });
  const [addOrder, setAddOrder] = useState({ key: '', stage: '', level: 'optional' });
  const admin = user?.role === 'admin';
  const load = useCallback(() => api.brandFields(brand.id).then((d) => { setData(d); setStages(d.pipeline.map((s) => ({ ...s, orig: s.name }))); }).catch((e) => say(e.message)), [brand.id, say]);
  useEffect(() => { load(); }, [load]);
  if (!data) return <div className="mut">Loading…</div>;
  const open = data.pipeline.filter((s) => s.type === 'open').map((s) => s.name);
  const dirty = JSON.stringify(stages.map(({ name, type }) => ({ name, type }))) !== JSON.stringify(data.pipeline);

  const savePipeline = async () => {
    try {
      await api.savePipeline(brand.id, stages.map((s) => ({ name: s.name.trim(), type: s.type, ...(s.type === 'open' && s.orig && s.orig !== s.name.trim() ? { from: s.orig } : {}) })));
      say('Pipeline saved'); await load(); await reloadMe(); onSaved?.();
    } catch (e) { say(e.message); }
  };
  const update = async (key, body, msg, recordType = 'lead', current = null) => {
    try {
      const d = recordType === 'lead'
        ? await api.updateBrandField(brand.id, key, body)
        : await api.updateBrandRule(brand.id, { record_type: recordType, stage: body.stage ?? current.stage, field: key, level: body.level === undefined ? current.level : body.level });
      if (recordType === 'lead') setData(d);
      else setData(await api.brandFields(brand.id));
      say(msg);
    } catch (e) { say(e.message); }
  };
  const createField = async () => {
    try {
      const d = await api.addBrandField(brand.id, { ...nf, options: nf.type === 'select' ? nf.options.split(',').map((x) => x.trim()).filter(Boolean) : undefined });
      setData(d); setNf(null); say(`${nf.label} added to ${brand.name}`);
    } catch (e) { say(e.message); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <section className="tbl" style={box}>
        <div className="lbl">{brand.name} · custom stages & pipeline</div>
        <span className="mut" style={{ fontSize: 12 }}>Rename, reorder, remove, or add custom lead stages below. Won creates the order and Lost closes the lead. A stage with leads in it cannot be removed.</span>
        <PipelineEditor stages={stages} onChange={setStages} />
        {dirty && <div style={{ display: 'flex', gap: 8 }}><button type="button" className="btn pri" onClick={savePipeline}>Save pipeline</button><button type="button" className="btn gh" onClick={load}>Undo changes</button></div>}
      </section>

      <section className="tbl" style={box}>
        <div className="lbl">{brand.name} · fields & requirements by stage</div>
        <span className="mut" style={{ fontSize: 12 }}>Use the <b>Requirement</b> selector on each field to switch between Optional, Required (needed), and Required + gate (blocking). Use <b>Hide field</b> to remove it from this brand; hidden standard fields can be restored below.</span>
        {data.pipeline.filter((s) => s.type === 'open').map((s) => {
          const here = data.fields.filter((f) => f.stage === s.name && f.level);
          return (
            <div key={s.name} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ fontWeight: 600, fontSize: 12, marginTop: 6 }}>{s.name}</div>
              {here.map((f) => (
                <div key={f.key} style={{ display: 'grid', gridTemplateColumns: '1fr 110px 150px 170px 30px', gap: 8, alignItems: 'center', fontSize: 12, padding: '4px 0', borderTop: '1px solid var(--ln2)' }}>
                  <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    {f.label}{f.custom && <span className="chip blu" style={{ fontSize: 10, height: 18 }}>brand</span>}{f.level === 'blocking' && <span className="chip red" style={{ fontSize: 10, height: 18 }} title={f.locked ? 'Only an admin can lower this default gate' : 'This field gates the next stage'}>gate</span>}
                    {f.computed && <span className="chip" style={{ fontSize: 10, height: 18 }}>filled by Stitch</span>}
                  </span>
                  <span className="mut">{f.scope === 'item' ? 'each product' : f.scope === 'client' ? 'customer' : 'lead'} · {TYPES.find((t) => t[0] === f.type)?.[1] ?? f.type}</span>
                  <select className="inp" value={f.stage} onChange={(e) => update(f.key, { stage: e.target.value }, `${f.label} moved to ${e.target.value}`)} style={{ height: 28, fontSize: 12 }}>{open.map((x) => <option key={x}>{x}</option>)}</select>
                  <select className="inp" aria-label={`${f.label} requirement`} value={f.level} disabled={f.locked && !admin} onChange={(e) => update(f.key, { level: e.target.value }, `${f.label} is now ${e.target.value}`)} style={{ height: 28, fontSize: 12 }}>
                    <option value="optional">Optional</option><option value="needed">Required (needed)</option><option value="blocking">Required + gate</option>
                  </select>
                  {!f.locked || admin ? <button type="button" className="btn gh sm" title="Hide this field for this brand" onClick={() => update(f.key, { level: null }, `${f.label} hidden for ${brand.name}`)}>Hide field</button> : <span />}
                </div>
              ))}
              {here.length === 0 && <span className="mut" style={{ fontSize: 12 }}>Nothing asked at this stage.</span>}
            </div>
          );
        })}
        <div className="lbl" style={{ marginTop: 14, borderTop: '1px solid var(--ln)', paddingTop: 14 }}>{brand.name} · order fields by stage</div>
        {data.order_stages.map((stage) => {
          const here = data.order.fields.filter((f) => f.stage === stage && f.level);
          return (
            <div key={stage} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ fontWeight: 600, fontSize: 12, marginTop: 6 }}>{stage}</div>
              {here.map((f) => (
                <div key={f.key} style={{ display: 'grid', gridTemplateColumns: '1fr 110px 150px 170px 30px', gap: 8, alignItems: 'center', fontSize: 12, padding: '4px 0', borderTop: '1px solid var(--ln2)' }}>
                  <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    {f.label}{f.level === 'blocking' && <span className="chip red" style={{ fontSize: 10, height: 18 }} title={f.locked ? 'Only an admin can lower this default gate' : 'This field gates the next stage'}>gate</span>}
                    {f.computed && <span className="chip" style={{ fontSize: 10, height: 18 }}>filled by Stitch</span>}
                  </span>
                  <span className="mut">{f.scope === 'item' ? 'each product' : f.scope === 'client' ? 'customer' : 'order'} · {TYPES.find((t) => t[0] === f.type)?.[1] ?? f.type}</span>
                  <select className="inp" value={f.stage} onChange={(e) => update(f.key, { stage: e.target.value }, `${f.label} moved to ${e.target.value}`, 'order', f)} style={{ height: 28, fontSize: 12 }}>{data.order_stages.map((x) => <option key={x}>{x}</option>)}</select>
                  <select className="inp" aria-label={`${f.label} requirement`} value={f.level} disabled={f.locked && !admin} onChange={(e) => update(f.key, { level: e.target.value }, `${f.label} is now ${e.target.value}`, 'order', f)} style={{ height: 28, fontSize: 12 }}>
                    <option value="optional">Optional</option><option value="needed">Required (needed)</option><option value="blocking">Required + gate</option>
                  </select>
                  {!f.locked || admin ? <button type="button" className="btn gh sm" title="Hide this field for this brand" onClick={() => update(f.key, { level: null }, `${f.label} hidden for ${brand.name}`, 'order', f)}>Hide field</button> : <span />}
                </div>
              ))}
              {here.length === 0 && <span className="mut" style={{ fontSize: 12 }}>Nothing asked at this stage.</span>}
            </div>
          );
        })}
        {data.order.available.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
            <span className="mut" style={{ fontSize: 12 }}>Restore a standard order field:</span>
            <select className="inp" value={addOrder.key} onChange={(e) => setAddOrder({ ...addOrder, key: e.target.value })} style={{ height: 28, fontSize: 12 }}>
              <option value="">Choose…</option>{data.order.available.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
            <select className="inp" value={addOrder.stage || data.order_stages[0]} onChange={(e) => setAddOrder({ ...addOrder, stage: e.target.value })} style={{ height: 28, fontSize: 12 }}>
              {data.order_stages.map((x) => <option key={x}>{x}</option>)}
            </select>
            <button type="button" className="btn sm" disabled={!addOrder.key} onClick={() => {
              update(addOrder.key, { stage: addOrder.stage || data.order_stages[0], level: 'optional' }, 'Order field restored', 'order', { stage: addOrder.stage || data.order_stages[0], level: 'optional' });
              setAddOrder({ key: '', stage: '', level: 'optional' });
            }}>Restore</button>
          </div>
        )}
        {nf ? (
          <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: 8, alignItems: 'center', padding: 12, border: '1px solid var(--gold)', borderRadius: 8 }}>
            <span className="lbl" style={{ gridColumn: '1 / -1' }}>New field for {brand.name}</span>
            <span className="mut">Label</span><input className="inp" value={nf.label} onChange={(e) => setNf({ ...nf, label: e.target.value })} placeholder="e.g. Resizing allowed" autoFocus />
            <span className="mut">Type</span><select className="inp" value={nf.type} onChange={(e) => setNf({ ...nf, type: e.target.value })}>{TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            {nf.type === 'select' && <><span className="mut">Options</span><input className="inp" value={nf.options} onChange={(e) => setNf({ ...nf, options: e.target.value })} placeholder="Comma separated, e.g. No, Once, Twice" /></>}
            <span className="mut">Asked for</span><select className="inp" value={nf.scope} onChange={(e) => setNf({ ...nf, scope: e.target.value })}><option value="lead">The lead (once)</option><option value="item">Each product</option></select>
            <span className="mut">At stage</span><select className="inp" value={nf.stage} onChange={(e) => setNf({ ...nf, stage: e.target.value })}>{open.map((x) => <option key={x}>{x}</option>)}</select>
            <span className="mut">Level</span><select className="inp" value={nf.level} onChange={(e) => setNf({ ...nf, level: e.target.value })}><option value="optional">Optional</option><option value="needed">Needed (shows as a gap)</option><option value="blocking">Blocking (gate)</option></select>
            <span />
            <div style={{ display: 'flex', gap: 8 }}><button type="button" className="btn pri" disabled={!nf.label.trim() || (nf.type === 'select' && !nf.options.trim())} onClick={createField}>Add field</button><button type="button" className="btn gh" onClick={() => setNf(null)}>Cancel</button></div>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button type="button" className="btn pri" onClick={() => setNf({ label: '', type: 'text', options: '', scope: 'lead', stage: open[0], level: 'optional' })}><Icon name="plus" />New field for {brand.name}</button>
            {data.available.length > 0 && <>
              <span className="mut" style={{ fontSize: 12 }}>or use a standard field:</span>
              <select className="inp" value={add.key} onChange={(e) => setAdd({ ...add, key: e.target.value })} style={{ height: 28, fontSize: 12 }}><option value="">Choose…</option>{data.available.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</select>
              <select className="inp" value={add.stage || open[0]} onChange={(e) => setAdd({ ...add, stage: e.target.value })} style={{ height: 28, fontSize: 12 }}>{open.map((x) => <option key={x}>{x}</option>)}</select>
              <button type="button" className="btn sm" disabled={!add.key} onClick={() => { update(add.key, { stage: add.stage || open[0], level: 'optional' }, 'Field added'); setAdd({ key: '', stage: '', level: 'optional' }); }}>Add</button>
            </>}
          </div>
        )}
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ brands: onboarding + list
function BrandsTab() {
  const { say, reloadMe, user } = useApp();
  const [brands, setBrands] = useState(null);
  const [teams, setTeams] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [sel, setSel] = useState(null);
  const [form, setForm] = useState(null);
  const [check, setCheck] = useState(null);
  const timer = useRef();
  const admin = user?.role === 'admin';
  const load = useCallback(() => Promise.all([api.brands().then(setBrands), api.teams().then(setTeams), api.templates().then(setTemplates)]).catch((e) => say(e.message)), [say]);
  useEffect(() => { load(); }, [load]);

  // live duplicate check while typing (name, code, Instagram, website, WhatsApp numbers)
  useEffect(() => {
    clearTimeout(timer.current);
    if (!form || (!form.name && !form.code && !form.instagram && !form.website && !form.phones)) { setCheck(null); return undefined; }
    timer.current = setTimeout(() => {
      const phones = form.phones.split(',').map((x) => x.trim()).filter((x) => x.replace(/\D/g, '').length >= 8);
      api.checkBrand({ name: form.name, code: form.code, instagram: form.instagram, website: form.website, ...(phones.length ? { phone: phones[0] } : {}) }).then(setCheck).catch(() => setCheck(null));
    }, 300);
    return () => clearTimeout(timer.current);
  }, [form]);

  const onboard = async () => {
    try {
      const b = await api.createBrand({
        name: form.name, code: form.code, template_key: form.template, instagram: form.instagram || undefined, website: form.website || undefined,
        whatsapp_numbers: form.phones.split(',').map((x) => x.trim()).filter(Boolean), team_ids: form.teams, confirm_similar: form.confirmSimilar || undefined,
        lead_pipeline: form.custom ? form.stages.map(({ name, type }) => ({ name: name.trim(), type })) : undefined,
      });
      say(`${b.name} onboarded`); setForm(null); setCheck(null); await load(); await reloadMe(); setSel(b.id);
    } catch (e) { say(e.message); if (e.code === 'similar_brand') setForm((f) => ({ ...f, similar: e.similar })); }
  };

  if (!brands) return <div className="mut">Loading…</div>;
  const selected = brands.find((b) => b.id === sel);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 24, alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {brands.map((b) => (
          <button key={b.id} type="button" className="qa" onClick={() => { setSel(b.id); setForm(null); }} style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 6, cursor: 'pointer', borderColor: sel === b.id ? 'var(--gold)' : undefined, font: 'inherit', textAlign: 'left' }}>
            <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><span className="bd">{b.code}</span><b style={{ fontWeight: 600 }}>{b.name}</b>{b.status === 'archived' && <span className="chip">archived</span>}</span>
            <span className="mut" style={{ fontSize: 11 }}>{b.lead_pipeline.filter((s) => s.type !== 'lost').map((s) => s.name).join(' → ')}</span>
            <span className="mut" style={{ fontSize: 11 }}>{[b.teams?.map((t) => t.name).join(', '), b.whatsapp_accounts?.map((a) => phone(a.phone)).join(', ')].filter(Boolean).join(' · ')}</span>
          </button>
        ))}
        {admin && <button type="button" className="btn pri" onClick={() => { setSel(null); setForm({ name: '', code: '', template: templates[0]?.key ?? 'womenswear', instagram: '', website: '', phones: '', teams: [], custom: false, stages: DEFAULT_PIPELINE.map(([name, type]) => ({ name, type })) }); }}><Icon name="plus" />Onboard a brand</button>}
      </div>
      <div>
        {form && (
          <section className="tbl" style={box}>
            <div className="lbl">Onboard a brand</div>
            <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: '8px 12px', alignItems: 'center' }}>
              <span className="mut">Name</span><input className="inp" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
              <span className="mut">Short code</span><input className="inp" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="e.g. NA" style={{ width: 100 }} />
              <span className="mut">Template</span><select className="inp" value={form.template} onChange={(e) => setForm({ ...form, template: e.target.value })}>{templates.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}</select>
              <span className="mut">Instagram</span><input className="inp" value={form.instagram} onChange={(e) => setForm({ ...form, instagram: e.target.value })} placeholder="@handle" />
              <span className="mut">Website</span><input className="inp" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
              <span className="mut">WhatsApp numbers</span><input className="inp" value={form.phones} onChange={(e) => setForm({ ...form, phones: e.target.value })} placeholder="+91 98111 00004, comma separated" />
              <span className="mut">Handled by</span>
              <span style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>{teams.map((t) => <label key={t.id} style={{ display: 'flex', gap: 4, alignItems: 'center' }}><input type="checkbox" checked={form.teams.includes(t.id)} onChange={(e) => setForm({ ...form, teams: e.target.checked ? [...form.teams, t.id] : form.teams.filter((x) => x !== t.id) })} />{t.name}</label>)}</span>
              <span className="mut">Lead pipeline</span>
              <div className="seg" style={{ justifySelf: 'start' }}><button type="button" className={!form.custom ? 'on' : ''} onClick={() => setForm({ ...form, custom: false })}>Standard stages</button><button type="button" className={form.custom ? 'on' : ''} onClick={() => setForm({ ...form, custom: true })}>Custom</button></div>
            </div>
            {form.custom && <PipelineEditor stages={form.stages} onChange={(stages) => setForm({ ...form, stages })} />}
            {check?.conflicts?.map((c, i) => <span key={i} className="chip red" style={{ height: 'auto', padding: 8, whiteSpace: 'normal' }}>{c.message}</span>)}
            {(check?.similar?.length > 0 || form.similar) && !check?.conflicts?.length && (
              <label className="chip amb" style={{ height: 'auto', padding: 8, whiteSpace: 'normal', gap: 8 }}>
                <input type="checkbox" checked={!!form.confirmSimilar} onChange={(e) => setForm({ ...form, confirmSimilar: e.target.checked })} />
                A similar brand exists: {(check?.similar ?? form.similar).map((s) => s.name).join(', ')}. Tick if this is a different brand.
              </label>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn pri" disabled={!form.name.trim() || !form.code.trim() || check?.conflicts?.length > 0} onClick={onboard}>Onboard</button>
              <button type="button" className="btn gh" onClick={() => { setForm(null); setCheck(null); }}>Cancel</button>
            </div>
          </section>
        )}
        {selected && !form && <BrandSetup key={selected.id} brand={selected} onSaved={load} />}
        {!selected && !form && <p className="mut">Pick a brand to set up its pipeline and fields{admin ? ', or onboard a new one' : ''}.</p>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ teams
function TeamsTab() {
  const { say, reloadMe } = useApp();
  const [teams, setTeams] = useState(null);
  const [brands, setBrands] = useState([]);
  const [users, setUsers] = useState([]);
  const [name, setName] = useState('');
  const load = useCallback(() => Promise.all([api.teams().then(setTeams), api.brands().then(setBrands), api.users().then(setUsers)]).catch((e) => say(e.message)), [say]);
  useEffect(() => { load(); }, [load]);
  const run = async (fn, msg) => { try { await fn(); await load(); await reloadMe(); say(msg); } catch (e) { say(e.message); } };
  if (!teams) return <div className="mut">Loading…</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 900 }}>
      <p className="mut" style={{ margin: 0 }}>A team handles a set of brands; anyone in the team can work on any of its brands. People can be in more than one team.</p>
      {teams.map((t) => (
        <section key={t.id} className="tbl" style={box}>
          <b style={{ fontWeight: 600 }}>{t.name}</b>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="lbl">Brands</span>
            {brands.map((b) => {
              const on = t.brands.some((x) => x.id === b.id);
              return <label key={b.id} style={{ display: 'flex', gap: 4, alignItems: 'center' }}><input type="checkbox" checked={on} onChange={() => run(() => api.updateTeam(t.id, { brand_ids: on ? t.brands.filter((x) => x.id !== b.id).map((x) => x.id) : [...t.brands.map((x) => x.id), b.id] }), `${t.name} updated`)} />{b.name}</label>;
            })}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="lbl">Members</span>
            {t.members.map((m) => <span key={m.id} className="chip">{m.name} · {ROLE_LABEL[m.role]}</span>)}
            <select className="inp" value="" onChange={(e) => e.target.value && run(() => api.updateUser(e.target.value, { team_ids: [...(users.find((u) => u.id === e.target.value)?.team_ids ?? []), t.id] }), 'Member added')} style={{ height: 28, fontSize: 12 }}>
              <option value="">Add someone…</option>{users.filter((u) => !t.members.some((m) => m.id === u.id)).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
        </section>
      ))}
      <div style={{ display: 'flex', gap: 8 }}><input className="inp" placeholder="New team name" value={name} onChange={(e) => setName(e.target.value)} /><button type="button" className="btn pri" disabled={!name.trim()} onClick={() => run(() => api.createTeam({ name }), `${name} created`).then(() => setName(''))}>Add team</button></div>
    </div>
  );
}

// ------------------------------------------------------------------ people
function PeopleTab() {
  const { say } = useApp();
  const [users, setUsers] = useState(null);
  const [teams, setTeams] = useState([]);
  const [f, setF] = useState(null);
  const load = useCallback(() => Promise.all([api.users().then(setUsers), api.teams().then(setTeams)]).catch((e) => say(e.message)), [say]);
  useEffect(() => { load(); }, [load]);
  if (!users) return <div className="mut">Loading…</div>;
  const teamName = (id) => teams.find((t) => t.id === id)?.name;
  const create = async () => { try { await api.createUser(f); setF(null); await load(); say(`${f.name} added`); } catch (e) { say(e.message); } };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 900 }}>
      <div className="tbl">
        <div className="r h" style={{ gridTemplateColumns: '1fr 1.2fr 140px 1fr' }}><span>Name</span><span>Email</span><span>Role</span><span>Teams</span></div>
        {users.map((u) => (
          <div key={u.id} className="r" style={{ gridTemplateColumns: '1fr 1.2fr 140px 1fr' }}>
            <span>{u.name}</span><span className="mut">{u.email}</span><span>{ROLE_LABEL[u.role]}</span><span className="mut">{u.team_ids.map(teamName).filter(Boolean).join(', ') || '—'}</span>
          </div>
        ))}
      </div>
      {f ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input className="inp" placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <input className="inp" placeholder="Email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          <input className="inp" type="password" placeholder="Password (8+)" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          <select className="inp" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{Object.entries(ROLE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <select className="inp" value={f.team_ids[0] ?? ''} onChange={(e) => setF({ ...f, team_ids: e.target.value ? [e.target.value] : [] })}><option value="">No team</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
          <button type="button" className="btn pri" onClick={create}>Add person</button><button type="button" className="btn gh" onClick={() => setF(null)}>Cancel</button>
        </div>
      ) : <button type="button" className="btn pri" style={{ alignSelf: 'flex-start' }} onClick={() => setF({ name: '', email: '', password: '', role: 'sales', team_ids: [] })}><Icon name="plus" />Add a person</button>}
    </div>
  );
}

export default function Settings() {
  const { tab } = useParams();
  const { user } = useApp();
  const admin = user?.role === 'admin';
  const tabs = [['brands', 'Brands'], ...(admin ? [['teams', 'Teams'], ['people', 'People']] : [])];
  if (!tabs.some(([k]) => k === tab)) return <Navigate to="/settings/brands" replace />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flexGrow: 1 }}>
      <div style={{ padding: '24px 28px 12px' }}><h1 className="ttl">Settings</h1><span className="mut">Brand onboarding, each brand's pipeline and fields, teams and people.</span></div>
      <nav className="tabs">{tabs.map(([k, l]) => <NavLink key={k} to={`/settings/${k}`} className={({ isActive }) => (isActive ? 'on' : '')}>{l}</NavLink>)}</nav>
      <div style={{ overflow: 'auto', padding: '20px 28px 40px' }}>
        {tab === 'brands' && <BrandsTab />}
        {tab === 'teams' && <TeamsTab />}
        {tab === 'people' && <PeopleTab />}
      </div>
    </div>
  );
}
