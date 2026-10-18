import type { Client } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callJson, connectMcp, startTestApp, toolText, type TestApp } from '../helpers/app.js';
import { liveSeed, readRawRecipe } from './helpers.js';
import { call } from './seed.js';

const seed = liveSeed();
const TOOLS = ['Poêle à crêpes (tests)', 'Louche (tests)'];

let app: TestApp;
let client: Client;
let slug: string | undefined;

beforeAll(async () => {
  app = await startTestApp({ mealieUrl: seed.mealieUrl });
  client = await connectMcp(app.baseUrl, seed.token);
});
afterAll(async () => {
  await client?.close();
  await app?.close();
  if (slug) await call(seed.mealieUrl, 'DELETE', `/api/recipes/${encodeURIComponent(slug)}`, seed.token);
  const { items } = await call<{ items: Array<{ id: string; name: string }> }>(seed.mealieUrl, 'GET', '/api/organizers/tools?page=1&perPage=-1', seed.token);
  for (const tool of items.filter((t) => TOOLS.includes(t.name))) {
    await call(seed.mealieUrl, 'DELETE', `/api/organizers/tools/${tool.id}`, seed.token);
  }
});

describe('kitchen tools against a real Mealie', () => {
  it('refuses an unknown tool, then creates the recipe with its tools on request', async () => {
    const refused = await client.callTool({ name: 'mealie_create_recipe', arguments: { name: 'Crêpes (ustensiles)', tools: TOOLS } });
    expect(toolText(refused)).toContain('The tool "Poêle à crêpes (tests)" was not found.');

    const created = await callJson<{ slug: string; tools: string[] }>(client, 'mealie_create_recipe', {
      name: 'Crêpes (ustensiles)',
      tools: TOOLS,
      ingredients: [{ quantity: 250, unit: 'gramme', food: 'farine' }],
      createMissing: true,
    });
    slug = created.slug;
    expect([...created.tools].sort()).toEqual([...TOOLS].sort());
    const { tools } = await callJson<{ tools: string[] }>(client, 'mealie_list_tools');
    expect(tools).toEqual(expect.arrayContaining(TOOLS));
  });

  it('finds the recipe by tool, ignoring case and accents', async () => {
    const { recipes } = await callJson<{ recipes: Array<{ slug: string }> }>(client, 'mealie_search_recipes', { tools: ['poele a crepes (tests)'] });
    expect(recipes.map((r) => r.slug)).toEqual([slug]);
    const both = await callJson<{ recipes: Array<{ slug: string }> }>(client, 'mealie_search_recipes', { tools: TOOLS, matchAll: true });
    expect(both.recipes.map((r) => r.slug)).toEqual([slug]);
  });

  it('replaces the tools without touching the ingredients', async () => {
    const before = await readRawRecipe(slug!);
    expect(await callJson(client, 'mealie_update_recipe', { slug, tools: ['louche (TESTS)'] })).toMatchObject({ tools: ['Louche (tests)'] });
    const after = await readRawRecipe(slug!);
    expect(after.recipeIngredient).toEqual(before.recipeIngredient);
    const { recipes } = await callJson<{ recipes: unknown[] }>(client, 'mealie_search_recipes', { tools: ['Poêle à crêpes (tests)'] });
    expect(recipes).toEqual([]);
  });
});
