import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../src/db.js';
import { seed, seedBase, DEMO_PASSWORD } from '../src/seed.js';
import { createApp } from '../src/routes/index.js';
import { loadConfig, productionProblems, firstAdmin } from '../src/config.js';
import { backupDb } from '../src/backup.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
function boot(config, setup = seed) {
  const db = openDb(':memory:'); setup(db);
  const server = createApp(db, { llm: null, config: { ...loadConfig({}), ...config } }).listen(0); server.unref();
  const base = `http://localhost:${server.address().port}`;
  return { db, get: (u, h = {}) => fetch(base + u, { headers: h }), post: (u, body, h = {}) => fetch(base + u, { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify(body) }) };
}

test('config: production refuses a missing or weak secret and a default admin password; development stays easy', () => {
  assert.deepEqual(productionProblems({}), [], 'development: nothing required');
  assert.equal(productionProblems({ NODE_ENV: 'production' }).length, 1);
  assert.equal(productionProblems({ NODE_ENV: 'production', JWT_SECRET: 'short' }).length, 1);
  assert.equal(productionProblems({ NODE_ENV: 'production', JWT_SECRET: 'dev-secret-change-me-in-production-xxxxxxxxxxxx' }).length, 1);
  assert.deepEqual(productionProblems({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(40) }), []);
  assert.equal(firstAdmin({}).password, 'stitch123');
  assert.equal(firstAdmin({ NODE_ENV: 'production' }).problems.length, 2);
  assert.equal(firstAdmin({ NODE_ENV: 'production', ADMIN_EMAIL: 'boss@company.com', ADMIN_PASSWORD: 'stitch123' }).problems.length, 1, 'the demo password is refused');
  assert.equal(firstAdmin({ NODE_ENV: 'production', ADMIN_EMAIL: 'boss@company.com', ADMIN_PASSWORD: 'a-long-real-password' }).problems.length, 0);
  assert.deepEqual(loadConfig({ NODE_ENV: 'production', CORS_ORIGIN: 'https://a.com, https://b.com' }).corsOrigins, ['https://a.com', 'https://b.com']);
});

test('login limiter: repeated wrong passwords lock that sign-in for a while, other people are unaffected', async () => {
  const s = boot({ loginLimit: { max: 3, windowMs: 60_000 } });
  const wrong = () => s.post('/api/auth/login', { email: 'priya@stitch.test', password: 'nope' });
  assert.deepEqual([(await wrong()).status, (await wrong()).status, (await wrong()).status], [401, 401, 401]);
  const locked = await s.post('/api/auth/login', { email: 'priya@stitch.test', password: DEMO_PASSWORD });   // even the RIGHT password is refused now
  assert.equal(locked.status, 429);
  assert.match((await locked.json()).error, /Too many sign-in attempts/);
  // one office, one public address: several different people making typos must NOT lock each other out
  const office = boot({ loginLimit: { max: 3, windowMs: 60_000 } });
  for (const who of ['a@x.co', 'b@x.co', 'c@x.co', 'd@x.co', 'e@x.co', 'f@x.co']) assert.equal((await office.post('/api/auth/login', { email: who, password: 'nope' })).status, 401);
  assert.equal((await office.post('/api/auth/login', { email: 'priya@stitch.test', password: DEMO_PASSWORD })).status, 200, 'still free to sign in after 6 typos from the same address');
  // ...but one address hammering many accounts is eventually stopped (15 = 5 x the per-person limit)
  for (let i = 0; i < 15; i++) await office.post('/api/auth/login', { email: `bot${i}@x.co`, password: 'nope' });
  assert.equal((await office.post('/api/auth/login', { email: 'priya@stitch.test', password: DEMO_PASSWORD })).status, 429);
  const s2 = boot({ loginLimit: { max: 3, windowMs: 60_000 } });
  await s2.post('/api/auth/login', { email: 'priya@stitch.test', password: 'nope' });
  assert.equal((await s2.post('/api/auth/login', { email: 'priya@stitch.test', password: DEMO_PASSWORD })).status, 200, 'a success clears the count');
});

