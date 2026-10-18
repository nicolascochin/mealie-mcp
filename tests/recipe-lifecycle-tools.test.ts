import type { Client } from '@modelcontextprotocol/client';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MealieRecipe } from '../src/mealie/types.js';
import { callJson, connectMcp, startTestApp, toolText, type TestApp } from './helpers/app.js';
import { mealie, mealieUrl, VALID_TOKEN } from './helpers/mealie.js';
import { quiche } from './helpers/recipes.js';

const page = <T>(items: T[]) => ({ page: 1, per_page: -1, total: items.length, total_pages: 1, items });
const FOODS = [
  { id: 'f-farine', name: 'farine', pluralName: 'farine', aliases: [] },
  { id: 'f-œuf', name: 'œuf', pluralName: 'œufs', aliases: [] },
  { id: 'f-lait', name: 'lait', pluralName: 'lait', aliases: [] },
];
const UNITS = [{ id: 'u-gramme', name: 'gramme', pluralName: 'grammes', abbreviation: 'g', aliases: [] }];
const TAGS = [{ id: 't1', name: 'Rapide', slug: 'rapide' }];
const CATEGORIES = [{ id: 'c1', name: 'Dessert', slug: 'dessert' }];

interface Call {
  method: string;
  path: string;
  body?: unknown;
}

let calls: Call[];
let stored: MealieRecipe & Record<string, unknown>;
let failPatch: boolean;
let app: TestApp;
let client: Client;

const record = async (request: Request) => {
  const url = new URL(request.url);
  const text = await request.text();
  calls.push({ method: request.method, path: url.pathname, ...(text ? { body: JSON.parse(text) } : {}) });
};
const writes = () => calls.filter((c) => c.method !== 'GET');

beforeEach(async () => {
  calls = [];
  failPatch = false;
  stored = { ...quiche(), settings: { public: true, disableAmount: true } };
  mealie.use(
    http.get(mealieUrl('/api/foods'), () => HttpResponse.json(page(FOODS))),
    http.get(mealieUrl('/api/units'), () => HttpResponse.json(page(UNITS))),
    http.get(mealieUrl('/api/organizers/tags'), () => HttpResponse.json(page(TAGS))),
    http.get(mealieUrl('/api/organizers/categories'), () => HttpResponse.json(page(CATEGORIES))),
    http.post(mealieUrl('/api/organizers/tags'), async ({ request }) => {
      await record(request.clone());
      const { name } = (await request.json()) as { name: string };
      return HttpResponse.json({ id: `t-${name}`, name, slug: name.toLowerCase() }, { status: 201 });
    }),
    http.post(mealieUrl('/api/recipes'), async ({ request }) => {
      await record(request);
      return HttpResponse.json('crepes', { status: 201 });
    }),
    http.post(mealieUrl('/api/recipes/create/url'), async ({ request }) => {
      await record(request);
      return HttpResponse.json('quiche-lorraine', { status: 201 });
    }),
    http.post(mealieUrl('/api/recipes/:slug/duplicate'), async ({ request }) => {
      await record(request);
      return HttpResponse.json({ ...quiche(), name: 'Quiche (copie)', slug: 'quiche-copie' });
    }),
    http.patch(mealieUrl('/api/recipes/:slug/last-made'), async ({ request }) => {
      await record(request);
      return HttpResponse.json(stored);
    }),
    http.get(mealieUrl('/api/recipes/:slug'), ({ params }) =>
      params.slug === 'nope' ? HttpResponse.json({ detail: 'Recipe not found' }, { status: 404 }) : HttpResponse.json(stored)
    ),
    http.patch(mealieUrl('/api/recipes/:slug'), async ({ request }) => {
      await record(request);
      if (failPatch) return HttpResponse.json({ detail: 'boom' }, { status: 500 });
      stored = { ...stored, ...(calls.at(-1)!.body as object) };
      return HttpResponse.json(stored);
    }),
    http.delete(mealieUrl('/api/recipes/:slug'), async ({ request }) => {
      await record(request);
      return HttpResponse.json(stored);
    })
  );
  app = await startTestApp();
  client = await connectMcp(app.baseUrl, VALID_TOKEN);
});
afterEach(async () => {
  await client.close();
  await app.close();
});

