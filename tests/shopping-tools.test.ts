import type { Client } from '@modelcontextprotocol/client';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MealieShoppingList } from '../src/mealie/types.js';
import { callJson, connectMcp, startTestApp, toolText, type TestApp } from './helpers/app.js';
import { mealie, mealieUrl, VALID_TOKEN } from './helpers/mealie.js';
import { quiche } from './helpers/recipes.js';

const page = <T>(items: T[]) => ({ page: 1, per_page: -1, total: items.length, total_pages: 1, items });
const FOODS = [
  { id: 'f-farine', name: 'farine', pluralName: 'farine', aliases: [] },
  { id: 'f-œuf', name: 'œuf', pluralName: 'œufs', aliases: [] },
];
const UNITS = [{ id: 'u-gramme', name: 'gramme', pluralName: 'grammes', abbreviation: 'g', aliases: [] }];

function list(): MealieShoppingList {
  return {
    id: 'l1',
    name: 'Courses',
    listItems: [
      { id: 'i1', shoppingListId: 'l1', quantity: 500, unit: UNITS[0]!, food: FOODS[0]!, unitId: 'u-gramme', foodId: 'f-farine', note: '', display: '500 g farine', checked: false, position: 0, recipeReferences: [{ recipeId: 'r1', recipeQuantity: 250 }] },
      { id: 'i2', shoppingListId: 'l1', quantity: 1, note: 'piles AA', display: 'piles AA', checked: true, position: 1 },
      { id: 'i3', shoppingListId: 'l1', quantity: 6, food: FOODS[1]!, foodId: 'f-œuf', note: '', display: '6 œufs', checked: false, position: 2 },
    ],
    recipeReferences: [{ recipeId: 'r1', recipeQuantity: 1, recipe: { name: 'Quiche lorraine', slug: 'quiche-lorraine' } }],
  };
}

let lists: Array<{ id: string; name: string }>;
let writes: Array<{ method: string; path: string; query?: Record<string, string[]>; body?: unknown }>;
let app: TestApp;
let client: Client;

const record = async (request: Request) => {
  const url = new URL(request.url);
  const text = await request.text();
  const query: Record<string, string[]> = {};
  for (const key of new Set(url.searchParams.keys())) query[key] = url.searchParams.getAll(key);
  writes.push({ method: request.method, path: url.pathname, ...(Object.keys(query).length ? { query } : {}), ...(text ? { body: JSON.parse(text) } : {}) });
};

beforeEach(async () => {
  lists = [{ id: 'l1', name: 'Courses' }];
  writes = [];
  mealie.use(
    http.get(mealieUrl('/api/foods'), () => HttpResponse.json(page(FOODS))),
    http.get(mealieUrl('/api/units'), () => HttpResponse.json(page(UNITS))),
    http.get(mealieUrl('/api/households/shopping/lists'), () => HttpResponse.json(page(lists))),
    http.get(mealieUrl('/api/households/shopping/lists/l1'), () => HttpResponse.json(list())),
    http.post(mealieUrl('/api/households/shopping/lists'), async ({ request }) => {
      await record(request.clone());
      const { name } = (await request.json()) as { name: string };
      return HttpResponse.json({ id: 'l9', name, listItems: [] }, { status: 201 });
    }),
    http.put(mealieUrl('/api/households/shopping/lists/l1'), async ({ request }) => {
      await record(request);
      return HttpResponse.json(list());
    }),
    http.delete(mealieUrl('/api/households/shopping/lists/l1'), async ({ request }) => {
      await record(request);
      return HttpResponse.json(list());
    }),
    http.post(mealieUrl('/api/households/shopping/items/create-bulk'), async ({ request }) => {
      await record(request);
      return HttpResponse.json({ createdItems: [{}], updatedItems: [{}], deletedItems: [] });
    }),
    http.put(mealieUrl('/api/households/shopping/items'), async ({ request }) => {
      await record(request);
      return HttpResponse.json({ createdItems: [], updatedItems: [], deletedItems: [] });
    }),
    http.delete(mealieUrl('/api/households/shopping/items'), async ({ request }) => {
      await record(request);
      return HttpResponse.json({ message: 'ok' });
    }),
    http.get(mealieUrl('/api/recipes/quiche-lorraine'), () => HttpResponse.json(quiche())),
    http.post(mealieUrl('/api/households/shopping/lists/l1/recipe'), async ({ request }) => {
      await record(request);
      return HttpResponse.json(list());
    }),
    http.post(mealieUrl('/api/households/shopping/lists/l1/recipe/r1/delete'), async ({ request }) => {
      await record(request);
      return HttpResponse.json(list());
    })
  );
  app = await startTestApp();
  client = await connectMcp(app.baseUrl, VALID_TOKEN);
});
afterEach(async () => {
  await client.close();
  await app.close();
});

