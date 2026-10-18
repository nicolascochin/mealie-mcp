#!/usr/bin/env node
import { ConfigError, loadConfig, type Config } from './config.js';
import { createApp } from './http/app.js';
import { createLogger } from './log.js';
import { VERSION } from './version.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

function main(config: Config): void {
  const logger = createLogger(config.logLevel);
  const app = createApp({ config, logger });

  app.server.listen(config.port, () => {
    logger.info('mealie-mcp listening', { port: config.port, mealieUrl: config.mealieUrl, version: VERSION });
  });

  const shutdown = (signal: string) => {
    logger.info('shutting down', { signal });
    setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS).unref();
    app.close().then(
      () => process.exit(0),
      (err: unknown) => {
        logger.error('shutdown failed', { err });
        process.exit(1);
      }
    );
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

try {
  main(loadConfig());
} catch (err) {
  console.error(err instanceof ConfigError ? err.message : err);
  process.exit(1);
}
