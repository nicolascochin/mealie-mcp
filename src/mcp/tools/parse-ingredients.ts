import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { MealieError } from '../../mealie/errors.js';
import { api } from '../../mealie/path.js';
import type { MealieParsedIngredient, MealieRecipe } from '../../mealie/types.js';
import { isFreeText } from '../../recipes/view.js';
import type { ToolDeps } from '../server.js';
import { runTool, ToolError } from './result.js';

const PARSERS = ['nlp', 'brute', 'openai'] as const;
/** Below this average confidence, a proposal deserves a look before it is applied. */
const LOW_CONFIDENCE = 0.5;

export function registerParseIngredients(server: McpServer, { mealie, logger }: ToolDeps): void {
  server.registerTool(
    'mealie_parse_ingredients',
    {
      title: 'Parse free-text ingredients',
      description: [
        "Run Mealie's ingredient parser on the free-text ingredients of a recipe (all of them by default) and propose quantity, unit, food and note for each. Writes nothing.",
        'Review the proposals, then apply them with mealie_edit_ingredients: the returned operations can be passed as they are, with createMissing: true if a food or unit is not in the catalog yet.',
      ].join(' '),
      inputSchema: z.object({
        slug: z.string().trim().min(1).max(200).describe('Recipe slug'),
        ingredients: z.array(z.number().int().min(1)).max(200).optional().describe('Ingredient numbers to parse (default: every free-text one)'),
        parser: z.enum(PARSERS).optional().describe('nlp (default), brute, or openai when Mealie has an AI provider'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ slug, ingredients: numbers, parser = 'nlp' }) =>
      runTool(
        logger,
        'mealie_parse_ingredients',
        async () => {
          const recipe = await mealie.get<MealieRecipe>(api`/api/recipes/${slug}`);
          const all = recipe.recipeIngredient ?? [];
          const unknown = (numbers ?? []).filter((n) => n > all.length);
          if (unknown.length) throw new ToolError(`There is no ingredient ${unknown.join(', ')} (the recipe has ${all.length}).`);
          const targets = (numbers ? [...new Set(numbers)] : all.flatMap((ingredient, i) => (isFreeText(ingredient) ? [i + 1] : [])))
            // The whole line: the imported text if Mealie kept it, else the line as Mealie displays it.
            .map((n) => ({ n, text: (all[n - 1]!.originalText || all[n - 1]!.display || all[n - 1]!.note || '').trim() }))
            .filter((target) => target.text !== '');
          if (targets.length === 0) return { proposals: [], next: 'No free-text ingredient to parse: every ingredient is already structured.' };

          let parsed: MealieParsedIngredient[];
          try {
            parsed = await mealie.post<MealieParsedIngredient[]>(api`/api/parser/ingredients`, {
              parser,
              ingredients: targets.map((target) => target.text),
            });
          } catch (err) {
            if (parser !== 'nlp' && err instanceof MealieError && err.kind === 'http' && err.status !== 401 && err.status !== 403) {
              throw new ToolError(`The ${parser} parser is not available in this Mealie. Use parser "nlp".`);
            }
            throw err;
          }

          const proposals = targets.map((target, i) => {
            const result = parsed[i]?.ingredient ?? {};
            const confidence = parsed[i]?.confidence?.average;
            return {
              n: target.n,
              input: target.text,
              ...(result.quantity ? { quantity: result.quantity } : {}),
              ...(result.unit?.name ? { unit: result.unit.name, unitInCatalog: !!result.unit.id } : {}),
              ...(result.food?.name ? { food: result.food.name, foodInCatalog: !!result.food.id } : {}),
              ...(result.note ? { note: result.note } : {}),
              ...(typeof confidence === 'number' ? { confidence: Math.round(confidence * 100) / 100 } : {}),
            };
          });
          const operations = proposals
            .filter((p) => p.food || p.quantity || p.unit)
            .map((p) => ({ op: 'update' as const, n: p.n, quantity: p.quantity ?? null, unit: p.unit ?? null, food: p.food ?? null, note: p.note ?? '' }));
          const missing = proposals.filter((p) => (p.food && !p.foodInCatalog) || (p.unit && !p.unitInCatalog));
          const doubtful = proposals.filter((p) => p.confidence !== undefined && p.confidence < LOW_CONFIDENCE).map((p) => p.n);
          return {
            proposals,
            operations,
            next: [
              'Apply with mealie_edit_ingredients and these operations; the original text of each ingredient is kept.',
              missing.length ? `Ingredients ${missing.map((p) => p.n).join(', ')} use a food or unit not in the catalog: add createMissing: true, or fix the names first.` : '',
              doubtful.length ? `Check ingredients ${doubtful.join(', ')}: the parser is not confident.` : '',
            ]
              .filter(Boolean)
              .join(' '),
          };
        },
        { notFound: 'Use mealie_search_recipes to find the recipe slug.' }
      )
  );
}
