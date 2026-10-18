import { describe, expect, it } from 'vitest';
import { ToolError } from '../src/mcp/tools/result.js';
import type { MealieFood, MealieIngredient, MealieUnit } from '../src/mealie/types.js';
import { applyIngredientOperations, type IngredientOperation } from '../src/recipes/edit.js';
import type { CatalogRefs } from '../src/recipes/ingredients.js';
import { quiche } from './helpers/recipes.js';

const refs: CatalogRefs = {
  food: (name) => ({ id: `f-${name}`, name }) as MealieFood,
  unit: (name) => ({ id: `u-${name}`, name }) as MealieUnit,
};

function edit(operations: IngredientOperation[], unlinkSteps = false) {
  const recipe = quiche();
  let id = 0;
  const result = applyIngredientOperations(recipe.recipeIngredient!, recipe.recipeInstructions!, operations, refs, {
    unlinkSteps,
    newId: () => `new-${++id}`,
  });
  return { recipe, result, order: result.ingredients.map((i) => i.referenceId) };
}

function problemOf(operations: IngredientOperation[], unlinkSteps = false): string {
  try {
    edit(operations, unlinkSteps);
  } catch (err) {
    if (err instanceof ToolError) return err.message;
    throw err;
  }
  throw new Error('expected a ToolError');
}

