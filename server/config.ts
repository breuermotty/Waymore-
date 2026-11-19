import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

export const config = {
  port: Number(process.env.PORT ?? 4000),
  dbPath: process.env.DB_PATH ?? path.join(root, 'data', 'waymore.db'),
  uploadDir: process.env.UPLOAD_DIR ?? path.join(root, 'data', 'uploads'),
  jwtSecret: process.env.JWT_SECRET ?? 'waymore-dev-secret-change-me',
  isProd: process.env.NODE_ENV === 'production',
  clientDist: path.join(root, 'dist'),
  migrationsDir: path.join(root, 'server', 'db', 'migrations'),
};

if (config.isProd && config.jwtSecret === 'waymore-dev-secret-change-me') {
  console.warn('[waymore] WARNING: JWT_SECRET is not set; using the insecure development secret.');
}
