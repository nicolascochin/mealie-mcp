import type { Client } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callJson, connectMcp, startTestApp, toolText, type TestApp } from '../helpers/app.js';
import type { RecipeFixture } from './fixtures.js';
import { liveSeed } from './helpers.js';
import { call, createFixtureRecipe } from './seed.js';

const seed = liveSeed();

const TARTINE: RecipeFixture = {
  name: 'Tartine sans photo (image)',
  ingredients: [{ quantity: 10, unit: 'gramme', food: 'beurre' }],
  steps: [{ text: 'Beurrer le pain.', ingredients: [0] }],
};

let app: TestApp;
let client: Client;
let slug: string;

beforeAll(async () => {
  slug = await createFixtureRecipe(seed.mealieUrl, seed.token, TARTINE);
  app = await startTestApp({ mealieUrl: seed.mealieUrl });
  client = await connectMcp(app.baseUrl, seed.token);
});
afterAll(async () => {
  await client?.close();
  await app?.close();
  if (slug) await call(seed.mealieUrl, 'DELETE', `/api/recipes/${encodeURIComponent(slug)}`, seed.token);
});

// The test Mealie cannot reach this machine's servers (it refuses private addresses), so only
// the failures are checked here; the success path is covered with a simulated Mealie.
describe('mealie_set_recipe_image against a real Mealie', () => {
  it('reports why Mealie refused the image, and leaves the recipe without one', async () => {
    expect(await callJson(client, 'mealie_get_recipe', { slug })).not.toHaveProperty('hasImage');
    const result = await client.callTool({ name: 'mealie_set_recipe_image', arguments: { slug, url: 'http://127.0.0.1:9/photo.jpg' } });
    expect(result.isError).toBe(true);
    expect(toolText(result)).toMatch(/^Mealie rejected the request \(HTTP 400\)\. Mealie says: /);
    expect(await callJson(client, 'mealie_get_recipe', { slug })).not.toHaveProperty('hasImage');
  });

  it('explains an unknown recipe', async () => {
    const result = await client.callTool({ name: 'mealie_set_recipe_image', arguments: { slug: 'recette-inexistante', url: 'https://example.com/a.jpg' } });
    expect(toolText(result)).toContain('Use mealie_search_recipes to find the recipe slug.');
  });
});
