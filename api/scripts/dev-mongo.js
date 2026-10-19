// Starts a local single-node MongoDB replica set for development and tests.
// Transactions (docs/PLAN_v1.md §8.4) need a replica set; a plain `mongod` refuses them.
// Uses its own port and data folder, so an existing MongoDB on 27017 is left alone.
//   npm run mongo:dev            -> mongodb://127.0.0.1:27018/?directConnection=true
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';

const PORT = Number(process.env.MONGO_DEV_PORT || 27018);
const dir = path.resolve(import.meta.dirname, '..', '.mongo-data');
const uri = `mongodb://127.0.0.1:${PORT}/?directConnection=true`;

async function ping() {
  const client = new mongoose.mongo.MongoClient(uri, { serverSelectionTimeoutMS: 1500 });
  try { await client.connect(); return client; } catch { await client.close().catch(() => {}); return null; }
}

let client = await ping();
if (!client) {
  fs.mkdirSync(dir, { recursive: true });
  // detached instead of --fork, which mongod does not support on macOS
  const child = spawn('mongod', ['--replSet', 'rs0', '--port', String(PORT), '--bind_ip', '127.0.0.1', '--dbpath', dir,
    '--logpath', path.join(dir, 'mongod.log')], { detached: true, stdio: 'ignore' });
  child.on('error', (e) => { console.error(`mongod failed to start (is MongoDB installed?): ${e.message}`); process.exit(1); });
  child.unref();
  for (let i = 0; i < 20 && !client; i++) { await new Promise((ok) => setTimeout(ok, 500)); client = await ping(); }
  if (!client) { console.error(`mongod did not come up; see ${path.join(dir, 'mongod.log')}`); process.exit(1); }
}

const admin = client.db('admin');
try { await admin.command({ replSetGetStatus: 1 }); }
catch (e) {
  if (e.codeName !== 'NotYetInitialized') throw e;
  await admin.command({ replSetInitiate: { _id: 'rs0', members: [{ _id: 0, host: `127.0.0.1:${PORT}` }] } });
}
// wait until this node is primary, so transactions work straight away
for (let i = 0; i < 40; i++) {
  const hello = await admin.command({ hello: 1 });
  if (hello.isWritablePrimary) break;
  await new Promise((ok) => setTimeout(ok, 250));
}
await client.close();
console.log(`MongoDB replica set ready: ${uri}`);
