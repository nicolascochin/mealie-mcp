import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SERVER_NAME } from '../src/mcp/server.js';
import { VERSION } from '../src/version.js';
import { startTestApp, type TestApp } from './helpers/app.js';

let app: TestApp;
beforeEach(async () => {
  app = await startTestApp();
});
afterEach(async () => {
  await app.close();
});

describe('health check', () => {
  it('answers ok on GET /healthz', async () => {
    const res = await fetch(`${app.baseUrl}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  it('rejects other methods on /healthz', async () => {
    const res = await fetch(`${app.baseUrl}/healthz`, { method: 'POST' });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET, HEAD');
  });
});

describe('routing', () => {
  it('answers 404 on unknown paths', async () => {
    const res = await fetch(`${app.baseUrl}/nope`);
    expect(res.status).toBe(404);
  });
});

describe('MCP endpoint', () => {
  it('lets an MCP client connect and identifies the server', async () => {
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', app.baseUrl)));
    try {
      const info = client.getServerVersion();
      expect(info?.name).toBe(SERVER_NAME);
      expect(info?.version).toBe(VERSION);
      expect(client.getInstructions()).toContain('Mealie');
    } finally {
      await client.close();
    }
  });
});
