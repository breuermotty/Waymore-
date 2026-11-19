import fs from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import express from 'express';
import { authenticate } from './auth';
import { config } from './config';
import type { DB } from './db/client';
import { errorHandler } from './http';
import { authRoutes, settingsRoutes, userRoutes } from './routes/auth';
import { customerRoutes } from './routes/customers';
import { inspectionRoutes, invoiceRoutes, publicRoutes, reportRoutes } from './routes/misc';
import { partRoutes } from './routes/parts';
import { workOrderRoutes } from './routes/workOrders';

export function createApp(db: DB) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  const api = express.Router();
  api.get('/health', (_req, res) => {
    res.json({ ok: true });
  });
  api.use(authRoutes(db));
  api.use(publicRoutes(db));

  // Everything below requires a signed-in user.
  api.use(authenticate);
  api.use(userRoutes(db));
  api.use(settingsRoutes(db));
  api.use(customerRoutes(db));
  api.use(workOrderRoutes(db));
  api.use(partRoutes(db));
  api.use(inspectionRoutes(db));
  api.use(invoiceRoutes(db));
  api.use(reportRoutes(db));
  api.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.use('/api', api);

  // Serve the built client in production.
  if (fs.existsSync(path.join(config.clientDist, 'index.html'))) {
    app.use(express.static(config.clientDist, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api).*/, (_req, res) => {
      res.sendFile(path.join(config.clientDist, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}
