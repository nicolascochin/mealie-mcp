import { randomUUID } from 'node:crypto';
import * as z from 'zod';
import type { MealieIngredient, MealieInstruction } from '../mealie/types.js';
import { applyFields, ingredientFields, newIngredient, type CatalogRefs, type IngredientFields } from './ingredients.js';
import { ListEdit } from './list-edit.js';

const number = z.number().int().min(1).describe('Ingredient number, as mealie_get_recipe shows it');
const after = z
  .number()
  .int()
  .min(0)
  .describe('Put it after this ingredient number, as mealie_get_recipe shows it; 0 = at the start');

export const ingredientOperation = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add'), after: after.optional(), ...ingredientFields }).describe('Add an ingredient (at the end by default)'),
  z.object({ op: z.literal('update'), n: number, ...ingredientFields }).describe('Change only the given fields of an ingredient'),
  z.object({ op: z.literal('move'), n: number, after }).describe('Move an ingredient'),
  z.object({ op: z.literal('delete'), n: number }).describe('Remove an ingredient'),
]);
export type IngredientOperation = z.infer<typeof ingredientOperation>;

/** The food and unit fields of the operations that carry some. */
export function operationFields(operations: IngredientOperation[]): IngredientFields[] {
  return operations.filter((op): op is Extract<IngredientOperation, { op: 'add' | 'update' }> => op.op === 'add' || op.op === 'update');
}

export interface EditResult {
  ingredients: MealieIngredient[];
  /** Set only when steps had to change (links to deleted ingredients removed). */
  instructions?: MealieInstruction[];
}

const hasField = (fields: IngredientFields) => Object.values(fields).some((value) => value !== undefined);

/**
 * Applies the operations to the ingredient list as Mealie returned it (see ListEdit for the
 * numbering rules). Nothing is applied if any operation is invalid.
 */
export function applyIngredientOperations(
  original: MealieIngredient[],
  instructions: MealieInstruction[],
  operations: IngredientOperation[],
  refs: CatalogRefs,
  options: { unlinkSteps?: boolean; newId?: () => string } = {}
): EditResult {
  const edit = new ListEdit(original, 'ingredient');

  operations.forEach((op, i) => {
    const label = `Operation ${i + 1} (${op.op})`;
    switch (op.op) {
      case 'add': {
        const { op: _op, after: position, ...fields } = op;
        if (!fields.food && !fields.note) edit.problems.push(`${label}: give at least a food or a note.`);
        edit.add(label, position, newIngredient(fields, refs, (options.newId ?? randomUUID)()));
        break;
      }
      case 'update': {
        const { op: _op, n, ...fields } = op;
        if (!hasField(fields)) {
          edit.problems.push(`${label}: nothing to change.`);
          edit.check(n, label);
        } else edit.update(label, n, (item) => applyFields(item, fields, refs));
        break;
      }
      case 'move':
        edit.move(label, op.n, op.after);
        break;
      case 'delete':
        edit.delete(label, op.n);
        break;
    }
  });
  edit.validate();

  const deletedRefs = new Map<string, number>();
  for (const n of edit.deleted) {
    const ref = original[n - 1]?.referenceId;
    if (ref) deletedRefs.set(ref, n);
  }
  const linked = (step: MealieInstruction) => (step.ingredientReferences ?? []).some((ref) => ref.referenceId && deletedRefs.has(ref.referenceId));
  if (!options.unlinkSteps) {
    instructions.forEach((step, i) => {
      for (const ref of step.ingredientReferences ?? []) {
        const n = ref.referenceId ? deletedRefs.get(ref.referenceId) : undefined;
        if (n) edit.problems.push(`Ingredient ${n} is used by step ${i + 1}: set unlinkSteps: true to delete it and remove it from its steps.`);
      }
    });
  }
  const ingredients = edit.result();

  if (!instructions.some(linked)) return { ingredients };
  return {
    ingredients,
    instructions: instructions.map((step) =>
      linked(step)
        ? { ...step, ingredientReferences: (step.ingredientReferences ?? []).filter((ref) => !ref.referenceId || !deletedRefs.has(ref.referenceId)) }
        : step
    ),
  };
}
