import cors from 'cors';
import mongoose from 'mongoose';
import express from 'express';
import { errorHandler, notFound } from './lib/errors.js';
import { authRouter, requireAuth } from './routes/auth.js';
import { clientsRouter } from './routes/clients.js';
import { conversationsRouter } from './routes/conversations.js';
import { fulfilmentRouter } from './routes/fulfilment.js';
import { integrationsRouter } from './routes/integrations.js';
import { leadsRouter } from './routes/leads.js';
import { ordersRouter } from './routes/orders.js';
import { orgRouter } from './routes/org.js';
import { settingsRouter } from './routes/settings.js';

export function createApp(config) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use(cors(config.corsOrigins.length ? { origin: config.corsOrigins } : { origin: !config.prod }));
  app.use(express.json({ limit: '8mb' }));            // chat exports arrive as JSON text

  const api = express.Router();
  api.get('/health', (_req, res) => {
    const db = mongoose.connection.readyState === 1;           // 1 = connected
    res.status(db ? 200 : 503).json({ ok: db, db: db ? 'up' : 'down' });
  });
  api.use(authRouter);
  api.use(requireAuth);
  api.use(orgRouter);
  api.use(settingsRouter);
  api.use(clientsRouter);
  api.use(leadsRouter);
  api.use(ordersRouter);
  api.use(conversationsRouter);
  api.use(fulfilmentRouter);
  api.use(integrationsRouter);
  api.use((_req, _res, next) => next(notFound('Endpoint')));

  app.use('/api', api);
  app.use(errorHandler);
  return app;
}
