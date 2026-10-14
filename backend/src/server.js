import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createApp } from './routes/index.js';
import { seedIfEmpty } from './seed.js';
import { firstAdmin, productionProblems } from './config.js';
import { syncDefaultRules } from './routes/admin.js';

// Load backend/.env (KEY=value lines) without needing any extra package. Real environment variables win.
const envFile = path.join(path.dirname(fileURLToPath(import.meta.url)), '../.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const fail = (list) => { console.error('Cannot start in production:\n - ' + list.join('\n - ')); process.exit(1); };
if (productionProblems().length) fail(productionProblems());
const db = openDb();
if (db.prepare('SELECT COUNT(*) n FROM tenants').get().n === 0) {
  const admin = firstAdmin();
  if (admin.problems.length) fail(admin.problems);
  seedIfEmpty(db, { admin });
}
syncDefaultRules(db);                                            // new default fields reach existing brands
const port = process.env.PORT || 3001;
const server = createApp(db).listen(port, () => {
  console.log(`Stitch API on http://localhost:${port}`);
  console.log(process.env.ANTHROPIC_API_KEY
    ? `Chat reading: AI ON (model ${process.env.STITCH_LLM_MODEL || 'claude-haiku-5-5'})`
    : 'Chat reading: code only (no ANTHROPIC_API_KEY set). Add a key to backend/.env to switch the AI on.');
});

// Docker / hosting platforms stop the app with SIGTERM: finish requests and close the database cleanly so the SQLite file is never left mid-write.
const stop = () => { server.close(() => { db.close(); process.exit(0); }); setTimeout(() => process.exit(0), 8000).unref(); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
