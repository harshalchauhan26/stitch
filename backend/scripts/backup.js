// npm run backup   -> writes backups/stitch-YYYYMMDD-HHMMSS.db next to the database (or BACKUP_DIR), keeps the newest 14 (BACKUP_KEEP).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../src/db.js';
import { backupDb } from '../src/backup.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dbFile = process.env.DB_FILE || path.join(here, '../data/stitch.db');
const dir = process.env.BACKUP_DIR || path.join(path.dirname(dbFile), 'backups');
const db = openDb(dbFile);
const file = await backupDb(db, dir, { keep: Number(process.env.BACKUP_KEEP) || 14 });
console.log('Backup written:', file);
db.close();
