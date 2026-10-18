import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type TestApp } from '../helpers/app.js';
import { LIVE_USER, RECIPES } from './fixtures.js';
import { liveSeed, readRawRecipe } from './helpers.js';

const seed = liveSeed();
let app: TestApp;
let client: Client;

beforeAll(async () => {
  app = await startTestApp({ mealieUrl: seed.mealieUrl });
  client = new Client({ name: 'live-test', version: '0.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL('/mcp', app.baseUrl), {
      requestInit: { headers: { authorization: `Bearer ${seed.token}` } },
    })
  );
});
afterAll(async () => {
  await client?.close();
  await app?.close();
});

describe('mealie_whoami against a real Mealie', () => {
  it('returns the seeded non-admin user', async () => {
    const result = await client.callTool({ name: 'mealie_whoami', arguments: {} });
    expect(result.isError).toBeFalsy();
    const [content] = result.content as Array<{ type: string; text: string }>;
    const user = JSON.parse(content!.text) as Record<string, unknown>;
    expect(user).toMatchObject({ username: LIVE_USER.username, fullName: LIVE_USER.fullName });
    expect(typeof user.household).toBe('string');
    expect(typeof user.group).toBe('string');
  });

  it('refuses a bad token with 401', async () => {
    const res = await fetch(`${app.baseUrl}/mcp`, {
      method: 'POST',
      headers: { authorization: 'Bearer not-a-mealie-token', 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(401);
  });
});

describe('seed data', () => {
  it('stores structured ingredients, sections and linked steps', async () => {
    const quiche = RECIPES.find((r) => r.name === 'Quiche lorraine')!;
    const recipe = await readRawRecipe(seed.recipes[quiche.name]!);
    const ingredients = recipe.recipeIngredient as Array<Record<string, unknown>>;
    expect(ingredients).toHaveLength(quiche.ingredients.length);
    expect(ingredients.map((i) => i.title || null)).toEqual(quiche.ingredients.map((i) => i.section ?? null));
    expect((ingredients[0]!.food as { name: string }).name).toBe('farine');
    expect((ingredients[0]!.unit as { name: string }).name).toBe('gramme');
    const steps = recipe.recipeInstructions as Array<{ ingredientReferences: Array<{ referenceId: string }> }>;
    expect(steps[0]!.ingredientReferences.map((r) => r.referenceId)).toEqual([ingredients[0]!.referenceId, ingredients[1]!.referenceId]);
  });
});
