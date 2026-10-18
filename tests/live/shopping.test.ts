import type { Client } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callJson, connectMcp, startTestApp, toolText, type TestApp } from '../helpers/app.js';
import { liveSeed } from './helpers.js';
import { call } from './seed.js';

const seed = liveSeed();
const LIST = 'Courses (tests)';

interface Item {
  n: number;
  quantity?: number;
  unit?: string;
  food?: string;
  note?: string;
  checked?: boolean;
  recipes?: string[];
}
interface ListView {
  name: string;
  items: Item[];
  recipes?: Array<{ name: string; slug?: string; scale?: number }>;
}

let app: TestApp;
let client: Client;
let listId: string;

beforeAll(async () => {
  // A list of its own, deleted at the end: other lists of the household are left alone.
  listId = (await call<{ id: string }>(seed.mealieUrl, 'POST', '/api/households/shopping/lists', seed.token, { name: LIST })).id;
  app = await startTestApp({ mealieUrl: seed.mealieUrl });
  client = await connectMcp(app.baseUrl, seed.token);
});
afterAll(async () => {
  await client?.close();
  await app?.close();
  if (listId) await call(seed.mealieUrl, 'DELETE', `/api/households/shopping/lists/${listId}`, seed.token).catch(() => undefined);
});

const read = (includeChecked = false) => callJson<ListView>(client, 'mealie_get_shopping_list', { list: LIST, includeChecked });
const byFood = (view: ListView, food: string) => view.items.filter((i) => i.food === food);

describe('shopping lists against a real Mealie', () => {
  it('finds the list by name', async () => {
    expect((await callJson<{ lists: string[] }>(client, 'mealie_list_shopping_lists')).lists).toContain(LIST);
    expect(await read()).toMatchObject({ name: LIST, items: [] });
  });

  it('adds a recipe for 6 servings with items linked to foods and scaled quantities', async () => {
    const result = await callJson<{ scale: number; list: ListView }>(client, 'mealie_add_recipe_to_shopping_list', {
      list: LIST,
      slug: seed.recipes['Crêpes'],
      servings: 6,
    });
    expect(result.scale).toBe(1.5);
    const view = await read();
    expect(byFood(view, 'farine')).toEqual([expect.objectContaining({ quantity: 375, unit: 'gramme', recipes: ['Crêpes'] })]);
    expect(byFood(view, 'œuf')).toEqual([expect.objectContaining({ quantity: 6 })]);
    expect(byFood(view, 'lait')).toEqual([expect.objectContaining({ quantity: 75, unit: 'centilitre' })]);
    expect(view.recipes).toEqual([expect.objectContaining({ name: 'Crêpes', scale: 1.5 })]);
  });

  it('merges a food shared by two recipes into one item', async () => {
    await callJson(client, 'mealie_add_recipe_to_shopping_list', { list: LIST, slug: seed.recipes['Quiche lorraine'] });
    const flour = byFood(await read(), 'farine');
    expect(flour).toHaveLength(1);
    expect(flour[0]).toMatchObject({ quantity: 375 + 250, unit: 'gramme' });
    expect([...flour[0]!.recipes!].sort()).toEqual(['Crêpes', 'Quiche lorraine']);
  });

  it('removes a recipe and keeps what the other one needs', async () => {
    await callJson(client, 'mealie_remove_recipe_from_shopping_list', { list: LIST, slug: seed.recipes['Quiche lorraine'] });
    const view = await read();
    expect(byFood(view, 'farine')).toEqual([expect.objectContaining({ quantity: 375 })]);
    expect(byFood(view, 'lardons')).toEqual([]);
  });

  it('adds items by food name, merged with what is already there', async () => {
    const result = await callJson<{ mergedIntoExisting: number }>(client, 'mealie_add_shopping_items', {
      list: LIST,
      items: [{ quantity: 125, unit: 'g', food: 'Farine' }, { quantity: 1, food: 'oignons' }, { note: 'papier cuisson' }],
    });
    expect(result.mergedIntoExisting).toBeGreaterThanOrEqual(1);
    const view = await read();
    expect(byFood(view, 'farine')).toEqual([expect.objectContaining({ quantity: 500 })]);
    expect(byFood(view, 'oignon')).toEqual([expect.objectContaining({ quantity: 1 })]);
    expect(view.items.find((i) => i.note === 'papier cuisson' && !i.food)).toBeDefined();
  });

  it('refuses an unknown food with close matches', async () => {
    const result = await client.callTool({ name: 'mealie_add_shopping_items', arguments: { list: LIST, items: [{ food: 'farinne' }] } });
    expect(toolText(result)).toContain('Close matches: "farine"');
  });

  it('checks an item and changes a quantity', async () => {
    const before = await read();
    const flour = byFood(before, 'farine')[0]!;
    const onion = byFood(before, 'oignon')[0]!;
    await callJson(client, 'mealie_update_shopping_items', { list: LIST, updates: [{ n: flour.n, checked: true }, { n: onion.n, quantity: 3, note: 'jaunes' }] });
    // Mealie may reorder the list once an item is checked: look items up by food, not by their old number.
    const after = await read(true);
    expect(byFood(after, 'farine')).toEqual([expect.objectContaining({ checked: true, quantity: 500 })]);
    expect(byFood(after, 'oignon')).toEqual([expect.objectContaining({ quantity: 3, note: 'jaunes' })]);
    expect((await read()).items.find((i) => i.food === 'farine')).toBeUndefined();
  });

  it('removes items by number', async () => {
    const before = await read(true);
    const paper = before.items.find((i) => i.note === 'papier cuisson')!;
    await callJson(client, 'mealie_remove_shopping_items', { list: LIST, items: [paper.n] });
    const after = await read(true);
    expect(after.items).toHaveLength(before.items.length - 1);
    expect(after.items.find((i) => i.note === 'papier cuisson')).toBeUndefined();
  });
});
