import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app';
import { seedFromFile } from './seed';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  dbPath: process.env.DB_PATH ?? resolve(root, 'data/diary.db'),
  timeZone: process.env.DRIVER_TZ ?? 'Asia/Almaty',
  seedFile: process.env.SEED_FILE ?? resolve(root, 'data/trips.json'),
};

if (config.dbPath !== ':memory:') mkdirSync(dirname(config.dbPath), { recursive: true });

const app = buildApp({ dbPath: config.dbPath, timeZone: config.timeZone, logger: true });

if (config.seedFile) {
  const report = seedFromFile(app.trips, config.seedFile);
  app.log.info({ seed: config.seedFile, ...report }, 'seed loaded');
}

const shutdown = async (signal: string) => {
  app.log.info(`${signal} received, shutting down`);
  await app.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port: config.port, host: config.host });