describe('shopping tools', () => {
  it('declare their annotations', async () => {
    const { tools } = await client.listTools();
    const hints = Object.fromEntries(tools.filter((t) => t.name.includes('shopping')).map((t) => [t.name, [t.annotations?.readOnlyHint, t.annotations?.destructiveHint]]));
    expect(hints).toEqual({
      mealie_list_shopping_lists: [true, false],
      mealie_create_shopping_list: [false, false],
      mealie_rename_shopping_list: [false, false],
      mealie_delete_shopping_list: [false, true],
      mealie_get_shopping_list: [true, false],
      mealie_add_shopping_items: [false, false],
      mealie_update_shopping_items: [false, false],
      mealie_remove_shopping_items: [false, true],
      mealie_add_recipe_to_shopping_list: [false, false],
      mealie_remove_recipe_from_shopping_list: [false, true],
    });
  });

  it('lists the lists by name', async () => {
    expect(await callJson(client, 'mealie_list_shopping_lists')).toEqual({ lists: ['Courses'] });
  });

  it('shows unchecked items numbered over the whole list, with their recipes', async () => {
    expect(await callJson(client, 'mealie_get_shopping_list', {})).toEqual({
      name: 'Courses',
      items: [
        { n: 1, quantity: 500, unit: 'gramme', food: 'farine', display: '500 g farine', recipes: ['Quiche lorraine'] },
        { n: 3, quantity: 6, food: 'œuf', display: '6 œufs' },
      ],
      checkedHidden: 1,
      recipes: [{ name: 'Quiche lorraine', slug: 'quiche-lorraine', scale: 1 }],
    });
    const all = await callJson<{ items: Array<{ n: number; checked?: boolean }> }>(client, 'mealie_get_shopping_list', { includeChecked: true });
    expect(all.items.map((i) => [i.n, i.checked ?? false])).toEqual([[1, false], [2, true], [3, false]]);
  });

  it('asks which list when there are several, and finds one by name', async () => {
    lists.push({ id: 'l2', name: 'Marché' });
    const result = await client.callTool({ name: 'mealie_get_shopping_list', arguments: {} });
    expect(toolText(result)).toBe('Several shopping lists exist: "Courses", "Marché". Say which one.');
    expect(await callJson(client, 'mealie_get_shopping_list', { list: 'courses' })).toMatchObject({ name: 'Courses' });
    const unknown = await client.callTool({ name: 'mealie_get_shopping_list', arguments: { list: 'Marche du dimanche' } });
    expect(toolText(unknown)).toContain('No shopping list is named "Marche du dimanche".');
  });

  it('adds items with resolved foods and units', async () => {
    const result = await callJson<{ added: number; mergedIntoExisting: number }>(client, 'mealie_add_shopping_items', {
      items: [{ quantity: 200, unit: 'g', food: 'Farine' }, { food: 'oeufs' }, { note: 'éponges' }],
    });
    expect(result).toMatchObject({ added: 1, mergedIntoExisting: 1 });
    expect(writes).toEqual([
      {
        method: 'POST',
        path: '/api/households/shopping/items/create-bulk',
        body: [
          { shoppingListId: 'l1', checked: false, quantity: 200, foodId: 'f-farine', unitId: 'u-gramme', note: '' },
          { shoppingListId: 'l1', checked: false, foodId: 'f-œuf', note: '' },
          { shoppingListId: 'l1', checked: false, note: 'éponges' },
        ],
      },
    ]);
  });

  it('refuses an unknown food with close matches and adds nothing', async () => {
    const result = await client.callTool({ name: 'mealie_add_shopping_items', arguments: { items: [{ food: 'farinne' }] } });
    expect(toolText(result)).toContain('Close matches: "farine"');
    expect(writes).toEqual([]);
  });

  it('checks items and changes quantities, sending each item back as read with only those fields changed', async () => {
    await callJson(client, 'mealie_update_shopping_items', { updates: [{ n: 1, checked: true }, { n: 3, quantity: 12 }] });
    const [first, third] = list().listItems!.filter((i) => i.id !== 'i2');
    expect(writes).toEqual([{ method: 'PUT', path: '/api/households/shopping/items', body: [{ ...first, checked: true }, { ...third, quantity: 12 }] }]);
  });

  it('refuses unknown item numbers', async () => {
    const result = await client.callTool({ name: 'mealie_update_shopping_items', arguments: { updates: [{ n: 9, checked: true }] } });
    expect(toolText(result)).toBe('There is no item 9 (the list has 3). Read the list again with mealie_get_shopping_list.');
    expect(writes).toEqual([]);
  });

  it('removes items by number', async () => {
    await callJson(client, 'mealie_remove_shopping_items', { items: [2, 3] });
    expect(writes).toEqual([{ method: 'DELETE', path: '/api/households/shopping/items', query: { ids: ['i2', 'i3'] } }]);
  });

  it('adds a recipe for a number of servings, converted to a scale', async () => {
    expect(await callJson(client, 'mealie_add_recipe_to_shopping_list', { slug: 'quiche-lorraine', servings: 9 })).toMatchObject({ added: 'Quiche lorraine', scale: 1.5 });
    expect(writes).toEqual([{ method: 'POST', path: '/api/households/shopping/lists/l1/recipe', body: [{ recipeId: 'r1', recipeIncrementQuantity: 1.5 }] }]);
  });

  it('refuses both a scale and servings', async () => {
    const result = await client.callTool({ name: 'mealie_add_recipe_to_shopping_list', arguments: { slug: 'quiche-lorraine', scale: 2, servings: 4 } });
    expect(toolText(result)).toBe('Give either scale or servings, not both.');
  });

  it('removes all of a recipe by default', async () => {
    await callJson(client, 'mealie_remove_recipe_from_shopping_list', { slug: 'quiche-lorraine' });
    expect(writes).toEqual([{ method: 'POST', path: '/api/households/shopping/lists/l1/recipe/r1/delete', body: { recipeDecrementQuantity: 1 } }]);
  });

  it('creates a list and refuses a name already taken', async () => {
    expect(await callJson(client, 'mealie_create_shopping_list', { name: 'Marché' })).toEqual({ created: 'Marché' });
    expect(writes).toEqual([{ method: 'POST', path: '/api/households/shopping/lists', body: { name: 'Marché' } }]);
    const taken = await client.callTool({ name: 'mealie_create_shopping_list', arguments: { name: 'COURSES' } });
    expect(toolText(taken)).toBe('A shopping list is already named "Courses".');
    expect(writes).toHaveLength(1);
  });

  it('renames a list, sending it back with all its items', async () => {
    await callJson(client, 'mealie_rename_shopping_list', { name: 'Courses de la semaine' });
    expect(writes).toEqual([{ method: 'PUT', path: '/api/households/shopping/lists/l1', body: { ...list(), name: 'Courses de la semaine' } }]);
  });

  it('keeps the name when renaming to the same name with other accents', async () => {
    await callJson(client, 'mealie_rename_shopping_list', { list: 'Courses', name: 'courses' });
    expect(writes[0]!.body).toMatchObject({ name: 'courses' });
  });

  it('deletes a list named explicitly', async () => {
    expect(await callJson(client, 'mealie_delete_shopping_list', { list: 'courses' })).toEqual({ deleted: 'Courses', items: 3 });
    expect(writes).toEqual([{ method: 'DELETE', path: '/api/households/shopping/lists/l1' }]);
  });

  it('suggests creating a list when there is none', async () => {
    lists.length = 0;
    const result = await client.callTool({ name: 'mealie_get_shopping_list', arguments: {} });
    expect(toolText(result)).toBe('There is no shopping list yet: create one with mealie_create_shopping_list.');
  });
});
