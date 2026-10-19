import mongoose from 'mongoose';

export * from './org.js';
export * from './config.js';
export * from './crm.js';
export * from './orders.js';
export * from './integrations.js';

/** Creates every collection and its indexes up front. Collections must exist before they are written inside a transaction. */
export async function ensureSchema() {
  for (const model of Object.values(mongoose.models)) {
    await model.createCollection();
    await model.syncIndexes();
  }
}
