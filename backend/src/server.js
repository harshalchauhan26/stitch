import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createApp } from './routes/index.js';
import { seedIfEmpty } from './seed.js';

// Load backend/.env (KEY=value lines) without needing any extra package. Real environment variables win.
const envFile = path.join(path.dirname(fileURLToPath(import.meta.url)), '../.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const db = openDb();
seedIfEmpty(db);
const port = process.env.PORT || 3001;
createApp(db).listen(port, () => {
  console.log(`Stitch API on http://localhost:${port}`);
  console.log(process.env.ANTHROPIC_API_KEY
    ? `Chat reading: AI ON (model ${process.env.STITCH_LLM_MODEL || 'claude-haiku-5-5'})`
    : 'Chat reading: code only (no ANTHROPIC_API_KEY set). Add a key to backend/.env to switch the AI on.');
});