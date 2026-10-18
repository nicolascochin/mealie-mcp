import * as z from 'zod';
import { listOrganizers, organizerVariants, type OrganizerKind } from '../catalog/catalog.js';
import { resolveName } from '../catalog/resolve.js';
import type { MealieClient } from '../mealie/client.js';
import { api } from '../mealie/path.js';
import type { MealieOrganizer } from '../mealie/types.js';
import { ToolError } from '../mcp/tools/result.js';

const time = (what: string) => z.string().trim().max(100).nullable().optional().describe(`${what}, e.g. "45 min"; null clears it`);
const names = (what: string) =>
  z.array(z.string().trim().min(1).max(200)).max(30).optional().describe(`${what} by name: the complete list, replacing the current one`);

/**
 * Recipe fields other than name, ingredients and steps, as the model writes them. A missing key
 * leaves the field as it is; `null` clears it. Shared by recipe creation and update.
 */
export const metadataFields = {
  description: z.string().trim().max(5000).nullable().optional().describe('Short description; null clears it'),
  servings: z.number().min(0).max(1000).nullable().optional().describe('Number of servings; null clears it'),
  yieldQuantity: z.number().min(0).max(100_000).nullable().optional().describe('Yield amount, e.g. 12; null clears it'),
  yield: z.string().trim().max(200).nullable().optional().describe('Yield unit or text, e.g. "crêpes"; null clears it'),
  prepTime: time('Preparation time'),
  cookTime: time('Cooking time'),
  performTime: time('Resting or other time'),
  totalTime: time('Total time'),
  tags: names('Tags'),
  categories: names('Categories'),
  notes: z
    .array(z.object({ title: z.string().trim().max(200).optional(), text: z.string().trim().min(1).max(5000) }))
    .max(30)
    .optional()
    .describe('Notes: the complete list, replacing the current one'),
  source: z.string().trim().max(2000).nullable().optional().describe('Source URL; null clears it'),
};

const metadataSchema = z.object(metadataFields);
export type MetadataFields = z.infer<typeof metadataSchema>;

/** Resolves tag or category names to Mealie organizers, creating the missing ones only on request. */
async function resolveOrganizers(
  mealie: MealieClient,
  kind: OrganizerKind,
  wanted: string[] | undefined,
  createMissing: boolean,
  problems: string[]
): Promise<MealieOrganizer[] | undefined> {
  if (wanted === undefined) return undefined;
  if (wanted.length === 0) return [];
  const label = kind === 'tags' ? 'tag' : 'category';
  const existing = await listOrganizers(mealie, kind);
  const resolved: MealieOrganizer[] = [];
  for (const name of wanted) {
    const resolution = resolveName(name, existing, organizerVariants);
    if (resolution.status === 'found') resolved.push(resolution.item);
    else if (resolution.status === 'not_found' && createMissing) {
      const path = kind === 'tags' ? api`/api/organizers/tags` : api`/api/organizers/categories`;
      const created = await mealie.post<MealieOrganizer>(path, { name });
      existing.push(created);
      resolved.push(created);
    } else {
      const options = resolution.status === 'ambiguous' ? resolution.candidates : resolution.suggestions;
      const close = options.length ? ` Close matches: ${options.map((o) => `"${o.name}"`).join(', ')}.` : '';
      const problem = resolution.status === 'ambiguous' ? 'is ambiguous' : 'was not found';
      problems.push(`The ${label} "${name}" ${problem}.${close} Set createMissing: true to create it, or see mealie_list_${kind}.`);
    }
  }
  // The same organizer named twice is sent once.
  return resolved.filter((o, i) => resolved.findIndex((other) => other.id === o.id) === i);
}

/**
 * Turns the given fields into the matching keys of a Mealie recipe, ready for PATCH. Only the
 * fields present in `fields` appear in the result. Fails with every unknown tag or category at once.
 */
export async function metadataPatch(mealie: MealieClient, fields: MetadataFields, createMissing: boolean): Promise<Record<string, unknown>> {
  const problems: string[] = [];
  const tags = await resolveOrganizers(mealie, 'tags', fields.tags, createMissing, problems);
  const categories = await resolveOrganizers(mealie, 'categories', fields.categories, createMissing, problems);
  if (problems.length) throw new ToolError(problems.join('\n'));

  const patch: Record<string, unknown> = {};
  const set = (key: string, value: unknown) => {
    if (value !== undefined) patch[key] = value;
  };
  set('description', fields.description === null ? '' : fields.description);
  set('recipeServings', fields.servings === null ? 0 : fields.servings);
  set('recipeYieldQuantity', fields.yieldQuantity === null ? 0 : fields.yieldQuantity);
  set('recipeYield', fields.yield);
  set('prepTime', fields.prepTime);
  set('cookTime', fields.cookTime);
  set('performTime', fields.performTime);
  set('totalTime', fields.totalTime);
  set('orgURL', fields.source);
  set('notes', fields.notes?.map((note) => ({ title: note.title ?? '', text: note.text })));
  set('tags', tags?.map(({ id, name, slug }) => ({ id, name, slug })));
  set('recipeCategory', categories?.map(({ id, name, slug }) => ({ id, name, slug })));
  return patch;
}
