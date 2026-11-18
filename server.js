import { openDb } from './db.js';
import { createApp } from './app.js';

const port = Number(process.env.PORT) || 3000;
const app = createApp(openDb());
app.listen(port, '0.0.0.0', () => {
  console.log(`Shop app running:  office  http://localhost:${port}/`);
  console.log(`                   tablets http://<this-computer's-IP>:${port}/tech.html`);
});
