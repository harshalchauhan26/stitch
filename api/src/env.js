// Loads api/.env (if present) before anything reads process.env. Import this first in entry points:
// ES modules evaluate imports in order, and some modules read the environment when they load.
try { process.loadEnvFile(); } catch { /* no .env file: use the real environment */ }
