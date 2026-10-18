import type { Client } from '@modelcontextprotocol/client';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { callJson, connectMcp, startTestApp, toolText, type TestApp } from './helpers/app.js';
import { mealie, mealieUrl, VALID_TOKEN } from './helpers/mealie.js';

const page = <T>(items: T[]) => ({ page: 1, per_page: -1, total: items.length, total_pages: 1, items });
const RAPIDE = { id: 't1', name: 'Rapide', slug: 'rapide' };
const HIVER = { id: 't2', name: 'Hiver', slug: 'hiver' };
const PLAT = { id: 'c1', name: 'Plat', slug: 'plat' };
const RECIPES: Record<string, { id: string; slug: string; name: string; tags: unknown[]; recipeCategory: unknown[] }> = {
  crepes: { id: 'r1', slug: 'crepes', name: 'Crêpes', tags: [], recipeCategory: [] },
  soupe: { id: 'r2', slug: 'soupe', name: 'Soupe', tags: [HIVER], recipeCategory: [PLAT] },
  quiche: { id: 'r3', slug: 'quiche', name: 'Quiche', tags: [RAPIDE], recipeCategory: [] },
};

let writes: Array<{ path: string; body: unknown }>;
let app: TestApp;
let client: Client;

beforeEach(async () => {
  writes = [];
  const record = async (request: Request) => {
    writes.push({ path: new URL(request.url).pathname, body: await request.json() });
    return HttpResponse.json(null);
  };
  mealie.use(
    http.get(mealieUrl('/api/organizers/tags'), () => HttpResponse.json(page([RAPIDE, HIVER]))),
    http.get(mealieUrl('/api/organizers/categories'), () => HttpResponse.json(page([PLAT]))),
    http.post(mealieUrl('/api/organizers/tags'), async ({ request }) => {
      const { name } = (await request.json()) as { name: string };
      return HttpResponse.json({ id: `t-${name}`, name, slug: name.toLowerCase() }, { status: 201 });
    }),
    http.get(mealieUrl('/api/recipes/:slug'), ({ params }) => {
      const recipe = RECIPES[params.slug as string];
      return recipe ? HttpResponse.json(recipe) : HttpResponse.json({ detail: 'Recipe not found' }, { status: 404 });
    }),
    http.post(mealieUrl('/api/recipes/bulk-actions/:action'), ({ request }) => record(request))
  );
  app = await startTestApp();
  client = await connectMcp(app.baseUrl, VALID_TOKEN);
});
afterEach(async () => {
  await client.close();
  await app.close();
});

describe('bulk recipe tools', () => {
  it('declare their annotations', async () => {
    const { tools } = await client.listTools();
    const hints = Object.fromEntries(
      tools.filter((t) => /_recipes$/.test(t.name) && t.name !== 'mealie_search_recipes' && t.name !== 'mealie_suggest_recipes').map((t) => [t.name, t.annotations?.destructiveHint])
    );
    expect(hints).toEqual({ mealie_tag_recipes: false, mealie_categorize_recipes: false, mealie_delete_recipes: true });
  });

  it('mealie_tag_recipes sends each recipe only the tags it lacks', async () => {
    expect(await callJson(client, 'mealie_tag_recipes', { slugs: ['crepes', 'soupe', 'quiche'], tags: ['rapide', 'hiver'] })).toEqual({
      tags: ['Rapide', 'Hiver'],
      updated: ['Crêpes', 'Soupe', 'Quiche'],
    });
    expect(writes).toEqual([
      { path: '/api/recipes/bulk-actions/tag', body: { recipes: ['crepes'], tags: [RAPIDE, HIVER] } },
      { path: '/api/recipes/bulk-actions/tag', body: { recipes: ['soupe'], tags: [RAPIDE] } },
      { path: '/api/recipes/bulk-actions/tag', body: { recipes: ['quiche'], tags: [HIVER] } },
    ]);
  });

  it('mealie_tag_recipes groups the recipes that lack the same tags, and skips those that have them', async () => {
    expect(await callJson(client, 'mealie_tag_recipes', { slugs: ['crepes', 'soupe', 'quiche', 'crepes'], tags: ['Rapide'] })).toEqual({
      tags: ['Rapide'],
      updated: ['Crêpes', 'Soupe'],
      alreadyThere: ['Quiche'],
    });
    expect(writes).toEqual([{ path: '/api/recipes/bulk-actions/tag', body: { recipes: ['crepes', 'soupe'], tags: [RAPIDE] } }]);
  });

  it('changes nothing when a slug or a tag is unknown', async () => {
    const slug = await client.callTool({ name: 'mealie_tag_recipes', arguments: { slugs: ['crepes', 'nope', 'rien'], tags: ['Rapide'] } });
    expect(toolText(slug)).toBe('No recipe has the slug "nope", "rien". Use mealie_search_recipes to find the slugs. Nothing was changed.');
    const tag = await client.callTool({ name: 'mealie_tag_recipes', arguments: { slugs: ['crepes'], tags: ['Rapid'] } });
    expect(toolText(tag)).toBe('The tag "Rapid" was not found. Close matches: "Rapide". Set createMissing: true to create it, or see mealie_list_tags.');
    expect(writes).toEqual([]);
  });

  it('mealie_tag_recipes creates missing tags on request', async () => {
    await callJson(client, 'mealie_tag_recipes', { slugs: ['crepes'], tags: ['Bretagne'], createMissing: true });
    expect(writes).toEqual([{ path: '/api/recipes/bulk-actions/tag', body: { recipes: ['crepes'], tags: [{ id: 't-Bretagne', name: 'Bretagne', slug: 'bretagne' }] } }]);
  });

  it('mealie_categorize_recipes adds categories the same way', async () => {
    expect(await callJson(client, 'mealie_categorize_recipes', { slugs: ['crepes', 'soupe'], categories: ['plat'] })).toEqual({
      categories: ['Plat'],
      updated: ['Crêpes'],
      alreadyThere: ['Soupe'],
    });
    expect(writes).toEqual([{ path: '/api/recipes/bulk-actions/categorize', body: { recipes: ['crepes'], categories: [PLAT] } }]);
  });

  it('mealie_delete_recipes deletes in one call and names what it deleted', async () => {
    expect(await callJson(client, 'mealie_delete_recipes', { slugs: ['crepes', 'quiche'] })).toEqual({ deleted: ['Crêpes', 'Quiche'] });
    expect(writes).toEqual([{ path: '/api/recipes/bulk-actions/delete', body: { recipes: ['crepes', 'quiche'] } }]);
    const unknown = await client.callTool({ name: 'mealie_delete_recipes', arguments: { slugs: ['crepes', 'nope'] } });
    expect(toolText(unknown)).toContain('Nothing was changed.');
    expect(writes).toHaveLength(1);
  });
});
