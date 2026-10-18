import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { api } from '../../mealie/path.js';
import type { MealieRecipe } from '../../mealie/types.js';
import { applyStepOperations, stepOperation } from '../../recipes/steps.js';
import { recipeView } from '../../recipes/view.js';
import type { ToolDeps } from '../server.js';
import { runTool } from './result.js';

export function registerEditSteps(server: McpServer, { mealie, logger }: ToolDeps): void {
  server.registerTool(
    'mealie_edit_steps',
    {
      title: 'Edit recipe steps',
      description: [
        'Add, update, move or delete steps of a recipe in one write, and link or unlink ingredients to a step.',
        'Step and ingredient numbers refer to the lists as mealie_get_recipe shows them, even after earlier operations in the same call: read the recipe first.',
        'An update keeps the step links unless link, unlink or ingredients is given. A title starts a section at that step.',
      ].join(' '),
      inputSchema: z.object({
        slug: z.string().trim().min(1).max(200).describe('Recipe slug'),
        operations: z.array(stepOperation).min(1).max(50),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    ({ slug, operations }) =>
      runTool(
        logger,
        'mealie_edit_steps',
        async () => {
          // Read right before writing: every step not targeted goes back exactly as Mealie sent it.
          const recipe = await mealie.get<MealieRecipe>(api`/api/recipes/${slug}`);
          const instructions = applyStepOperations(recipe.recipeInstructions ?? [], recipe.recipeIngredient ?? [], operations);
          await mealie.request('PATCH', api`/api/recipes/${slug}`, { recipeInstructions: instructions });
          const saved = recipeView(await mealie.get<MealieRecipe>(api`/api/recipes/${slug}`));
          return { steps: saved.steps };
        },
        { notFound: 'Use mealie_search_recipes to find the recipe slug.' }
      )
  );
}
