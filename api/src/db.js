import mongoose from 'mongoose';

export async function connect(uri) {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { autoIndex: false, serverSelectionTimeoutMS: 5000 });   // indexes come from ensureSchema()
  return mongoose.connection;
}

export const disconnect = () => mongoose.disconnect();

/**
 * Runs fn(session) in one transaction: every write inside commits together or not at all (PLAN §8.2, §11.1).
 * The driver may re-run fn on a transient error, so fn must only write through the session.
 */
export async function withTransaction(fn) {
  const session = await mongoose.startSession();
  try {
    let out;
    await session.withTransaction(async () => { out = await fn(session); });
    return out;
  } finally {
    await session.endSession();
  }
}
