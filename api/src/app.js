import cors from 'cors';
import mongoose from 'mongoose';
import express from 'express';
import { errorHandler, notFound } from './lib/errors.js';
import { authRouter, requireAuth } from './routes/auth.js';
import { clientsRouter } from './routes/clients.js';
import { conversationsRouter } from './routes/conversations.js';
import { enquiriesRouter } from './routes/enquiries.js';
import { extractionRouter } from './routes/extraction.js';
import { fulfilmentRouter } from './routes/fulfilment.js';
import { integrationsRouter } from './routes/integrations.js';
import { leadsRouter } from './routes/leads.js';
import { ordersRouter } from './routes/orders.js';
import { orgRouter } from './routes/org.js';
import { settingsRouter } from './routes/settings.js';
import { whatsappRouter } from './routes/whatsapp.js';

export function createApp(config) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use(cors(config.corsOrigins.length ? { origin: config.corsOrigins } : { origin: !config.prod }));
  // chat exports arrive as JSON text. The WhatsApp webhook also keeps the raw bytes: Meta signs those, not the parsed JSON
  app.use(express.json({ limit: '8mb', verify: (req, _res, buf) => { if (req.originalUrl.startsWith('/api/whatsapp/webhook')) req.rawBody = buf; } }));

  const api = express.Router();
  api.get('/health', (_req, res) => {
    const db = mongoose.connection.readyState === 1;           // 1 = connected
    res.status(db ? 200 : 503).json({ ok: db, db: db ? 'up' : 'down' });
  });
  api.use(authRouter);
  api.use(whatsappRouter);                           // Meta / the provider: checked by signature, not by login
  api.use(enquiriesRouter);                          // the landing-page form is open to anyone; its list route checks the login itself
  api.use(requireAuth);
  api.use(orgRouter); 
  api.use(settingsRouter);
  api.use(clientsRouter);
  api.use(leadsRouter);
  api.use(ordersRouter);
  api.use(conversationsRouter);
  api.use(extractionRouter);                         // chat -> suggestions, behind the same login as everything else
  api.use(fulfilmentRouter);
  api.use(integrationsRouter);
  api.use((_req, _res, next) => next(notFound('Endpoint')));

  app.use('/api', api);
  app.use(errorHandler);
  return app;
}
