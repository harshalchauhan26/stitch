// Deployment settings, read once. In development everything has a safe default; in production (NODE_ENV=production) the server
// refuses to start with an insecure setup (see productionProblems).
export function loadConfig(env = process.env) {
  const prod = env.NODE_ENV === 'production';
  return {
    prod,
    // Production: same-origin only unless CORS_ORIGIN lists the sites allowed to call the API (comma separated).
    corsOrigins: (env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean),
    // Behind a proxy (Render, nginx, a load balancer) the real client IP is in X-Forwarded-For; needed for the login limiter.
    trustProxy: env.TRUST_PROXY ? Number(env.TRUST_PROXY) || 1 : (prod ? 1 : 0),
    loginLimit: { max: Number(env.LOGIN_MAX_ATTEMPTS) || 8, windowMs: (Number(env.LOGIN_WINDOW_MINUTES) || 15) * 60_000 },
  };
}

export function productionProblems(env = process.env) {
  if (env.NODE_ENV !== 'production') return [];
  const p = [];
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32 || /dev-secret/i.test(env.JWT_SECRET)) p.push('JWT_SECRET must be set to a random string of at least 32 characters');
  return p;
}

/** First run only (empty database): who is the first admin? Dev has a default; production must say so explicitly. */
export function firstAdmin(env = process.env) {
  if (env.NODE_ENV !== 'production') return { email: env.ADMIN_EMAIL || 'admin@stitch.test', password: env.ADMIN_PASSWORD || 'stitch123', problems: [] };
  const problems = [];
  if (!/^\S+@\S+\.\S+$/.test(env.ADMIN_EMAIL || '')) problems.push('ADMIN_EMAIL must be set to a real email address (it is the first admin login)');
  if ((env.ADMIN_PASSWORD || '').length < 10 || env.ADMIN_PASSWORD === 'stitch123') problems.push('ADMIN_PASSWORD must be set to a strong password of at least 10 characters');
  return { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD, problems };
}
