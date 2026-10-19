import './env.js';
import { createApp } from './app.js';
import { firstAdmin, loadConfig, productionProblems } from './config.js';
import { connect } from './db.js';
import { ensureSchema, Tenant } from './models/index.js';
import { bootstrap } from './services/bootstrap.js';
import { startWebhookWorker } from './services/webhooks.js';

const config = loadConfig();
const refuse = (problems) => { console.error(`Stitch API will not start:\n- ${problems.join('\n- ')}`); process.exit(1); };
if (productionProblems().length) refuse(productionProblems());

await connect(config.mongoUri);
await ensureSchema();
const first = firstAdmin();
// ADMIN_EMAIL / ADMIN_PASSWORD only matter on the very first start, when there is no company yet
if (first.problems.length && !await Tenant.exists({ slug: first.tenant.slug })) refuse(first.problems);
const { created } = await bootstrap(first);
if (created) console.log(`Created tenant "${first.tenant.name}". Sign in as ${first.email}${config.prod ? '' : ` / ${first.password}`}`);

if (config.webhookWorker) startWebhookWorker();
createApp(config).listen(config.port, () => console.log(`Stitch API on http://localhost:${config.port}/api`));
