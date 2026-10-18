import type { Client } from '@modelcontextprotocol/client';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { connectMcp, startTestApp, toolText as textOf, type TestApp } from './helpers/app.js';
import { mealie, mealieUrl, TEST_USER, VALID_TOKEN } from './helpers/mealie.js';

let app: TestApp;
let client: Client;
beforeEach(async () => {
  app = await startTestApp();
  client = await connectMcp(app.baseUrl, VALID_TOKEN);
});
afterEach(async () => {
  await client.close();
  await app.close();
});

describe('mealie_whoami', () => {
  it('is listed as a read-only tool', async () => {
    const { tools } = await client.listTools();
    expect(tools.find((t) => t.name === 'mealie_whoami')?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    });
  });

  it('returns the connected user with only the useful fields', async () => {
    const result = await client.callTool({ name: 'mealie_whoami', arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(textOf(result))).toEqual({
      username: TEST_USER.username,
      fullName: TEST_USER.fullName,
      household: TEST_USER.household,
      group: TEST_USER.group,
    });
  });

  it('turns a Mealie failure into an actionable message', async () => {
    mealie.use(http.get(mealieUrl('/api/users/self'), () => HttpResponse.json({ detail: 'Not authenticated' }, { status: 401 })));
    const result = await client.callTool({ name: 'mealie_whoami', arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('update the token');
  });
});
