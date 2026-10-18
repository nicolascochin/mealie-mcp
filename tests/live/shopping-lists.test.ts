import type { Client } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callJson, connectMcp, startTestApp, toolText, type TestApp } from '../helpers/app.js';
import { liveSeed } from './helpers.js';
import { call } from './seed.js';

const seed = liveSeed();
const NAME = 'Pique-nique (tests)';
const RENAMED = 'Pique-nique du dimanche (tests)';

let app: TestApp;
let client: Client;

beforeAll(async () => {
  app = await startTestApp({ mealieUrl: seed.mealieUrl });
  client = await connectMcp(app.baseUrl, seed.token);
});
afterAll(async () => {
  await client?.close();
  await app?.close();
  // Whatever happened, leave no test list behind.
  const { items } = await call<{ items: Array<{ id: string; name: string }> }>(seed.mealieUrl, 'GET', '/api/households/shopping/lists?page=1&perPage=-1', seed.token);
  for (const list of items.filter((l) => l.name === NAME || l.name === RENAMED)) {
    await call(seed.mealieUrl, 'DELETE', `/api/households/shopping/lists/${list.id}`, seed.token).catch(() => undefined);
  }
});

const lists = async () => (await callJson<{ lists: string[] }>(client, 'mealie_list_shopping_lists')).lists;

describe('shopping list management against a real Mealie', () => {
  it('creates a list, fills it with a recipe, renames it and deletes it', async () => {
    expect(await callJson(client, 'mealie_create_shopping_list', { name: NAME })).toEqual({ created: NAME });
    expect(await lists()).toContain(NAME);

    await callJson(client, 'mealie_add_recipe_to_shopping_list', { list: NAME, slug: seed.recipes['Crêpes'] });
    const before = await callJson<{ items: unknown[] }>(client, 'mealie_get_shopping_list', { list: NAME });
    expect(before.items.length).toBeGreaterThan(0);

    const renamed = await callJson<{ name: string; items: unknown[] }>(client, 'mealie_rename_shopping_list', { list: NAME, name: RENAMED });
    expect(renamed.name).toBe(RENAMED);
    expect(renamed.items).toEqual(before.items);
    expect(await lists()).not.toContain(NAME);

    const deleted = await callJson<{ deleted: string; items: number }>(client, 'mealie_delete_shopping_list', { list: RENAMED });
    expect(deleted).toEqual({ deleted: RENAMED, items: before.items.length });
    expect(await lists()).not.toContain(RENAMED);
  });

  it('refuses a name already taken, whatever the case', async () => {
    await callJson(client, 'mealie_create_shopping_list', { name: NAME });
    const result = await client.callTool({ name: 'mealie_create_shopping_list', arguments: { name: NAME.toUpperCase() } });
    expect(toolText(result)).toBe(`A shopping list is already named "${NAME}".`);
    await callJson(client, 'mealie_delete_shopping_list', { list: NAME });
  });
});
