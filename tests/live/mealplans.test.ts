import type { Client } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { currentWeek, isoDay } from '../../src/mealplans/dates.js';
import { callJson, connectMcp, startTestApp, type TestApp } from '../helpers/app.js';
import { liveSeed } from './helpers.js';
import { call } from './seed.js';

const seed = liveSeed();

interface Entry {
  id: number | string;
  date: string;
  meal: string;
  recipe?: { name: string; slug: string };
  title?: string;
  note?: string;
}

let app: TestApp;
let client: Client;
/** Entries these tests create, removed at the end whatever happens. */
const created = new Set<number | string>();
const week = currentWeek();
const later = isoDay(new Date(Date.parse(`${week.end}T00:00:00Z`) + 30 * 86_400_000));

beforeAll(async () => {
  app = await startTestApp({ mealieUrl: seed.mealieUrl });
  client = await connectMcp(app.baseUrl, seed.token);
});
afterAll(async () => {
  await client?.close();
  await app?.close();
  for (const id of created) await call(seed.mealieUrl, 'DELETE', `/api/households/mealplans/${id}`, seed.token).catch(() => undefined);
});

const add = async (args: Record<string, unknown>) => {
  const entry = await callJson<Entry>(client, 'mealie_add_mealplan_entry', args);
  created.add(entry.id);
  return entry;
};

describe('meal plans against a real Mealie', () => {
  it('places a recipe on a date and a meal, and lists the week', async () => {
    const quiche = await add({ date: week.start, meal: 'dinner', slug: seed.recipes['Quiche lorraine'] });
    expect(quiche).toMatchObject({ date: week.start, meal: 'dinner', recipe: { name: 'Quiche lorraine' } });
    await add({ date: week.start, meal: 'lunch', title: 'Restes', note: 'du dimanche' });
    await add({ date: later, meal: 'lunch', slug: seed.recipes['Crêpes'] });

    const { start, end, meals } = await callJson<{ start: string; end: string; meals: Entry[] }>(client, 'mealie_list_mealplans');
    expect({ start, end }).toEqual(week);
    const ours = meals.filter((m) => created.has(m.id));
    expect(ours.map((m) => [m.date, m.meal, m.recipe?.name ?? m.title])).toEqual([
      [week.start, 'lunch', 'Restes'],
      [week.start, 'dinner', 'Quiche lorraine'],
    ]);
  });

  it('lists another range', async () => {
    const { meals } = await callJson<{ meals: Entry[] }>(client, 'mealie_list_mealplans', { start: later });
    expect(meals.filter((m) => created.has(m.id)).map((m) => m.recipe?.name)).toEqual(['Crêpes']);
  });

  it("lists today's meals", async () => {
    // Mealie's "today" follows its time zone, Europe/Paris in docker-compose.test.yml.
    const parisToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
    const today = await add({ date: parisToday, meal: 'snack', title: 'Goûter' });
    const { meals } = await callJson<{ meals: Entry[] }>(client, 'mealie_get_todays_meals');
    expect(meals.find((m) => m.id === today.id)).toMatchObject({ meal: 'snack', title: 'Goûter' });
  });

  it('moves an entry and changes its recipe', async () => {
    const entry = await add({ date: week.start, meal: 'breakfast', slug: seed.recipes['Crêpes'] });
    const moved = await callJson<Entry>(client, 'mealie_update_mealplan_entry', {
      id: entry.id,
      date: week.end,
      meal: 'dessert',
      slug: seed.recipes["Soupe à l'oignon"],
    });
    expect(moved).toMatchObject({ id: entry.id, date: week.end, meal: 'dessert', recipe: { name: "Soupe à l'oignon" } });
    const { meals } = await callJson<{ meals: Entry[] }>(client, 'mealie_list_mealplans', { start: week.end, end: week.end });
    expect(meals.find((m) => m.id === entry.id)).toMatchObject({ meal: 'dessert', recipe: { name: "Soupe à l'oignon" } });
  });

  it('replaces a recipe by a title, then deletes the entry', async () => {
    const entry = await add({ date: week.start, meal: 'side', slug: seed.recipes['Crêpes'] });
    const updated = await callJson<Entry>(client, 'mealie_update_mealplan_entry', { id: entry.id, slug: null, title: 'Salade verte' });
    expect(updated).toMatchObject({ title: 'Salade verte' });
    expect(updated.recipe).toBeUndefined();
    expect(await callJson(client, 'mealie_delete_mealplan_entry', { id: entry.id })).toMatchObject({ deleted: { id: entry.id } });
    created.delete(entry.id);
    const { meals } = await callJson<{ meals: Entry[] }>(client, 'mealie_list_mealplans');
    expect(meals.find((m) => m.id === entry.id)).toBeUndefined();
  });
});
