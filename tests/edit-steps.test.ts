import { describe, expect, it } from 'vitest';
import { ToolError } from '../src/mcp/tools/result.js';
import type { MealieInstruction } from '../src/mealie/types.js';
import { applyStepOperations, type StepOperation } from '../src/recipes/steps.js';
import { quiche } from './helpers/recipes.js';

function edit(operations: StepOperation[]) {
  const recipe = quiche();
  let id = 0;
  const steps = applyStepOperations(recipe.recipeInstructions!, recipe.recipeIngredient!, operations, { newId: () => `new-${++id}` });
  return { recipe, steps, refs: (step: MealieInstruction | undefined) => (step?.ingredientReferences ?? []).map((r) => r.referenceId) };
}

function problemOf(operations: StepOperation[]): string {
  try {
    edit(operations);
  } catch (err) {
    if (err instanceof ToolError) return err.message;
    throw err;
  }
  throw new Error('expected a ToolError');
}

describe('applyStepOperations', () => {
  it('changes the text and keeps the links and every other key', () => {
    const { recipe, steps } = edit([{ op: 'update', n: 2, text: 'Verser l’appareil et cuire 35 minutes.' }]);
    expect(steps[0]).toBe(recipe.recipeInstructions![0]);
    expect(steps[1]).toEqual({ ...recipe.recipeInstructions![1], text: 'Verser l’appareil et cuire 35 minutes.' });
  });

  it('sets and clears a section title', () => {
    expect(edit([{ op: 'update', n: 1, title: 'Pâte' }]).steps[0]!.title).toBe('Pâte');
    expect(edit([{ op: 'update', n: 2, title: null }]).steps[1]!.title).toBe('');
  });

  it('links ingredients by number after the existing links, once', () => {
    const { steps, refs } = edit([{ op: 'update', n: 1, link: [3, 1, 3] }]);
    expect(refs(steps[0])).toEqual(['a', 'b', 'c']);
  });

  it('unlinks ingredients and keeps the others in order', () => {
    const { steps, refs } = edit([{ op: 'update', n: 2, unlink: [4] }]);
    expect(refs(steps[1])).toEqual(['c', 'gone']);
  });

  it('links and unlinks in one update', () => {
    const { steps, refs } = edit([{ op: 'update', n: 1, unlink: [1], link: [4] }]);
    expect(refs(steps[0])).toEqual(['b', 'd']);
  });

  it('replaces all links when ingredients is given', () => {
    const { steps, refs } = edit([{ op: 'update', n: 2, ingredients: [1, 2] }]);
    expect(refs(steps[1])).toEqual(['a', 'b']);
    expect(edit([{ op: 'update', n: 2, ingredients: [] }]).steps[1]!.ingredientReferences).toEqual([]);
  });

  it('adds a step with links, at the end or after a number', () => {
    const { steps, refs } = edit([{ op: 'add', text: 'Servir chaud.', ingredients: [4] }]);
    expect(steps).toHaveLength(3);
    expect(steps[2]).toEqual({ id: 'new-1', title: '', summary: '', text: 'Servir chaud.', ingredientReferences: [{ referenceId: 'd' }] });
    expect(refs(steps[2])).toEqual(['d']);
    expect(edit([{ op: 'add', after: 0, text: 'Préchauffer le four.', title: 'Préparation' }]).steps.map((s) => s.id)).toEqual(['new-1', 's1', 's2']);
  });

  it('moves and deletes steps against the original numbering', () => {
    expect(edit([{ op: 'move', n: 2, after: 0 }]).steps.map((s) => s.id)).toEqual(['s2', 's1']);
    expect(edit([{ op: 'delete', n: 1 }, { op: 'add', after: 1, text: 'Nouvelle étape.' }]).steps.map((s) => s.id)).toEqual(['new-1', 's2']);
  });

  it('reports every problem at once and applies nothing', () => {
    expect(
      problemOf([
        { op: 'update', n: 3, text: 'x' },
        { op: 'update', n: 1 },
        { op: 'update', n: 2, ingredients: [1], link: [2] },
        { op: 'update', n: 1, link: [9] },
        { op: 'add', text: 'x', ingredients: [5] },
        { op: 'move', n: 1, after: 4 },
      ]).split('\n')
    ).toEqual([
      'Operation 1 (update): there is no step 3 (the recipe has 2).',
      'Operation 2 (update): nothing to change.',
      'Operation 3 (update): give either ingredients, or link and unlink, not both.',
      'Operation 4 (update): there is no ingredient 9 (the recipe has 4).',
      'Operation 5 (add): there is no ingredient 5 (the recipe has 4).',
      'Operation 6 (move): cannot move after step 4 (the recipe has 2).',
    ]);
  });

  it('refuses to unlink an ingredient that is not linked', () => {
    expect(problemOf([{ op: 'update', n: 1, unlink: [3] }])).toBe('Operation 1 (update): ingredient 3 is not linked to step 1.');
  });
});
