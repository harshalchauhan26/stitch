// Test harness: a fresh database per test file on the local replica set (npm run mongo:dev), the real app on a random port.
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { connect } from '../src/db.js';
import { ensureSchema } from '../src/models/index.js';
import { bootstrap } from '../src/services/bootstrap.js';

const BASE = process.env.MONGODB_TEST_URI || 'mongodb://127.0.0.1:27018/?directConnection=true';

export async function startApp() {
  const dbName = `stitch_test_${crypto.randomBytes(4).toString('hex')}`;
  await connect(BASE.replace(/\/(\?|$)/, `/${dbName}$1`));
  await ensureSchema();
  await bootstrap({ tenant: { name: 'Test Co', slug: 'test' }, email: 'admin@stitch.test', password: 'stitch123' });
  const server = createApp(loadConfig({ WEBHOOK_WORKER: 'off' })).listen(0);
  await new Promise((ok) => server.once('listening', ok));
  const url = `http://127.0.0.1:${server.address().port}/api`;

  async function api(method, path, body, token) {
    const res = await fetch(url + path, {
      method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }
  const login = async (email, password = 'stitch123') => {
    const r = await api('POST', '/auth/login', { email, password });
    if (r.status !== 200) throw new Error(`login ${email} failed: ${JSON.stringify(r.body)}`);
    return r.body.token;
  };
  const close = async () => {
    await new Promise((ok) => server.close(ok));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  };
  return { url, api, login, close };
}

/** Two brands, two teams, a member in each, and a pod lead in both. Returns ids and tokens. */
export async function seedOrg(t) {
  const admin = await t.login('admin@stitch.test');
  const ok = (r, status = 201) => { if (r.status !== status) throw new Error(`${status} expected, got ${r.status}: ${JSON.stringify(r.body)}`); return r.body; };
  const na = ok(await t.api('POST', '/brands', { name: 'Noor Atelier', code: 'NA', template_key: 'womenswear', instagram: '@nooratelier', whatsapp_numbers: ['+91 98111 00001'] }, admin));
  const vm = ok(await t.api('POST', '/brands', { name: 'Veda Menswear', code: 'VM', template_key: 'menswear', whatsapp_numbers: ['+91 98111 00002'] }, admin));
  const alpha = ok(await t.api('POST', '/teams', { name: 'Team Alpha', brand_ids: [na.id] }, admin));
  const beta = ok(await t.api('POST', '/teams', { name: 'Team Beta', brand_ids: [vm.id] }, admin));
  const priya = ok(await t.api('POST', '/users', { name: 'Priya Shah', email: 'priya@stitch.test', password: 'stitch123', role: 'sales', team_ids: [alpha.id] }, admin));
  const arjun = ok(await t.api('POST', '/users', { name: 'Arjun Rao', email: 'arjun@stitch.test', password: 'stitch123', role: 'sales', team_ids: [beta.id] }, admin));
  const meera = ok(await t.api('POST', '/users', { name: 'Meera Lead', email: 'meera@stitch.test', password: 'stitch123', role: 'pod_lead', team_ids: [alpha.id, beta.id] }, admin));
  return {
    admin, na, vm, alpha, beta, priya, arjun, meera,
    tokens: { priya: await t.login('priya@stitch.test'), arjun: await t.login('arjun@stitch.test'), meera: await t.login('meera@stitch.test') },
  };
}
