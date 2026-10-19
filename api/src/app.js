import cors from 'cors';
import express from 'express';
import { errorHandler, notFound } from './lib/errors.js';
import { authRouter, requireAuth } from './routes/auth.js';
import { orgRouter } from './routes/org.js';

export function createApp(config) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use(cors(config.corsOrigins.length ? { origin: config.corsOrigins } : { origin: !config.prod }));
  app.use(express.json({ limit: '8mb' }));            // chat exports arrive as JSON text

  const api = express.Router();
  api.get('/health', (_req, res) => res.json({ ok: true }));
  api.use(authRouter);
  api.use(requireAuth);
  api.use(orgRouter);
  api.use((_req, _res, next) => next(notFound('Endpoint')));

  app.use('/api', api);
  app.use(errorHandler);
  return app;
}
