import * as z from 'zod';
import { describeResolutionFailure, foodVariants, listFoods, listUnits, unitVariants } from '../catalog/catalog.js';
import { resolveName, type NameVariant } from '../catalog/resolve.js';
import type { MealieClient } from '../mealie/client.js';
import { api } from '../mealie/path.js';
import type { MealieFood, MealieIngredient, MealieUnit } from '../mealie/types.js';
import { ToolError } from '../mcp/tools/result.js';

const text = (max: number) => z.string().trim().max(max);

/**
 * The fields of one ingredient as the model writes them: names, never ids. `null` clears a field;
 * a missing key leaves it as it is. Shared by ingredient editing and recipe creation.
 */
export const ingredientFields = {
  quantity: z.number().min(0).max(100_000).nullable().optional().describe('Amount, e.g. 2 or 0.5; null clears it'),
  unit: text(200).min(1).nullable().optional().describe('Unit name, plural or abbreviation, e.g. "c. à soupe"; null clears it'),
  food: text(200).min(1).nullable().optional().describe('Food name or plural, e.g. "oignons"; null clears it'),
  note: text(500).nullable().optional().describe('Free note, e.g. "émincés"; "" or null clears it'),
  section: text(200).nullable().optional().describe('Section title shown above this ingredient, e.g. "Garniture"; null clears it'),
};

const fieldsSchema = z.object(ingredientFields);
export type IngredientFields = z.infer<typeof fieldsSchema>;

/** Foods and units resolved from the names an edit uses. */
export interface CatalogRefs {
  food(name: string): MealieFood;
  unit(name: string): MealieUnit;
}

async function resolveAll<T extends { name: string }>(
  kind: 'food' | 'unit',
  names: string[],
  load: () => Promise<T[]>,
  variantsOf: (item: T) => NameVariant[],
  create: (name: string) => Promise<T>,
  createMissing: boolean,
  problems: string[]
): Promise<Map<string, T>> {
  const resolved = new Map<string, T>();
  if (names.length === 0) return resolved;
  const items = await load();
  for (const name of names) {
    const resolution = resolveName(name, items, variantsOf);
    if (resolution.status === 'found') resolved.set(name, resolution.item);
    else if (resolution.status === 'not_found' && createMissing) {
      const created = await create(name);
      items.push(created);
      resolved.set(name, created);
    } else problems.push(describeResolutionFailure(kind, name, resolution, !createMissing));
  }
  return resolved;
}

/**
 * Resolves every food and unit name used by the given fields. Unknown names fail with close
 * matches, unless `createMissing` is set; ambiguous names always fail. All problems are reported at once.
 */
export async function resolveCatalogRefs(mealie: MealieClient, fields: IngredientFields[], createMissing: boolean): Promise<CatalogRefs> {
  const unique = (values: Array<string | null | undefined>) => [...new Set(values.filter((v): v is string => !!v))];
  const problems: string[] = [];
  const foods = await resolveAll(
    'food',
    unique(fields.map((f) => f.food)),
    () => listFoods(mealie),
    foodVariants,
    (name) => mealie.post<MealieFood>(api`/api/foods`, { name, aliases: [] }),
    createMissing,
    problems
  );
  const units = await resolveAll(
    'unit',
    unique(fields.map((f) => f.unit)),
    () => listUnits(mealie),
    unitVariants,
    (name) => mealie.post<MealieUnit>(api`/api/units`, { name, abbreviation: '', useAbbreviation: false, fraction: true, aliases: [] }),
    createMissing,
    problems
  );
  if (problems.length) throw new ToolError(problems.join('\n'));
  return {
    food: (name) => foods.get(name)!,
    unit: (name) => units.get(name)!,
  };
}

/**
 * Returns a copy of `base` with the given fields changed and every other key kept as Mealie sent
 * it. `display` is dropped so that Mealie recomputes it. When a free-text ingredient gets a food,
 * its text is kept in `originalText`.
 */
export function applyFields(base: MealieIngredient, fields: IngredientFields, refs: CatalogRefs): MealieIngredient {
  const { display: _display, ...next }: MealieIngredient = { ...base };
  if (fields.quantity !== undefined) next.quantity = fields.quantity ?? 0;
  if (fields.unit !== undefined) next.unit = fields.unit === null ? null : refs.unit(fields.unit);
  if (fields.food !== undefined) next.food = fields.food === null ? null : refs.food(fields.food);
  if (fields.note !== undefined) next.note = fields.note ?? '';
  if (fields.section !== undefined) next.title = fields.section || null;
  if (!base.food && !base.referencedRecipe && next.food && !base.originalText) {
    next.originalText = base.note || base.display || null;
  }
  return next;
}

/** A new ingredient with a fresh referenceId. */
export function newIngredient(fields: IngredientFields, refs: CatalogRefs, referenceId: string): MealieIngredient {
  return applyFields({ referenceId, quantity: 0, unit: null, food: null, note: '', title: null, originalText: null }, fields, refs);
}