describe('applyIngredientOperations', () => {
  it('changes only the given fields and returns every other ingredient as the same object', () => {
    const { recipe, result } = edit([{ op: 'update', n: 3, quantity: 4 }]);
    const before = recipe.recipeIngredient!;
    expect(result.ingredients[0]).toBe(before[0]);
    expect(result.ingredients[1]).toBe(before[1]);
    expect(result.ingredients[3]).toBe(before[3]);
    const { display: _display, ...rest } = before[2]!;
    expect(result.ingredients[2]).toEqual({ ...rest, quantity: 4 });
    expect(result.instructions).toBeUndefined();
  });

  it('drops display on changed ingredients so that Mealie recomputes it', () => {
    expect(edit([{ op: 'update', n: 1, note: 'tamisée' }]).result.ingredients[0]).not.toHaveProperty('display');
  });

  it('sets and clears unit, food, note and section', () => {
    const { result } = edit([
      { op: 'update', n: 1, unit: 'kilogramme', food: 'farine de blé', note: 'T55' },
      { op: 'update', n: 3, unit: null, food: null, note: null, section: null, quantity: null },
    ]);
    expect(result.ingredients[0]).toMatchObject({ unit: { name: 'kilogramme' }, food: { name: 'farine de blé' }, note: 'T55', title: 'Pâte' });
    expect(result.ingredients[2]).toMatchObject({ unit: null, food: null, note: '', title: null, quantity: 0, referenceId: 'c' });
  });

  it('structures a free-text ingredient and keeps its original text', () => {
    const freeText: MealieIngredient = { referenceId: 'x', quantity: 0, unit: null, food: null, note: '2 oignons émincés', display: '2 oignons émincés', originalText: null };
    const { ingredients } = applyIngredientOperations([freeText], [], [{ op: 'update', n: 1, quantity: 2, food: 'oignon', note: 'émincés' }], refs);
    expect(ingredients[0]).toEqual({ referenceId: 'x', quantity: 2, unit: null, food: { id: 'f-oignon', name: 'oignon' }, note: 'émincés', originalText: '2 oignons émincés' });
  });

  it('keeps an existing original text', () => {
    const { result } = edit([{ op: 'update', n: 4, food: 'sel' }]);
    expect(result.ingredients[3]).toMatchObject({ originalText: 'sel, poivre', food: { name: 'sel' } });
  });

  it('adds at the end by default, or after a given number, with a fresh referenceId', () => {
    expect(edit([{ op: 'add', food: 'lardons', quantity: 200, unit: 'gramme' }]).order).toEqual(['a', 'b', 'c', 'd', 'new-1']);
    expect(edit([{ op: 'add', after: 0, note: 'pour 6' }]).order).toEqual(['new-1', 'a', 'b', 'c', 'd']);
    const { result, order } = edit([{ op: 'add', after: 2, food: 'lait', section: 'Appareil' }]);
    expect(order).toEqual(['a', 'b', 'new-1', 'c', 'd']);
    expect(result.ingredients[2]).toEqual({ referenceId: 'new-1', quantity: 0, unit: null, food: { id: 'f-lait', name: 'lait' }, note: '', title: 'Appareil', originalText: null });
  });

  it('reads every number against the original list, whatever the other operations do', () => {
    const { order } = edit(
      [
        { op: 'delete', n: 2 },
        { op: 'move', n: 4, after: 0 },
        { op: 'add', after: 3, food: 'lait' },
        { op: 'update', n: 3, quantity: 5 },
      ],
      true
    );
    expect(order).toEqual(['d', 'a', 'c', 'new-1']);
  });

  it('keeps operation order among entries placed at the same position', () => {
    expect(edit([{ op: 'add', after: 1, food: 'lait' }, { op: 'move', n: 4, after: 1 }, { op: 'add', after: 1, food: 'sucre' }]).order).toEqual([
      'a',
      'new-1',
      'd',
      'new-2',
      'b',
      'c',
    ]);
  });

  it('moves an updated ingredient with its changes', () => {
    const { result } = edit([{ op: 'update', n: 1, quantity: 300 }, { op: 'move', n: 1, after: 4 }]);
    expect(result.ingredients.map((i) => [i.referenceId, i.quantity])).toEqual([['b', 1], ['c', 3], ['d', 0], ['a', 300]]);
  });

  it('refuses to delete an ingredient used by a step', () => {
    expect(problemOf([{ op: 'delete', n: 2 }])).toBe('Ingredient 2 is used by step 1: set unlinkSteps: true to delete it and remove it from its steps.');
  });

  it('unlinks deleted ingredients from their steps and leaves other steps untouched', () => {
    const { recipe, result } = edit([{ op: 'delete', n: 2 }], true);
    expect(result.instructions![0]!.ingredientReferences).toEqual([{ referenceId: 'a' }]);
    expect(result.instructions![1]).toBe(recipe.recipeInstructions![1]);
  });

  it('deletes an unlinked ingredient without touching the steps', () => {
    const recipe = quiche();
    recipe.recipeInstructions = [];
    const result = applyIngredientOperations(recipe.recipeIngredient!, [], [{ op: 'delete', n: 1 }], refs);
    expect(result.ingredients.map((i) => i.referenceId)).toEqual(['b', 'c', 'd']);
    expect(result.instructions).toBeUndefined();
  });

  it('reports every invalid operation at once and applies nothing', () => {
    expect(
      problemOf([
        { op: 'update', n: 9, quantity: 1 },
        { op: 'update', n: 1 },
        { op: 'add', after: 7, food: 'lait' },
        { op: 'add', quantity: 2 },
        { op: 'delete', n: 3 },
        { op: 'move', n: 3, after: 0 },
      ]).split('\n')
    ).toEqual([
      'Operation 1 (update): there is no ingredient 9 (the recipe has 4).',
      'Operation 2 (update): nothing to change.',
      'Operation 3 (add): cannot add after ingredient 7 (the recipe has 4).',
      'Operation 4 (add): give at least a food or a note.',
      'Ingredient 3 is deleted and also updated or moved.',
      'Ingredient 3 is used by step 2: set unlinkSteps: true to delete it and remove it from its steps.',
    ]);
  });

  it('refuses to update the same ingredient twice', () => {
    expect(problemOf([{ op: 'update', n: 1, quantity: 1 }, { op: 'update', n: 1, note: 'x' }])).toContain('updated twice');
  });
});
