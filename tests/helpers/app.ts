import type { AddressInfo } from 'node:net';
import type { Config } from '../../src/config.js';
import { createApp } from '../../src/http/app.js';
import { createLogger } from '../../src/log.js';

export const TEST_MEALIE_URL = 'http://mealie.test';

export interface TestApp {
  baseUrl: string;
  close(): Promise<void>;
}

/** Starts the real HTTP server on a random local port. */
export async function startTestApp(overrides: Partial<Config> = {}): Promise<TestApp> {
  const config: Config = { mealieUrl: TEST_MEALIE_URL, port: 0, logLevel: 'silent', ...overrides };
  const app = createApp({ config, logger: createLogger('silent') });
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const { port } = app.server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}`, close: () => app.close() };
}
