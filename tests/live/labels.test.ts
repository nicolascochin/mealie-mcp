import type { Client } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callJson, connectMcp, startTestApp, toolText, type TestApp } from '../helpers/app.js';
import { liveSeed } from './helpers.js';
import { call } from './seed.js';

const seed = liveSeed();
const LABEL = 'Crèmerie (tests)';
const FOOD = 'yaourt nature (tests)';
const LIST = 'Rayons (tests)';

interface Named {
  id: string;
  name: string;
}

let app: TestApp;
let client: Client;

const all = async (path: string) => (await call<{ items: Named[] }>(seed.mealieUrl, 'GET', `${path}?page=1&perPage=-1`, seed.token)).items;
const removeNamed = async (path: string, name: string) => {
  for (const item of (await all(path)).filter((i) => i.name === name)) {
    await call(seed.mealieUrl, 'DELETE', `${path}/${item.id}`, seed.token).catch(() => undefined);
  }
};

beforeAll(async () => {
  app = await startTestApp({ mealieUrl: seed.mealieUrl });
  client = await connectMcp(app.baseUrl, seed.token);
});
afterAll(async () => {
  await client?.close();
  await app?.close();
  await removeNamed('/api/households/shopping/lists', LIST);
  await removeNamed('/api/foods', FOOD);
  await removeNamed('/api/groups/labels', LABEL);
});

describe('labels against a real Mealie', () => {
  it('refuses an unknown label, then creates the food and its label on request', async () => {
    const refused = await client.callTool({ name: 'mealie_create_food', arguments: { name: FOOD, label: LABEL } });
    expect(toolText(refused)).toContain(`The label "${LABEL}" was not found.`);
    expect(await callJson(client, 'mealie_create_food', { name: FOOD, label: LABEL, createMissing: true })).toEqual({
      created: { name: FOOD, label: LABEL },
    });
    expect((await callJson<{ labels: string[] }>(client, 'mealie_list_labels')).labels).toContain(LABEL);
    expect(await callJson(client, 'mealie_search_foods', { name: FOOD })).toMatchObject({ match: { label: LABEL } });
  });

  it('shows the items of a shopping list under the label of their food', async () => {
    await callJson(client, 'mealie_create_shopping_list', { name: LIST });
    await callJson(client, 'mealie_add_shopping_items', {
      list: LIST,
      items: [
        { quantity: 500, unit: 'gramme', food: 'farine' },
        { quantity: 4, food: FOOD },
      ],
    });
    const { items } = await callJson<{ items: Array<{ food?: string; label?: string }> }>(client, 'mealie_get_shopping_list', { list: LIST });
    // The labelled item comes first, whatever the order it was added in.
    expect(items.map((item) => [item.food, item.label])).toEqual([
      [FOOD, LABEL],
      ['farine', undefined],
    ]);
  });

  it('removes the label of a food', async () => {
    const { updated } = await callJson<{ updated: Record<string, unknown> }>(client, 'mealie_update_food', { food: FOOD, label: null });
    expect(updated).toEqual({ name: FOOD });
    expect(await callJson(client, 'mealie_update_food', { food: FOOD, label: 'cremerie (TESTS)' })).toEqual({ updated: { name: FOOD, label: LABEL } });
  });
});