describe('recipe lifecycle tools', () => {
  it('declare their annotations', async () => {
    const { tools } = await client.listTools();
    const hints = Object.fromEntries(tools.map((t) => [t.name, t.annotations?.destructiveHint]));
    expect(hints).toMatchObject({
      mealie_create_recipe: false,
      mealie_update_recipe: true,
      mealie_import_recipe_from_url: false,
      mealie_duplicate_recipe: false,
      mealie_mark_recipe_made: false,
      mealie_delete_recipe: true,
    });
  });

  it('mealie_create_recipe creates the recipe, then writes structured ingredients, linked steps and metadata', async () => {
    await callJson(client, 'mealie_create_recipe', {
      name: 'Crêpes',
      totalTime: '30 min',
      tags: ['rapide'],
      ingredients: [
        { quantity: 250, unit: 'g', food: 'farine' },
        { quantity: 4, food: 'oeufs', section: 'Liquides' },
        { note: 'une pincée de sel' },
      ],
      steps: [{ text: 'Mélanger.', ingredients: [1, 2, 2] }, { text: 'Cuire.' }],
    });
    expect(writes().map((c) => `${c.method} ${c.path}`)).toEqual(['POST /api/recipes', 'PATCH /api/recipes/crepes']);
    expect(writes()[0]!.body).toEqual({ name: 'Crêpes' });
    const patch = writes()[1]!.body as Record<string, any>;
    expect(patch.totalTime).toBe('30 min');
    expect(patch.tags).toEqual([{ id: 't1', name: 'Rapide', slug: 'rapide' }]);
    expect(patch.settings).toEqual({ public: true, disableAmount: false });
    expect(patch.recipeIngredient).toMatchObject([
      { quantity: 250, unit: { id: 'u-gramme' }, food: { id: 'f-farine' }, note: '', title: null },
      { quantity: 4, unit: null, food: { id: 'f-œuf' }, title: 'Liquides' },
      { quantity: 0, unit: null, food: null, note: 'une pincée de sel' },
    ]);
    const refs = patch.recipeIngredient.map((i: { referenceId: string }) => i.referenceId);
    expect(patch.recipeInstructions).toMatchObject([
      { text: 'Mélanger.', ingredientReferences: [{ referenceId: refs[0] }, { referenceId: refs[1] }] },
      { text: 'Cuire.', ingredientReferences: [] },
    ]);
  });

  it('mealie_create_recipe validates everything before creating anything', async () => {
    const result = await client.callTool({
      name: 'mealie_create_recipe',
      arguments: { name: 'X', ingredients: [{ quantity: 2 }], steps: [{ text: 'a', ingredients: [3] }] },
    });
    expect(toolText(result).split('\n')).toEqual(['Ingredient 1: give at least a food or a note.', 'Step 1: there is no ingredient 3 (1 given).']);
    const unknown = await client.callTool({ name: 'mealie_create_recipe', arguments: { name: 'X', ingredients: [{ food: 'farinne' }], tags: ['rapid'] } });
    expect(toolText(unknown)).toContain('The food "farinne" was not found. Close matches: "farine".');
    expect(toolText(unknown)).toContain('The tag "rapid" was not found. Close matches: "Rapide".');
    expect(writes()).toEqual([]);
  });

  it('mealie_create_recipe creates missing tags only with createMissing', async () => {
    await callJson(client, 'mealie_create_recipe', { name: 'Crêpes', tags: ['Bretagne'], createMissing: true });
    expect(writes()[0]).toEqual({ method: 'POST', path: '/api/organizers/tags', body: { name: 'Bretagne' } });
  });

  it('mealie_create_recipe deletes the empty recipe when the second write fails', async () => {
    failPatch = true;
    const result = await client.callTool({ name: 'mealie_create_recipe', arguments: { name: 'Crêpes' } });
    expect(result.isError).toBe(true);
    expect(writes().map((c) => `${c.method} ${c.path}`)).toEqual(['POST /api/recipes', 'PATCH /api/recipes/crepes', 'DELETE /api/recipes/crepes']);
  });

  it('mealie_update_recipe sends only the given fields, never ingredients or steps', async () => {
    const result = await callJson<Record<string, unknown>>(client, 'mealie_update_recipe', {
      slug: 'quiche-lorraine',
      description: 'La vraie.',
      servings: 4,
      cookTime: null,
      categories: ['dessert'],
      notes: [{ text: 'Se congèle bien.' }],
    });
    expect(writes()).toEqual([
      {
        method: 'PATCH',
        path: '/api/recipes/quiche-lorraine',
        body: {
          description: 'La vraie.',
          recipeServings: 4,
          cookTime: null,
          notes: [{ title: '', text: 'Se congèle bien.' }],
          recipeCategory: [{ id: 'c1', name: 'Dessert', slug: 'dessert' }],
        },
      },
    ]);
    expect(result).not.toHaveProperty('ingredients');
    expect(result).toMatchObject({ description: 'La vraie.', servings: 4, categories: ['Dessert'] });
  });

  it('mealie_update_recipe refuses an empty update', async () => {
    const result = await client.callTool({ name: 'mealie_update_recipe', arguments: { slug: 'quiche-lorraine' } });
    expect(toolText(result)).toBe('Nothing to change: give at least one field.');
    expect(writes()).toEqual([]);
  });

  it('mealie_import_recipe_from_url imports, then says how to structure free-text ingredients', async () => {
    const result = await callJson<{ name: string; next: string }>(client, 'mealie_import_recipe_from_url', { url: 'https://example.com/quiche' });
    expect(writes()).toEqual([{ method: 'POST', path: '/api/recipes/create/url', body: { url: 'https://example.com/quiche', includeTags: false } }]);
    expect(result.name).toBe('Quiche lorraine');
    expect(result.next).toBe('1 of 4 ingredients are free text: structure them with mealie_edit_ingredients (quantity, unit, food, note).');
  });

  it('mealie_import_recipe_from_url refuses anything but http(s)', async () => {
    const result = await client.callTool({ name: 'mealie_import_recipe_from_url', arguments: { url: 'file:///etc/passwd' } });
    expect(result.isError).toBe(true);
    expect(writes()).toEqual([]);
  });

  it('mealie_duplicate_recipe returns the copy', async () => {
    expect(await callJson(client, 'mealie_duplicate_recipe', { slug: 'quiche-lorraine', name: 'Quiche (copie)' })).toEqual({
      slug: 'quiche-copie',
      name: 'Quiche (copie)',
    });
    expect(writes()[0]!.body).toEqual({ name: 'Quiche (copie)' });
  });

  it('mealie_mark_recipe_made records the given day', async () => {
    expect(await callJson(client, 'mealie_mark_recipe_made', { slug: 'quiche-lorraine', date: '2026-10-12' })).toEqual({
      slug: 'quiche-lorraine',
      lastMade: '2026-10-12',
    });
    expect(writes()[0]).toEqual({ method: 'PATCH', path: '/api/recipes/quiche-lorraine/last-made', body: { timestamp: '2026-10-12T12:00:00.000Z' } });
  });

  it('mealie_delete_recipe deletes and names what was deleted', async () => {
    expect(await callJson(client, 'mealie_delete_recipe', { slug: 'quiche-lorraine' })).toEqual({ deleted: 'Quiche lorraine' });
  });
});
