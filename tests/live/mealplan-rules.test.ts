import type { Client } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callJson, connectMcp, startTestApp, toolText, type TestApp } from '../helpers/app.js';
import type { RecipeFixture } from './fixtures.js';
import { liveSeed } from './helpers.js';
import { call, createFixtureRecipe } from './seed.js';

const seed = liveSeed();

const DRAWN = 'Tirage au sort (tests)';
const NEVER = 'Jamais servi (tests)';
const RISOTTO: RecipeFixture = {
  name: 'Risotto du mardi (tirage)',
  tags: [DRAWN],
  ingredients: [{ quantity: 1, unit: 'litre', food: 'bouillon de bœuf' }],
  steps: [{ text: 'Mouiller le riz petit à petit.', ingredients: [0] }],
};
// 2030-01-01 is a Tuesday, 2030-01-02 a Wednesday: far from the meals other tests plan.
const TUESDAY = '2030-01-01';
const WEDNESDAY = '2030-01-02';

interface Entity {
  id: string;
  name?: string;
}

let app: TestApp;
let client: Client;
let slug: string;
const tags: Entity[] = [];
const rules: Entity[] = [];
const entries: Array<number | string> = [];

const post = <T>(path: string, body: unknown) => call<T>(seed.mealieUrl, 'POST', path, seed.token, body);
const remove = (path: string) => call(seed.mealieUrl, 'DELETE', path, seed.token).catch(() => undefined);

beforeAll(async () => {
  for (const name of [DRAWN, NEVER]) tags.push(await post<Entity>('/api/organizers/tags', { name }));
  slug = await createFixtureRecipe(seed.mealieUrl, seed.token, RISOTTO);
  const [drawn, never] = tags;
  rules.push(
    await post<Entity>('/api/households/mealplans/rules', { day: 'tuesday', entryType: 'dinner', queryFilterString: `tags.id IN ["${drawn!.id}"]` }),
    await post<Entity>('/api/households/mealplans/rules', { day: 'wednesday', entryType: 'lunch', queryFilterString: `tags.id IN ["${never!.id}"]` })
  );
  app = await startTestApp({ mealieUrl: seed.mealieUrl });
  client = await connectMcp(app.baseUrl, seed.token);
});
afterAll(async () => {
  await client?.close();
  await app?.close();
  for (const id of entries) await remove(`/api/households/mealplans/${id}`);
  for (const rule of rules) await remove(`/api/households/mealplans/rules/${rule.id}`);
  if (slug) await remove(`/api/recipes/${encodeURIComponent(slug)}`);
  for (const tag of tags) await remove(`/api/organizers/tags/${tag.id}`);
});

describe('random meals and meal plan rules against a real Mealie', () => {
  it('lists the rules with tag names', async () => {
    const { rules: listed } = await callJson<{ rules: unknown[] }>(client, 'mealie_list_mealplan_rules');
    expect(listed).toEqual(
      expect.arrayContaining([
        { day: 'tuesday', meal: 'dinner', recipes: `tags IN ["${DRAWN}"]` },
        { day: 'wednesday', meal: 'lunch', recipes: `tags IN ["${NEVER}"]` },
      ])
    );
  });

  it('plans a random dinner that follows the rule, and it shows in the plan', async () => {
    const planned = await callJson<{ id: number | string; recipe?: { slug: string } }>(client, 'mealie_plan_random_meal', { date: TUESDAY, meal: 'dinner' });
    entries.push(planned.id);
    expect(planned).toMatchObject({ date: TUESDAY, meal: 'dinner', recipe: { slug } });
    const { meals } = await callJson<{ meals: unknown[] }>(client, 'mealie_list_mealplans', { start: TUESDAY, end: TUESDAY });
    expect(meals).toEqual([expect.objectContaining({ id: planned.id, recipe: expect.objectContaining({ slug }) })]);
  });

  it('explains when no recipe passes the rules', async () => {
    const result = await client.callTool({ name: 'mealie_plan_random_meal', arguments: { date: WEDNESDAY, meal: 'lunch' } });
    expect(result.isError).toBe(true);
    expect(toolText(result)).toContain(`No recipe matches the meal plan rules for lunch on ${WEDNESDAY}.`);
  });
});
