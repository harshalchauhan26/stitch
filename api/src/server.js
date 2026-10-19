import { createApp } from './app.js';
import { firstAdmin, loadConfig, productionProblems } from './config.js';
import { connect } from './db.js';
import { ensureSchema } from './models/index.js';
import { bootstrap } from './services/bootstrap.js';
import { startWebhookWorker } from './services/webhooks.js';

const config = loadConfig();
const problems = [...productionProblems(), ...firstAdmin().problems];
if (problems.length) {
  console.error(`Stitch API will not start:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}

await connect(config.mongoUri);
await ensureSchema();
const first = firstAdmin();
const { created } = await bootstrap(first);
if (created) console.log(`Created tenant "${first.tenant.name}". Sign in as ${first.email}${config.prod ? '' : ` / ${first.password}`}`);

if (config.webhookWorker) startWebhookWorker();
createApp(config).listen(config.port, () => console.log(`Stitch API on http://localhost:${config.port}/api`));
