import type { Client } from '@modelcontextprotocol/client';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { callJson, connectMcp, startTestApp, toolText, type TestApp } from './helpers/app.js';
import { mealie, mealieUrl, VALID_TOKEN } from './helpers/mealie.js';
import { quiche } from './helpers/recipes.js';

const page = <T>(items: T[]) => ({ page: 1, per_page: 20, total: items.length, total_pages: 1, items });
const TAGS = [
  { id: 't1', name: 'Classique', slug: 'classique' },
  { id: 't2', name: 'Végétarien', slug: 'vegetarien' },
];
const CATEGORIES = [{ id: 'c1', name: 'Plat', slug: 'plat' }];
const TOOLS = [
  { id: 'k1', name: 'Mixeur', slug: 'mixeur' },
  { id: 'k2', name: 'Moule à tarte', slug: 'moule-a-tarte' },
];
const FOODS = [
  { id: 'f1', name: 'œuf', pluralName: 'œufs', aliases: [] },
  { id: 'f2', name: 'farine', pluralName: 'farine', aliases: [] },
];

let lastUrl: URL | undefined;
let app: TestApp;
let client: Client;

beforeEach(async () => {
  lastUrl = undefined;
  mealie.use(
    http.get(mealieUrl('/api/organizers/tags'), () => HttpResponse.json(page(TAGS))),
    http.get(mealieUrl('/api/organizers/categories'), () => HttpResponse.json(page(CATEGORIES))),
    http.get(mealieUrl('/api/organizers/tools'), () => HttpResponse.json(page(TOOLS))),
    http.get(mealieUrl('/api/foods'), () => HttpResponse.json(page(FOODS))),
    http.get(mealieUrl('/api/recipes/suggestions'), ({ request }) => {
      lastUrl = new URL(request.url);
      return HttpResponse.json({ items: [{ recipe: quiche(), missingFoods: [{ id: 'f9', name: 'lardons' }], missingTools: [] }] });
    }),
    http.get(mealieUrl('/api/recipes/quiche-lorraine'), () => HttpResponse.json(quiche())),
    http.get(mealieUrl('/api/recipes/:slug'), () => HttpResponse.json({ detail: 'Recipe not found' }, { status: 404 })),
    http.get(mealieUrl('/api/recipes'), ({ request }) => {
      lastUrl = new URL(request.url);
      return HttpResponse.json(page([quiche()]));
    })
  );
  app = await startTestApp();
  client = await connectMcp(app.baseUrl, VALID_TOKEN);
});
afterEach(async () => {
  await client.close();
  await app.close();
});

describe('recipe tools', () => {
  it('are read-only', async () => {
    const { tools } = await client.listTools();
    for (const name of ['mealie_search_recipes', 'mealie_get_recipe', 'mealie_suggest_recipes']) {
      expect(tools.find((t) => t.name === name)?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true });
    }
  });

  it('mealie_search_recipes sends text, resolved ids, sort and pagination', async () => {
    const result = await callJson(client, 'mealie_search_recipes', {
      query: 'quiche',
      tags: ['classique', 'Vegetarien'],
      categories: ['plat'],
      tools: ['moule a tarte'],
      foods: ['oeufs'],
      matchAll: true,
      sort: 'newest',
      page: 2,
      perPage: 5,
    });
    expect(result).toEqual({
      page: 1,
      totalPages: 1,
      total: 1,
      recipes: [{ slug: 'quiche-lorraine', name: 'Quiche lorraine', totalTime: '1 h', prepTime: '20 min', tags: ['Classique'], categories: ['Plat'] }],
    });
    const params = lastUrl!.searchParams;
    expect(params.get('search')).toBe('quiche');
    expect(params.getAll('tags')).toEqual(['t1', 't2']);
    expect(params.getAll('categories')).toEqual(['c1']);
    expect(params.getAll('tools')).toEqual(['k2']);
    expect(params.get('requireAllTools')).toBe('true');
    expect(params.getAll('foods')).toEqual(['f1']);
    expect(params.get('requireAllTags')).toBe('true');
    expect(params.get('orderBy')).toBe('created_at');
    expect(params.get('orderDirection')).toBe('desc');
    expect(params.get('page')).toBe('2');
    expect(params.get('perPage')).toBe('5');
  });

  it('mealie_search_recipes defaults to the first page sorted by name, without filters', async () => {
    await callJson(client, 'mealie_search_recipes', {});
    const params = lastUrl!.searchParams;
    expect(Object.fromEntries(params)).toEqual({ page: '1', perPage: '20', orderBy: 'name', orderDirection: 'asc' });
  });

  it('mealie_search_recipes explains an unknown tag with close matches', async () => {
    const result = await client.callTool({ name: 'mealie_search_recipes', arguments: { tags: ['clasique'] } });
    expect(result.isError).toBe(true);
    expect(toolText(result)).toBe('The tag "clasique" was not found. Close matches: "Classique". See mealie_list_tags.');
    expect(lastUrl).toBeUndefined();
  });

  it('mealie_search_recipes explains an unknown kitchen tool', async () => {
    const result = await client.callTool({ name: 'mealie_search_recipes', arguments: { tools: ['mixer'] } });
    expect(toolText(result)).toBe('The tool "mixer" was not found. Close matches: "Mixeur". See mealie_list_tools.');
  });

  it('mealie_get_recipe returns the structured view', async () => {
    const recipe = await callJson<{ ingredients: unknown[]; steps: Array<{ ingredients: number[] }> }>(client, 'mealie_get_recipe', {
      slug: 'quiche-lorraine',
    });
    expect(recipe.ingredients).toHaveLength(4);
    expect(recipe.steps[1]!.ingredients).toEqual([3, 4]);
  });

  it('mealie_get_recipe points to the search when the slug is unknown', async () => {
    const result = await client.callTool({ name: 'mealie_get_recipe', arguments: { slug: 'nope' } });
    expect(result.isError).toBe(true);
    expect(toolText(result)).toBe('Not found in Mealie. Use mealie_search_recipes to find the recipe slug.');
  });

  it('mealie_get_recipe refuses a slug that would change the path', async () => {
    const result = await client.callTool({ name: 'mealie_get_recipe', arguments: { slug: '../users/self' } });
    expect(result.isError).toBe(true);
    expect(toolText(result)).toContain('Invalid identifier');
  });

  it('mealie_suggest_recipes resolves foods and lists what is missing', async () => {
    expect(await callJson(client, 'mealie_suggest_recipes', { foods: ['Œufs', 'farine'] })).toEqual({
      recipes: [expect.objectContaining({ slug: 'quiche-lorraine', missingFoods: ['lardons'] })],
    });
    expect(lastUrl!.searchParams.getAll('foods')).toEqual(['f1', 'f2']);
    expect(lastUrl!.searchParams.get('maxMissingFoods')).toBe('3');
  });

  it('mealie_suggest_recipes refuses a food it cannot resolve', async () => {
    const result = await client.callTool({ name: 'mealie_suggest_recipes', arguments: { foods: ['farinne'] } });
    expect(toolText(result)).toBe('The food "farinne" was not found. Close matches: "farine". See mealie_search_foods.');
  });
});