test('production mode: security headers, same-origin CORS by default, an allow-list when set, no framework banner', async () => {
  const closed = boot({ prod: true, corsOrigins: [] });
  const r = await closed.get('/api/health', { origin: 'https://evil.example' });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('access-control-allow-origin'), null, 'no CORS headers: browsers on other sites cannot read it');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.match(r.headers.get('strict-transport-security'), /max-age/);
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(r.headers.get('x-powered-by'), null);
  const open = boot({ prod: true, corsOrigins: ['https://app.example'] });
  assert.equal((await open.get('/api/health', { origin: 'https://app.example' })).headers.get('access-control-allow-origin'), 'https://app.example');
  assert.equal((await open.get('/api/health', { origin: 'https://evil.example' })).headers.get('access-control-allow-origin'), null);
  const dev = boot({ prod: false });
  assert.equal((await dev.get('/api/health', { origin: 'http://localhost:5173' })).headers.get('content-security-policy'), null, 'dev: no CSP so Vite hot reload works');
});

test('health check really touches the database', async () => {
  const s = boot({});
  assert.deepEqual(await (await s.get('/api/health')).json(), { ok: true });
  s.db.close();
  assert.equal((await s.get('/api/health')).status, 500);
});

test('backup: a copy of the live database that opens and holds the data, and only the newest are kept', async () => {
  const db = openDb(':memory:'); seed(db);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stitch-bk-'));
  const f1 = await backupDb(db, dir, { keep: 2, now: new Date('2026-10-01T10:00:00Z') });
  await backupDb(db, dir, { keep: 2, now: new Date('2026-10-02T10:00:00Z') });
  await backupDb(db, dir, { keep: 2, now: new Date('2026-10-03T10:00:00Z') });
  assert.equal(fs.readdirSync(dir).length, 2, 'oldest removed');
  assert.ok(!fs.existsSync(f1));
  const copy = openDb(path.join(dir, fs.readdirSync(dir).sort().pop()));
  assert.equal(copy.prepare('SELECT COUNT(*) n FROM leads').get().n, 17, '15 demo leads + 2 for the second company');
  assert.equal(copy.prepare('SELECT COUNT(*) n FROM users').get().n, 8);
});

function run(env, { wait = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stitch-srv-'));
  const p = spawn(process.execPath, ['src/server.js'], { cwd: root, env: { PATH: process.env.PATH, DB_FILE: path.join(dir, 'x.db'), ...env } });
  let out = ''; p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d));
  return { p, out: () => out, done: new Promise((res) => p.on('exit', (code) => res(code))) };
}

test('a real production server process: refuses to start insecure, then starts, serves, and shuts down cleanly', async () => {
  const bad = run({ NODE_ENV: 'production' });
  assert.equal(await bad.done, 1);
  assert.match(bad.out(), /JWT_SECRET/);
  const noAdmin = run({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(40) });
  assert.equal(await noAdmin.done, 1);
  assert.match(noAdmin.out(), /ADMIN_EMAIL/);
  assert.match(noAdmin.out(), /ADMIN_PASSWORD/);
  const port = 40000 + Math.floor(Math.random() * 20000);
  const ok = run({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(40), ADMIN_EMAIL: 'boss@company.com', ADMIN_PASSWORD: 'a-long-real-password', PORT: String(port) });
  for (let i = 0; i < 40 && !/Stitch API on/.test(ok.out()); i++) await new Promise((r) => setTimeout(r, 100));
  assert.match(ok.out(), /Stitch API on/);
  assert.doesNotMatch(ok.out(), /a-long-real-password/, 'the admin password is never printed');
  assert.equal((await fetch(`http://localhost:${port}/api/health`)).status, 200);
  const login = await fetch(`http://localhost:${port}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'boss@company.com', password: 'a-long-real-password' }) });
  assert.equal(login.status, 200);
  assert.equal((await fetch(`http://localhost:${port}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@stitch.test', password: 'stitch123' }) })).status, 401, 'the demo admin does not exist in production');
  ok.p.kill('SIGTERM');
  // Windows has no real SIGTERM: the child is killed and the exit code is null
  if (process.platform !== 'win32') assert.equal(await ok.done, 0, 'SIGTERM stops it cleanly');
});
