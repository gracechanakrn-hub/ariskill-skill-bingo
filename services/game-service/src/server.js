// Entry point: loads config, opens the durable store, starts timers and listens.
import { loadConfig, describeConfig } from './config.js';
import { openDatabase } from './db.js';
import { createClock } from './clock.js';
import { createLogger } from './log.js';
import { createApp } from './app.js';

let config;
try { config = loadConfig(process.env); } catch (e) { process.stderr.write(`${e.message}\n`); process.exit(1); }
const log = createLogger(config.logLevel);
const db = openDatabase(config.dbPath);
const clock = createClock();
const app = createApp({ db, clock, config, log });
app.ensureDefaultEvent();
app.timers.start();
const addr = await app.listen();
if (config.publicBaseUrlDefaulted && config.port === 0) config.publicBaseUrl = `http://localhost:${addr.port}`; // join links use the real port
process.stdout.write(describeConfig({ ...config, port: addr.port }) + '\n');
process.stdout.write(`  open: ${config.publicBaseUrl}/  (event ${config.defaultEventId})\n`);
log.info('server started', { port: addr.port, env: config.env, eventId: config.defaultEventId });

async function shutdown(signal) {
  log.info('shutting down', { signal });
  await app.close();
  db.close();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
