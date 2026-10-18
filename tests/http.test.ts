import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_MAX_FAILURES } from '../src/auth/limiter.js';
import { SERVER_NAME } from '../src/mcp/server.js';
import { VERSION } from '../src/version.js';
import { startTestApp, type TestApp } from './helpers/app.js';
import { mealie, mealieUrl, VALID_TOKEN } from './helpers/mealie.js';

let app: TestApp;
beforeEach(async () => {
  app = await startTestApp();
});
afterEach(async () => {
  await app.close();
});

/** A minimal MCP initialize request, enough to reach the auth gate. */
function postMcp(headers: Record<string, string> = {}) {
  return fetch(`${app.baseUrl}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } },
    }),
  });
}

async function connect(token = VALID_TOKEN): Promise<Client> {
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL('/mcp', app.baseUrl), { requestInit: { headers: { authorization: `Bearer ${token}` } } })
  );
  return client;
}

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

describe('authentication', () => {
  it('answers 401 without a token', async () => {
    const res = await postMcp();
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe('Bearer realm="mealie-mcp"');
  });

  it('answers 401 with a token Mealie refuses', async () => {
    const res = await postMcp({ authorization: 'Bearer wrong' });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('error="invalid_token"');
  });

  it('answers 503 when Mealie cannot check the token', async () => {
    mealie.use(http.get(mealieUrl('/api/users/self'), () => HttpResponse.error()));
    const res = await postMcp({ authorization: `Bearer ${VALID_TOKEN}` });
    expect(res.status).toBe(503);
  });

  it('blocks an IP after repeated invalid tokens, but not after missing ones', async () => {
    for (let i = 0; i < DEFAULT_MAX_FAILURES + 5; i++) expect((await postMcp()).status).toBe(401);
    for (let i = 0; i < DEFAULT_MAX_FAILURES; i++) expect((await postMcp({ authorization: 'Bearer wrong' })).status).toBe(401);
    const blocked = await postMcp({ authorization: `Bearer ${VALID_TOKEN}` });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('counts failures per forwarded IP when a proxy is trusted', async () => {
    await app.close();
    app = await startTestApp({ trustProxy: 1 });
    for (let i = 0; i < DEFAULT_MAX_FAILURES; i++) {
      await postMcp({ authorization: 'Bearer wrong', 'x-forwarded-for': '1.2.3.4' });
    }
    expect((await postMcp({ authorization: `Bearer ${VALID_TOKEN}`, 'x-forwarded-for': '1.2.3.4' })).status).toBe(429);
    expect((await postMcp({ authorization: `Bearer ${VALID_TOKEN}`, 'x-forwarded-for': '5.6.7.8' })).status).toBe(200);
  });
});

describe('MCP endpoint', () => {
  it('lets an authenticated MCP client connect and identifies the server', async () => {
    const client = await connect();
    try {
      const info = client.getServerVersion();
      expect(info?.name).toBe(SERVER_NAME);
      expect(info?.version).toBe(VERSION);
      expect(client.getInstructions()).toContain('Mealie');
    } finally {
      await client.close();
    }
  });

  it('refuses an MCP client with a bad token', async () => {
    await expect(connect('wrong')).rejects.toThrow();
  });
});
