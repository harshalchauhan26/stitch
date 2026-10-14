// Safe online backups of the SQLite file (works while the server is running), keeping the newest `keep` copies.
import fs from 'node:fs';
import path from 'node:path';

export async function backupDb(db, dir, { keep = 14, now = new Date() } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const file = path.join(dir, `stitch-${stamp}.db`);
  await db.backup(file);
  const all = fs.readdirSync(dir).filter((f) => /^stitch-.*\.db$/.test(f)).sort();
  for (const f of all.slice(0, Math.max(0, all.length - keep))) fs.rmSync(path.join(dir, f), { force: true });
  return file;
}
