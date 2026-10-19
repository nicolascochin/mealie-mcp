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
const TOOLS = [{ id: 'k1', name: 'Poêle à crêpes', slug: 'poele-a-crepes', householdsWithTool: ['maison'] }];

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
    http.get(mealieUrl('/api/organizers/tools'), () => HttpResponse.json(page(TOOLS))),
    http.post(mealieUrl('/api/organizers/tools'), async ({ request }) => {
      await record(request.clone());
      const { name } = (await request.json()) as { name: string };
      return HttpResponse.json({ id: `k-${name}`, name, slug: name.toLowerCase() }, { status: 201 });
    }),
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
    http.post(mealieUrl('/api/recipes/:slug/image'), async ({ request, params }) => {
      await record(request);
      if (params.slug === 'nope') return HttpResponse.json({ detail: 'Recipe not found' }, { status: 404 });
      const { url } = calls.at(-1)!.body as { url: string };
      return url.endsWith('.html')
        ? HttpResponse.json({ detail: { message: 'Url is not an image' } }, { status: 400 })
        : HttpResponse.json({ image: 'k3y' });
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
  it('tell the model to create a recipe shared as a photo or text with mealie_create_recipe', async () => {
    expect(client.getInstructions()).toMatch(/photo, a screenshot or text, read it yourself and create it with mealie_create_recipe/);
    const { tools } = await client.listTools();
    const description = (name: string) => tools.find((t) => t.name === name)?.description ?? '';
    expect(description('mealie_create_recipe')).toContain('a recipe shared as a photo, a screenshot or text');
    expect(description('mealie_import_recipe_from_url')).toContain('For a photo or text without a URL, use mealie_create_recipe.');
  });

  it('declare their annotations', async () => {
    const { tools } = await client.listTools();
    const hints = Object.fromEntries(tools.map((t) => [t.name, t.annotations?.destructiveHint]));
    expect(hints).toMatchObject({
      mealie_create_recipe: false,
      mealie_update_recipe: true,
      mealie_import_recipe_from_url: false,
      mealie_set_recipe_image: false,
      mealie_duplicate_recipe: false,
      mealie_mark_recipe_made: false,
      mealie_delete_recipe: true,
    });
  });

  it('mealie_create_recipe creates the recipe, then writes structured ingredients, linked steps and metadata', async () => {
    await callJson(client, 'mealie_create_recipe', {
      name: 'Crêpes',
      totalTime: { minutes: 30 },
      tags: ['rapide'],
      tools: ['poele a crepes'],
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
    expect(patch.totalTimeSeconds).toBe(1800);
    expect(patch).not.toHaveProperty('totalTime');
    expect(patch.tags).toEqual([{ id: 't1', name: 'Rapide', slug: 'rapide' }]);
    expect(patch.tools).toEqual([{ id: 'k1', name: 'Poêle à crêpes', slug: 'poele-a-crepes' }]);
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

  it('mealie_create_recipe refuses an unknown kitchen tool, and creates it with createMissing', async () => {
    const unknown = await client.callTool({ name: 'mealie_create_recipe', arguments: { name: 'Crêpes', tools: ['Billig'] } });
    expect(toolText(unknown)).toBe('The tool "Billig" was not found. Set createMissing: true to create it, or see mealie_list_tools.');
    expect(writes()).toEqual([]);
    await callJson(client, 'mealie_create_recipe', { name: 'Crêpes', tools: ['Billig'], createMissing: true });
    expect(writes()[0]).toEqual({ method: 'POST', path: '/api/organizers/tools', body: { name: 'Billig' } });
    expect((writes()[2]!.body as Record<string, unknown>).tools).toEqual([{ id: 'k-Billig', name: 'Billig', slug: 'billig' }]);
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
          notes: [{ title: '', text: 'Se congèle bien.' }],
          recipeCategory: [{ id: 'c1', name: 'Dessert', slug: 'dessert' }],
        },
      },
    ]);
    expect(result).not.toHaveProperty('ingredients');
    expect(result).toMatchObject({ description: 'La vraie.', servings: 4, categories: ['Dessert'] });
  });

  it('mealie_update_recipe writes the cooking time into the duration and text Mealie shows', async () => {
    const result = await callJson<Record<string, unknown>>(client, 'mealie_update_recipe', {
      slug: 'quiche-lorraine',
      cookTime: { hours: 1, minutes: 30, text: 'à 200 °C' },
    });
    expect(writes().map((c) => c.body)).toEqual([{ performTimeSeconds: 5400, performTime: 'à 200 °C' }]);
    expect(result).toMatchObject({ cookTime: { hours: 1, minutes: 30, text: 'à 200 °C' } });
  });

  it('mealie_update_recipe keeps the part of a time that is left out', async () => {
    await callJson(client, 'mealie_update_recipe', { slug: 'quiche-lorraine', prepTime: { minutes: 90 } });
    await callJson(client, 'mealie_update_recipe', { slug: 'quiche-lorraine', totalTime: { hours: 2 } });
    await callJson(client, 'mealie_update_recipe', { slug: 'quiche-lorraine', cookTime: { text: 'plus 1 nuit au frais' } });
    expect(writes().map((c) => c.body)).toEqual([
      { prepTimeSeconds: 5400 },
      { totalTimeSeconds: 7200 },
      { performTime: 'plus 1 nuit au frais' },
    ]);
  });

  it('mealie_update_recipe clears the duration, the text or both', async () => {
    await callJson(client, 'mealie_update_recipe', { slug: 'quiche-lorraine', cookTime: { hours: 0, minutes: 0 } });
    await callJson(client, 'mealie_update_recipe', { slug: 'quiche-lorraine', cookTime: { text: null } });
    await callJson(client, 'mealie_update_recipe', { slug: 'quiche-lorraine', prepTime: { text: ' ' } });
    await callJson(client, 'mealie_update_recipe', { slug: 'quiche-lorraine', totalTime: null });
    expect(writes().map((c) => c.body)).toEqual([
      { performTimeSeconds: null },
      { performTime: null },
      { prepTime: null },
      { totalTimeSeconds: null, totalTime: null },
    ]);
  });

  it('mealie_update_recipe clears the old cooking time, and only clears it', async () => {
    stored = { ...stored, cookTime: '35 min', performTimeSeconds: null, performTime: null };
    const before = await callJson<Record<string, unknown>>(client, 'mealie_update_recipe', { slug: 'quiche-lorraine', servings: 6 });
    expect(before).toMatchObject({ legacyCookTime: '35 min', warnings: [expect.stringContaining('legacyCookTime: null')] });

    const moved = await callJson<Record<string, unknown>>(client, 'mealie_update_recipe', {
      slug: 'quiche-lorraine',
      cookTime: { minutes: 35 },
      legacyCookTime: null,
    });
    expect(writes().at(-1)!.body).toEqual({ performTimeSeconds: 2100, cookTime: null });
    expect(moved).toMatchObject({ cookTime: { minutes: 35 } });
    expect(moved).not.toHaveProperty('legacyCookTime');
    expect(moved).not.toHaveProperty('warnings');

    const refused = await client.callTool({ name: 'mealie_update_recipe', arguments: { slug: 'quiche-lorraine', legacyCookTime: '45 min' } });
    expect(refused.isError).toBe(true);
    expect(writes()).toHaveLength(2);
  });

  it('mealie_update_recipe refuses a duration Mealie cannot store', async () => {
    const result = await client.callTool({
      name: 'mealie_update_recipe',
      arguments: { slug: 'quiche-lorraine', cookTime: { hours: 596_523, minutes: 60 } },
    });
    expect(result.isError).toBe(true);
    expect(writes()).toEqual([]);
  });

  it('describe times by the names Mealie shows, the cooking time included', async () => {
    const { tools } = await client.listTools();
    const schema = tools.find((t) => t.name === 'mealie_update_recipe')!.inputSchema as { properties: Record<string, { description?: string }> };
    expect(Object.keys(schema.properties)).toEqual(expect.arrayContaining(['totalTime', 'prepTime', 'cookTime', 'legacyCookTime']));
    expect(schema.properties).not.toHaveProperty('performTime');
    expect(JSON.stringify(schema)).not.toMatch(/resting/i);
  });

  it('mealie_update_recipe replaces the kitchen tools, and clears them with an empty list', async () => {
    await callJson(client, 'mealie_update_recipe', { slug: 'quiche-lorraine', tools: ['Poêle à crêpes'] });
    await callJson(client, 'mealie_update_recipe', { slug: 'quiche-lorraine', tools: [] });
    expect(writes().map((c) => c.body)).toEqual([{ tools: [{ id: 'k1', name: 'Poêle à crêpes', slug: 'poele-a-crepes' }] }, { tools: [] }]);
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

  it('mealie_set_recipe_image has Mealie download the image', async () => {
    const url = 'https://example.com/quiche.jpg';
    expect(await callJson(client, 'mealie_set_recipe_image', { slug: 'quiche-lorraine', url })).toEqual({ slug: 'quiche-lorraine', hasImage: true });
    expect(writes()).toEqual([{ method: 'POST', path: '/api/recipes/quiche-lorraine/image', body: { url } }]);
  });

  it("mealie_set_recipe_image explains Mealie's refusals and refuses anything but http(s)", async () => {
    const page = await client.callTool({ name: 'mealie_set_recipe_image', arguments: { slug: 'quiche-lorraine', url: 'https://example.com/quiche.html' } });
    expect(toolText(page)).toBe('Mealie rejected the request (HTTP 400). Mealie says: Url is not an image');
    const unknown = await client.callTool({ name: 'mealie_set_recipe_image', arguments: { slug: 'nope', url: 'https://example.com/a.jpg' } });
    expect(toolText(unknown)).toBe('Not found in Mealie. Use mealie_search_recipes to find the recipe slug.');
    const local = await client.callTool({ name: 'mealie_set_recipe_image', arguments: { slug: 'quiche-lorraine', url: 'file:///etc/passwd' } });
    expect(local.isError).toBe(true);
    expect(writes()).toHaveLength(2);
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
