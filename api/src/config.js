// Settings from environment variables. Development has safe defaults; production refuses to start without real secrets.
export function loadConfig(env = process.env) {
  const prod = env.NODE_ENV === 'production';
  return {
    prod,
    port: Number(env.PORT) || 4000,
    mongoUri: env.MONGODB_URI || 'mongodb://127.0.0.1:27018/stitch?directConnection=true',
    corsOrigins: (env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean),
    trustProxy: env.TRUST_PROXY ? Number(env.TRUST_PROXY) || 1 : (prod ? 1 : 0),
    webhookWorker: env.WEBHOOK_WORKER !== 'off',
  };
}

export function productionProblems(env = process.env) {
  if (env.NODE_ENV !== 'production') return [];
  const p = [];
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) p.push('JWT_SECRET must be a random string of at least 32 characters');
  if (!env.MONGODB_URI) p.push('MONGODB_URI must be set');
  return p;
}

/** First run only (no tenant yet): who is the first admin? Production must say so explicitly. */
export function firstAdmin(env = process.env) {
  const tenant = { name: env.TENANT_NAME || 'Stitch', slug: env.TENANT_SLUG || 'stitch' };
  if (env.NODE_ENV !== 'production') return { tenant, email: env.ADMIN_EMAIL || 'admin@stitch.test', password: env.ADMIN_PASSWORD || 'stitch123', problems: [] };
  const problems = [];
  if (!/^\S+@\S+\.\S+$/.test(env.ADMIN_EMAIL || '')) problems.push('ADMIN_EMAIL must be set (it is the first admin login)');
  if ((env.ADMIN_PASSWORD || '').length < 10) problems.push('ADMIN_PASSWORD must be at least 10 characters');
  return { tenant, email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD, problems };
}
