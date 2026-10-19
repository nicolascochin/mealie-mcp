import * as z from 'zod';
import { listOrganizers, ORGANIZER_LABELS, ORGANIZER_PATHS, organizerVariants, type OrganizerKind } from '../catalog/catalog.js';
import { resolveName } from '../catalog/resolve.js';
import type { MealieClient } from '../mealie/client.js';
import type { MealieOrganizer } from '../mealie/types.js';
import { ToolError } from '../mcp/tools/result.js';

/** Mealie stores durations as a Postgres INTEGER of seconds. */
const MAX_SECONDS = 2 ** 31 - 1;

const time = (what: string) =>
  z
    .object({
      hours: z.number().int().min(0).max(Math.floor(MAX_SECONDS / 3600)).optional(),
      minutes: z.number().int().min(0).max(Math.floor(MAX_SECONDS / 60)).optional().describe('Minutes; 90 means 1 h 30'),
      text: z
        .string()
        .trim()
        .max(100)
        .nullable()
        .optional()
        .describe('Shown after the duration, only for what it cannot say, e.g. "plus 1 night of marinating"; null clears it'),
    })
    .refine((t) => (t.hours ?? 0) * 3600 + (t.minutes ?? 0) * 60 <= MAX_SECONDS, { message: 'Duration too long' })
    .nullable()
    .optional()
    .describe(
      `${what}, as Mealie shows it: a duration in hours and minutes, then an optional text. Hours, minutes or both set the duration (0 and 0 clear it); leave both out to keep it. Leave text out to keep it. null clears the duration and the text`
    );

/** Recipe times as the model names them, with the Mealie keys of their duration and text. */
const TIMES = {
  totalTime: ['totalTimeSeconds', 'totalTime'],
  prepTime: ['prepTimeSeconds', 'prepTime'],
  // Mealie's interface shows performTime as the cooking time; its cookTime is an old field.
  cookTime: ['performTimeSeconds', 'performTime'],
} as const;

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
  totalTime: time('Total time'),
  prepTime: time('Preparation time'),
  cookTime: time('Cooking time'),
  legacyCookTime: z
    .null()
    .optional()
    .describe('null clears the old cooking time that Mealie no longer shows (legacyCookTime of mealie_get_recipe); move it to cookTime first'),
  tags: names('Tags'),
  categories: names('Categories'),
  tools: names('Kitchen tools needed, e.g. "mixeur", "moule à tarte"'),
  notes: z
    .array(z.object({ title: z.string().trim().max(200).optional(), text: z.string().trim().min(1).max(5000) }))
    .max(30)
    .optional()
    .describe('Notes: the complete list, replacing the current one'),
  source: z.string().trim().max(2000).nullable().optional().describe('Source URL; null clears it'),
};

const metadataSchema = z.object(metadataFields);
export type MetadataFields = z.infer<typeof metadataSchema>;

/** Resolves tag, category or tool names to Mealie organizers, creating the missing ones only on request. */
export async function resolveOrganizers(
  mealie: MealieClient,
  kind: OrganizerKind,
  wanted: string[] | undefined,
  createMissing: boolean,
  problems: string[]
): Promise<MealieOrganizer[] | undefined> {
  if (wanted === undefined) return undefined;
  if (wanted.length === 0) return [];
  const label = ORGANIZER_LABELS[kind];
  const existing = await listOrganizers(mealie, kind);
  const resolved: MealieOrganizer[] = [];
  for (const name of wanted) {
    const resolution = resolveName(name, existing, organizerVariants);
    if (resolution.status === 'found') resolved.push(resolution.item);
    else if (resolution.status === 'not_found' && createMissing) {
      const created = await mealie.post<MealieOrganizer>(ORGANIZER_PATHS[kind], { name });
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
 * fields present in `fields` appear in the result. Fails with every unknown tag, category or tool at once.
 */
export async function metadataPatch(mealie: MealieClient, fields: MetadataFields, createMissing: boolean): Promise<Record<string, unknown>> {
  const problems: string[] = [];
  const tags = await resolveOrganizers(mealie, 'tags', fields.tags, createMissing, problems);
  const categories = await resolveOrganizers(mealie, 'categories', fields.categories, createMissing, problems);
  const tools = await resolveOrganizers(mealie, 'tools', fields.tools, createMissing, problems);
  if (problems.length) throw new ToolError(problems.join('\n'));

  const patch: Record<string, unknown> = {};
  const set = (key: string, value: unknown) => {
    if (value !== undefined) patch[key] = value;
  };
  set('description', fields.description === null ? '' : fields.description);
  set('recipeServings', fields.servings === null ? 0 : fields.servings);
  set('recipeYieldQuantity', fields.yieldQuantity === null ? 0 : fields.yieldQuantity);
  set('recipeYield', fields.yield);
  for (const [field, [secondsKey, textKey]] of Object.entries(TIMES)) {
    const value = fields[field as keyof typeof TIMES];
    if (value === undefined) continue;
    const { hours, minutes, text } = value ?? { hours: 0, minutes: 0, text: null };
    // Mealie's interface treats a zero duration as none.
    if (hours !== undefined || minutes !== undefined) set(secondsKey, (hours ?? 0) * 3600 + (minutes ?? 0) * 60 || null);
    set(textKey, text === '' ? null : text);
  }
  set('cookTime', fields.legacyCookTime);
  set('orgURL', fields.source);
  set('notes', fields.notes?.map((note) => ({ title: note.title ?? '', text: note.text })));
  set('tags', tags?.map(({ id, name, slug }) => ({ id, name, slug })));
  set('recipeCategory', categories?.map(({ id, name, slug }) => ({ id, name, slug })));
  set('tools', tools?.map(({ id, name, slug }) => ({ id, name, slug })));
  return patch;
}
