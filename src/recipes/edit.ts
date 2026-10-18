import { randomUUID } from 'node:crypto';
import * as z from 'zod';
import type { MealieIngredient, MealieInstruction } from '../mealie/types.js';
import { ToolError } from '../mcp/tools/result.js';
import { applyFields, ingredientFields, newIngredient, type CatalogRefs, type IngredientFields } from './ingredients.js';

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
 * Applies the operations to the ingredient list as Mealie returned it. Every number refers to
 * that original list, whatever the other operations do. Untouched ingredients are returned as the
 * very same objects. Nothing is applied if any operation is invalid.
 */
export function applyIngredientOperations(
  original: MealieIngredient[],
  instructions: MealieInstruction[],
  operations: IngredientOperation[],
  refs: CatalogRefs,
  options: { unlinkSteps?: boolean; newId?: () => string } = {}
): EditResult {
  const count = original.length;
  const problems: string[] = [];
  const checkNumber = (n: number, what: string) => {
    if (n > count) problems.push(`${what}: there is no ingredient ${n} (the recipe has ${count}).`);
    return n <= count;
  };

  const items = [...original];
  const updated = new Set<number>();
  const moved = new Set<number>();
  const deleted = new Set<number>();
  /** What goes after each original position (0 = start), in operation order. */
  const anchored = new Map<number, Array<MealieIngredient | number>>();
  const anchor = (position: number, entry: MealieIngredient | number) => anchored.set(position, [...(anchored.get(position) ?? []), entry]);

  operations.forEach((op, i) => {
    const label = `Operation ${i + 1} (${op.op})`;
    switch (op.op) {
      case 'add': {
        const { op: _op, after: position = count, ...fields } = op;
        if (!fields.food && !fields.note) problems.push(`${label}: give at least a food or a note.`);
        if (position > count) problems.push(`${label}: cannot add after ingredient ${position} (the recipe has ${count}).`);
        else anchor(position, newIngredient(fields, refs, (options.newId ?? randomUUID)()));
        break;
      }
      case 'update': {
        const { op: _op, n, ...fields } = op;
        if (!hasField(fields)) problems.push(`${label}: nothing to change.`);
        if (updated.has(n)) problems.push(`${label}: ingredient ${n} is updated twice; merge the changes.`);
        if (checkNumber(n, label) && hasField(fields)) items[n - 1] = applyFields(original[n - 1]!, fields, refs);
        updated.add(n);
        break;
      }
      case 'move':
        if (moved.has(op.n)) problems.push(`${label}: ingredient ${op.n} is moved twice.`);
        if (op.after > count) problems.push(`${label}: cannot move after ingredient ${op.after} (the recipe has ${count}).`);
        if (checkNumber(op.n, label) && op.after <= count) anchor(op.after, op.n);
        moved.add(op.n);
        break;
      case 'delete':
        checkNumber(op.n, label);
        deleted.add(op.n);
        break;
    }
  });
  for (const n of deleted) {
    if (updated.has(n) || moved.has(n)) problems.push(`Ingredient ${n} is deleted and also updated or moved.`);
  }

  const deletedRefs = new Map<string, number>();
  for (const n of deleted) {
    const ref = original[n - 1]?.referenceId;
    if (ref) deletedRefs.set(ref, n);
  }
  const linked = (step: MealieInstruction) => (step.ingredientReferences ?? []).some((ref) => ref.referenceId && deletedRefs.has(ref.referenceId));
  if (!options.unlinkSteps) {
    instructions.forEach((step, i) => {
      for (const ref of step.ingredientReferences ?? []) {
        const n = ref.referenceId ? deletedRefs.get(ref.referenceId) : undefined;
        if (n) problems.push(`Ingredient ${n} is used by step ${i + 1}: set unlinkSteps: true to delete it and remove it from its steps.`);
      }
    });
  }
  if (problems.length) throw new ToolError(problems.join('\n'));

  const resolve = (entry: MealieIngredient | number) => (typeof entry === 'number' ? items[entry - 1]! : entry);
  const ingredients = [...(anchored.get(0) ?? []).map(resolve)];
  for (let n = 1; n <= count; n++) {
    if (!deleted.has(n) && !moved.has(n)) ingredients.push(items[n - 1]!);
    ingredients.push(...(anchored.get(n) ?? []).map(resolve));
  }

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
