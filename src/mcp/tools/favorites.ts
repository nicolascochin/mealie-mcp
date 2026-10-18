import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { api } from '../../mealie/path.js';
import type { ToolDeps } from '../server.js';
import { runTool } from './result.js';

const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const NOT_FOUND_HINT = 'Use mealie_search_recipes to find the recipe slug.';

const slug = z.string().trim().min(1).max(200).describe('Recipe slug, from mealie_search_recipes');

/** Favorites and ratings belong to the connected user, as in Mealie's own interface. */
export function registerFavoriteTools(server: McpServer, { mealie, logger }: ToolDeps): void {
  server.registerTool(
    'mealie_set_favorite',
    {
      title: 'Add or remove a favorite',
      description:
        "Add a recipe to the user's favorites, or remove it. List the favorites with mealie_search_recipes and favoritesOnly: true.",
      inputSchema: z.object({ slug, favorite: z.boolean().describe('true to add to the favorites, false to remove') }),
      annotations: WRITE,
    },
    ({ slug, favorite }) =>
      runTool(
        logger,
        'mealie_set_favorite',
        async () => {
          const user = await mealie.getSelf();
          await mealie.request(favorite ? 'POST' : 'DELETE', api`/api/users/${user.id}/favorites/${slug}`);
          return { slug, favorite };
        },
        { notFound: NOT_FOUND_HINT }
      )
  );

  server.registerTool(
    'mealie_rate_recipe',
    {
      title: 'Rate a recipe',
      description: "Set the user's own rating of a recipe, from 1 to 5 stars in half steps; 0 removes it.",
      inputSchema: z.object({
        slug,
        rating: z.number().min(0).max(5).multipleOf(0.5).describe('Stars, e.g. 4 or 3.5; 0 removes the rating'),
      }),
      annotations: WRITE,
    },
    ({ slug, rating }) =>
      runTool(
        logger,
        'mealie_rate_recipe',
        async () => {
          const user = await mealie.getSelf();
          await mealie.request('POST', api`/api/users/${user.id}/ratings/${slug}`, { rating });
          return { slug, myRating: rating || null };
        },
        { notFound: NOT_FOUND_HINT }
      )
  );
}
