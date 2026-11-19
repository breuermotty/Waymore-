import { createApp } from './app';
import { config } from './config';
import { openDb } from './db/client';
import { seedIfEmpty } from './db/seed';

const db = openDb();
seedIfEmpty(db);

createApp(db).listen(config.port, () => {
  console.log(`[waymore] API listening on http://localhost:${config.port}`);
});
