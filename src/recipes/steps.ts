import { randomUUID } from 'node:crypto';
import * as z from 'zod';
import type { MealieIngredient, MealieInstruction } from '../mealie/types.js';
import { ListEdit } from './list-edit.js';

const stepNumber = z.number().int().min(1).describe('Step number, as mealie_get_recipe shows it');
const after = z.number().int().min(0).describe('Put it after this step number, as mealie_get_recipe shows it; 0 = at the start');
const ingredientNumbers = (what: string) =>
  z.array(z.number().int().min(1)).max(100).optional().describe(`${what} (ingredient numbers, as mealie_get_recipe shows them)`);
const text = z.string().trim().min(1).max(10_000);
const title = z.string().trim().max(200).nullable().optional().describe('Section title shown above this step; null clears it');

export const stepOperation = z.discriminatedUnion('op', [
  z
    .object({ op: z.literal('add'), after: after.optional(), text: text.describe('Step text'), title, ingredients: ingredientNumbers('Ingredients used') })
    .describe('Add a step (at the end by default)'),
  z
    .object({
      op: z.literal('update'),
      n: stepNumber,
      text: text.optional().describe('New text'),
      title,
      link: ingredientNumbers('Ingredients to link, kept after the existing links'),
      unlink: ingredientNumbers('Ingredients to unlink'),
      ingredients: ingredientNumbers('Replace all links with exactly these ingredients ([] removes them all)'),
    })
    .describe('Change a step; its links are kept unless link, unlink or ingredients is given'),
  z.object({ op: z.literal('move'), n: stepNumber, after }).describe('Move a step'),
  z.object({ op: z.literal('delete'), n: stepNumber }).describe('Remove a step'),
]);
export type StepOperation = z.infer<typeof stepOperation>;

type Reference = NonNullable<MealieInstruction['ingredientReferences']>[number];

/**
 * Applies the operations to the steps as Mealie returned them (see ListEdit for the numbering
 * rules). Ingredients are named by number and linked by their referenceId. A changed step keeps
 * every other key as Mealie sent it, its links included unless the operation changes them.
 */
export function applyStepOperations(
  original: MealieInstruction[],
  ingredients: MealieIngredient[],
  operations: StepOperation[],
  options: { newId?: () => string } = {}
): MealieInstruction[] {
  const edit = new ListEdit(original, 'step');

  /** referenceIds of the given ingredient numbers; reports unknown numbers. */
  const references = (label: string, numbers: number[]): Reference[] =>
    numbers.flatMap((n) => {
      const referenceId = ingredients[n - 1]?.referenceId;
      if (!referenceId) {
        edit.problems.push(`${label}: there is no ingredient ${n} (the recipe has ${ingredients.length}).`);
        return [];
      }
      return [{ referenceId }];
    });
  const numberOf = (referenceId: string | null | undefined) => ingredients.findIndex((i) => i.referenceId === referenceId) + 1;

  operations.forEach((op, i) => {
    const label = `Operation ${i + 1} (${op.op})`;
    switch (op.op) {
      case 'add':
        edit.add(label, op.after, {
          id: (options.newId ?? randomUUID)(),
          title: op.title || '',
          summary: '',
          text: op.text,
          ingredientReferences: references(label, dedupe(op.ingredients ?? [])),
        });
        break;
      case 'update': {
        const { op: _op, n, text: newText, title: newTitle, link, unlink, ingredients: replace } = op;
        if ([newText, newTitle, link, unlink, replace].every((value) => value === undefined)) {
          edit.problems.push(`${label}: nothing to change.`);
          edit.check(n, label);
          break;
        }
        if (replace !== undefined && (link !== undefined || unlink !== undefined)) {
          edit.problems.push(`${label}: give either ingredients, or link and unlink, not both.`);
        }
        const toLink = references(label, link ?? []);
        const toUnlink = references(label, unlink ?? []);
        const replacement = replace === undefined ? undefined : references(label, dedupe(replace));
        edit.update(label, n, (step) => {
          const next: MealieInstruction = { ...step };
          if (newText !== undefined) next.text = newText;
          if (newTitle !== undefined) next.title = newTitle || '';
          if (replacement) next.ingredientReferences = replacement;
          else if (toLink.length || toUnlink.length) {
            const current = step.ingredientReferences ?? [];
            const linked = new Set(current.map((ref) => ref.referenceId));
            for (const ref of toUnlink) {
              if (!linked.has(ref.referenceId)) edit.problems.push(`${label}: ingredient ${numberOf(ref.referenceId)} is not linked to step ${n}.`);
            }
            const removed = new Set(toUnlink.map((ref) => ref.referenceId));
            next.ingredientReferences = [
              ...current.filter((ref) => !removed.has(ref.referenceId)),
              ...dedupeRefs(toLink).filter((ref) => !linked.has(ref.referenceId)),
            ];
          }
          return next;
        });
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
  return edit.result();
}

const dedupe = (numbers: number[]) => [...new Set(numbers)];
const dedupeRefs = (refs: Reference[]) => refs.filter((ref, i) => refs.findIndex((other) => other.referenceId === ref.referenceId) === i);
