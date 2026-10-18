import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { api } from '../../mealie/path.js';
import type { MealieRecipe } from '../../mealie/types.js';
import { applyIngredientOperations, ingredientOperation, operationFields } from '../../recipes/edit.js';
import { resolveCatalogRefs } from '../../recipes/ingredients.js';
import { recipeView } from '../../recipes/view.js';
import type { ToolDeps } from '../server.js';
import { runTool } from './result.js';

export function registerEditIngredients(server: McpServer, { mealie, logger }: ToolDeps): void {
  server.registerTool(
    'mealie_edit_ingredients',
    {
      title: 'Edit recipe ingredients',
      description: [
        'Add, update, move or delete ingredients of a recipe in one write, keeping them structured (quantity, unit, food, note).',
        'Numbers refer to the list as mealie_get_recipe shows it, even after earlier operations in the same call: read the recipe first.',
        'An update changes only the fields given. Foods and units are given by name; unknown names fail with close matches unless createMissing is true.',
        'To structure a free-text ingredient, update it with quantity, unit, food and the remaining note ("" for none): its original text is kept.',
        'A section title starts a section at that ingredient. Deleting an ingredient used by a step requires unlinkSteps: true.',
      ].join(' '),
      inputSchema: z.object({
        slug: z.string().trim().min(1).max(200).describe('Recipe slug'),
        operations: z.array(ingredientOperation).min(1).max(50),
        createMissing: z.boolean().optional().describe('Create foods and units that do not exist yet (default false)'),
        unlinkSteps: z.boolean().optional().describe('Allow deleting ingredients used by steps, removing them from those steps (default false)'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    ({ slug, operations, createMissing, unlinkSteps }) =>
      runTool(
        logger,
        'mealie_edit_ingredients',
        async () => {
          // Read right before writing: every ingredient not targeted goes back exactly as Mealie sent it.
          const recipe = await mealie.get<MealieRecipe>(api`/api/recipes/${slug}`);
          const refs = await resolveCatalogRefs(mealie, operationFields(operations), createMissing ?? false);
          const edit = applyIngredientOperations(recipe.recipeIngredient ?? [], recipe.recipeInstructions ?? [], operations, refs, {
            unlinkSteps,
          });
          await mealie.request('PATCH', api`/api/recipes/${slug}`, {
            recipeIngredient: edit.ingredients,
            ...(edit.instructions ? { recipeInstructions: edit.instructions } : {}),
          });
          const saved = await mealie.get<MealieRecipe>(api`/api/recipes/${slug}`);
          const view = recipeView(saved);
          return { ingredients: view.ingredients, steps: view.steps, ...(view.warnings ? { warnings: view.warnings } : {}) };
        },
        { notFound: 'Use mealie_search_recipes to find the recipe slug.' }
      )
  );
}
