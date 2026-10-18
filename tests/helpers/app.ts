import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
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
  const config: Config = { mealieUrl: TEST_MEALIE_URL, port: 0, logLevel: 'silent', trustProxy: 0, ...overrides };
  const app = createApp({ config, logger: createLogger('silent') });
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const { port } = app.server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}`, close: () => app.close() };
}

/** An MCP client connected to `/mcp` with the given Mealie token. Close it after use. */
export async function connectMcp(baseUrl: string, token: string): Promise<Client> {
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL('/mcp', baseUrl), { requestInit: { headers: { authorization: `Bearer ${token}` } } })
  );
  return client;
}

/** Text of the first content block of a tool result. */
export function toolText(result: Awaited<ReturnType<Client['callTool']>>): string {
  const [first] = result.content as Array<{ type: string; text?: string }>;
  return first?.text ?? '';
}

/** Calls a tool and parses its JSON answer; fails the test on a tool error. */
export async function callJson<T = Record<string, unknown>>(client: Client, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) throw new Error(`${name} failed: ${toolText(result)}`);
  return JSON.parse(toolText(result)) as T;
}
