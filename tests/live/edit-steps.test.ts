import type { Client } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { callJson, connectMcp, startTestApp, toolText, type TestApp } from '../helpers/app.js';
import type { RecipeFixture } from './fixtures.js';
import { liveSeed, readRawRecipe } from './helpers.js';
import { call, createFixtureRecipe } from './seed.js';

const seed = liveSeed();

/** A recipe of its own: these tests change it, and delete it at the end. */
const GRATIN: RecipeFixture = {
  name: 'Gratin (édition des étapes)',
  ingredients: [
    { quantity: 1, unit: 'litre', food: 'lait' },
    { quantity: 50, unit: 'gramme', food: 'beurre' },
    { quantity: 3, food: 'œuf' },
    { quantity: 100, unit: 'gramme', food: 'farine' },
  ],
  steps: [
    { text: 'Faire chauffer le lait.', ingredients: [0] },
    { text: 'Faire un roux.', ingredients: [1, 3] },
    { text: 'Ajouter les œufs et cuire.', ingredients: [2] },
  ],
};

type Raw = Record<string, unknown>;
type RawStep = Raw & { title?: string; text: string; ingredientReferences: Array<{ referenceId: string }> };
const stepsOf = async () => (await readRawRecipe(slug)).recipeInstructions as RawStep[];
const ingredientIds = async () => ((await readRawRecipe(slug)).recipeIngredient as Array<{ referenceId: string }>).map((i) => i.referenceId);
/** Mealie gives steps a new id on each write: compare them without it. */
const withoutId = ({ id: _id, ...step }: RawStep) => step;

let app: TestApp;
let client: Client;
let slug: string;
let before: RawStep[];
let ids: string[];

beforeAll(async () => {
  slug = await createFixtureRecipe(seed.mealieUrl, seed.token, GRATIN);
  app = await startTestApp({ mealieUrl: seed.mealieUrl });
  client = await connectMcp(app.baseUrl, seed.token);
});
afterAll(async () => {
  await client?.close();
  await app?.close();
  if (slug) await call(seed.mealieUrl, 'DELETE', `/api/recipes/${encodeURIComponent(slug)}`, seed.token);
});
beforeEach(async () => {
  before = await stepsOf();
  ids = await ingredientIds();
});

const edit = (operations: unknown[]) => callJson<{ steps: Array<{ n: number; text: string; ingredients?: number[] }> }>(client, 'mealie_edit_steps', { slug, operations });

describe('mealie_edit_steps against a real Mealie', () => {
  it('changes a step text and keeps all its links', async () => {
    await edit([{ op: 'update', n: 2, text: 'Faire un roux blond.' }]);
    const after = await stepsOf();
    expect(withoutId(after[1]!)).toEqual({ ...withoutId(before[1]!), text: 'Faire un roux blond.' });
    expect(after[1]!.ingredientReferences.map((r) => r.referenceId)).toEqual([ids[1], ids[3]]);
    expect(after.map(withoutId)[0]).toEqual(withoutId(before[0]!));
    expect(after.map(withoutId)[2]).toEqual(withoutId(before[2]!));
  });

  it('links an ingredient so that Mealie stores it', async () => {
    const result = await edit([{ op: 'update', n: 1, link: [2] }]);
    expect(result.steps[0]).toMatchObject({ n: 1, ingredients: [1, 2] });
    expect((await stepsOf())[0]!.ingredientReferences.map((r) => r.referenceId)).toEqual([ids[0], ids[1]]);
  });

  it('unlinks and replaces links', async () => {
    await edit([
      { op: 'update', n: 1, unlink: [2] },
      { op: 'update', n: 3, ingredients: [3, 1] },
    ]);
    const after = await stepsOf();
    expect(after[0]!.ingredientReferences.map((r) => r.referenceId)).toEqual([ids[0]]);
    expect(after[2]!.ingredientReferences.map((r) => r.referenceId)).toEqual([ids[2], ids[0]]);
  });

  it('adds, moves and deletes steps against the numbering as read', async () => {
    const result = await edit([
      { op: 'add', after: 0, text: 'Préchauffer le four à 200 °C.', title: 'Préparation' },
      { op: 'move', n: 3, after: 1 },
      { op: 'delete', n: 2 },
    ]);
    expect(result.steps.map((s) => s.text)).toEqual(['Préchauffer le four à 200 °C.', before[0]!.text, before[2]!.text]);
    const after = await stepsOf();
    expect(after[0]).toMatchObject({ title: 'Préparation', ingredientReferences: [] });
    expect(withoutId(after[1]!)).toEqual(withoutId(before[0]!));
    expect(withoutId(after[2]!)).toEqual(withoutId(before[2]!));
  });

  it('leaves the ingredients untouched', async () => {
    const raw = await readRawRecipe(slug);
    await edit([{ op: 'update', n: 1, text: 'Préchauffer le four.' }]);
    expect((await readRawRecipe(slug)).recipeIngredient).toEqual(raw.recipeIngredient);
  });

  it('refuses an unknown ingredient number and writes nothing', async () => {
    const result = await client.callTool({ name: 'mealie_edit_steps', arguments: { slug, operations: [{ op: 'update', n: 1, link: [9] }] } });
    expect(toolText(result)).toBe('Operation 1 (update): there is no ingredient 9 (the recipe has 4).');
    expect(await stepsOf()).toEqual(before);
  });
});
