import type { Client } from '@modelcontextprotocol/client';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { callJson, connectMcp, startTestApp, toolText, type TestApp } from './helpers/app.js';
import { mealie, mealieUrl, TEST_USER, VALID_TOKEN } from './helpers/mealie.js';
import { quiche } from './helpers/recipes.js';

const page = <T>(items: T[]) => ({ page: 1, per_page: 20, total: items.length, total_pages: 1, items });
const USER = TEST_USER.id;

let writes: Array<{ method: string; path: string; body?: unknown }>;
let ratings: Array<{ recipeId: string; rating: number | null; isFavorite: boolean }>;
let lastSearch: URL | undefined;
let app: TestApp;
let client: Client;

beforeEach(async () => {
  writes = [];
  ratings = [];
  lastSearch = undefined;
  const record = async (request: Request) => {
    const text = await request.text();
    writes.push({ method: request.method, path: new URL(request.url).pathname, ...(text ? { body: JSON.parse(text) } : {}) });
    return HttpResponse.json(null);
  };
  mealie.use(
    http.post(mealieUrl('/api/users/:id/favorites/nope'), () => HttpResponse.json({ detail: 'Not found.' }, { status: 404 })),
    http.post(mealieUrl('/api/users/:id/favorites/:slug'), ({ request }) => record(request)),
    http.delete(mealieUrl('/api/users/:id/favorites/:slug'), ({ request }) => record(request)),
    http.post(mealieUrl('/api/users/:id/ratings/:slug'), ({ request }) => record(request)),
    http.get(mealieUrl('/api/users/self/ratings'), () => HttpResponse.json({ ratings })),
    http.get(mealieUrl('/api/recipes/quiche-lorraine'), () => HttpResponse.json({ ...quiche(), rating: 3.5 })),
    http.get(mealieUrl('/api/recipes'), ({ request }) => {
      lastSearch = new URL(request.url);
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

describe('favorite and rating tools', () => {
  it('declare their annotations', async () => {
    const { tools } = await client.listTools();
    for (const name of ['mealie_set_favorite', 'mealie_rate_recipe']) {
      expect(tools.find((t) => t.name === name)?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: true });
    }
  });

  it('mealie_set_favorite adds and removes a favorite of the connected user', async () => {
    expect(await callJson(client, 'mealie_set_favorite', { slug: 'quiche-lorraine', favorite: true })).toEqual({ slug: 'quiche-lorraine', favorite: true });
    await callJson(client, 'mealie_set_favorite', { slug: 'quiche-lorraine', favorite: false });
    expect(writes).toEqual([
      { method: 'POST', path: `/api/users/${USER}/favorites/quiche-lorraine` },
      { method: 'DELETE', path: `/api/users/${USER}/favorites/quiche-lorraine` },
    ]);
  });

  it('mealie_set_favorite explains an unknown recipe', async () => {
    const result = await client.callTool({ name: 'mealie_set_favorite', arguments: { slug: 'nope', favorite: true } });
    expect(result.isError).toBe(true);
    expect(toolText(result)).toContain('Use mealie_search_recipes to find the recipe slug.');
  });

  it('mealie_rate_recipe sends the rating, and 0 removes it', async () => {
    expect(await callJson(client, 'mealie_rate_recipe', { slug: 'quiche-lorraine', rating: 4.5 })).toEqual({ slug: 'quiche-lorraine', myRating: 4.5 });
    expect(await callJson(client, 'mealie_rate_recipe', { slug: 'quiche-lorraine', rating: 0 })).toEqual({ slug: 'quiche-lorraine', myRating: null });
    expect(writes).toEqual([
      { method: 'POST', path: `/api/users/${USER}/ratings/quiche-lorraine`, body: { rating: 4.5 } },
      { method: 'POST', path: `/api/users/${USER}/ratings/quiche-lorraine`, body: { rating: 0 } },
    ]);
  });

  it.each([6, 3.7, -1])('mealie_rate_recipe refuses %d', async (rating) => {
    const result = await client.callTool({ name: 'mealie_rate_recipe', arguments: { slug: 'quiche-lorraine', rating } });
    expect(result.isError).toBe(true);
    expect(writes).toEqual([]);
  });

  it("mealie_get_recipe shows the user's own rating and favorite next to the recipe's rating", async () => {
    ratings = [{ recipeId: quiche().id, rating: 5, isFavorite: true }];
    expect(await callJson(client, 'mealie_get_recipe', { slug: 'quiche-lorraine' })).toMatchObject({ rating: 3.5, myRating: 5, favorite: true });
    ratings = [];
    const unrated = await callJson<Record<string, unknown>>(client, 'mealie_get_recipe', { slug: 'quiche-lorraine' });
    expect(unrated).not.toHaveProperty('myRating');
    expect(unrated).not.toHaveProperty('favorite');
  });

  it('mealie_get_recipe still answers when the ratings cannot be read', async () => {
    mealie.use(http.get(mealieUrl('/api/users/self/ratings'), () => HttpResponse.json({ detail: 'boom' }, { status: 500 })));
    expect(await callJson(client, 'mealie_get_recipe', { slug: 'quiche-lorraine' })).toMatchObject({ slug: 'quiche-lorraine', rating: 3.5 });
  });

  it("mealie_search_recipes filters on the user's favorites with Mealie's own query filter", async () => {
    await callJson(client, 'mealie_search_recipes', { favoritesOnly: true, sort: 'rating' });
    expect(lastSearch!.searchParams.get('queryFilter')).toBe(`favoritedBy.id = "${USER}"`);
    await callJson(client, 'mealie_search_recipes', {});
    expect(lastSearch!.searchParams.has('queryFilter')).toBe(false);
  });
});
