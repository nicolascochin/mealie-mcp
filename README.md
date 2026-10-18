# mealie-mcp

MCP server to drive [Mealie](https://github.com/mealie-recipes/mealie) from Claude (claude.ai web, mobile, desktop and Claude Code), without breaking structured ingredients.

Each person connects with their own Mealie API token, passed in the connector's `Authorization` header. The server stores nothing.

Targets Mealie v3. Tested against **Mealie v3.29.0**: the integration tests move to each new Mealie release as soon as it passes them.

> Work in progress.

## Tools

| Tool | What it does |
| ---- | ------------ |
| `mealie_whoami` | Connected user: name, household, group |
| `mealie_search_foods` | Finds a food by name, plural or alias (ignoring case and accents), or suggests candidates |
| `mealie_search_units` | Same for units, abbreviations included |
| `mealie_list_tags`, `mealie_list_categories`, `mealie_list_tools` | Recipe tags, categories and kitchen tools |
| `mealie_list_labels` | Food labels (store sections), which group the items of shopping lists |
| `mealie_create_food`, `mealie_create_unit` | Adds a food (with its label) or a unit; refuses a name already in use |
| `mealie_update_food`, `mealie_update_unit` | Renames, changes the plural, abbreviations or label, adds or removes aliases; only touches the given fields |
| `mealie_merge_foods`, `mealie_merge_units` | Merges a duplicate into the entry that stays: recipes and shopping lists then point to it, and the duplicate's names become aliases |
| `mealie_search_recipes` | Searches by text, tags, categories, kitchen tools or foods (by name), or among favorites, with sorting and pagination |
| `mealie_get_recipe` | Full recipe: numbered ingredients (quantity, unit, food, note, section), steps with the numbers of their ingredients, notes, the user's rating and favorite, whether it has a photo; flags free-text ingredients |
| `mealie_set_favorite`, `mealie_rate_recipe` | Adds or removes a favorite; rates a recipe from 0.5 to 5 stars (0 removes the rating), for the connected user |
| `mealie_suggest_recipes` | "What can I make with…": recipes that use these foods, with what is missing |
| `mealie_edit_ingredients` | Adds, changes, moves or removes ingredients in one write, never turning them into free text; structures free-text ingredients from imports |
| `mealie_parse_ingredients` | Runs free-text ingredients through Mealie's parser and proposes quantity, unit, food and note, ready for `mealie_edit_ingredients` (writes nothing) |
| `mealie_edit_steps` | Adds, changes, moves or removes steps in one write; links or unlinks ingredients by number, without losing existing links |
| `mealie_create_recipe` | Creates a recipe with structured ingredients, linked steps and metadata |
| `mealie_update_recipe` | Changes the description, times, servings, yield, tags, categories, kitchen tools, notes or source, without touching ingredients or steps |
| `mealie_import_recipe_from_url` | Has Mealie import a web page; reports the ingredients left as free text |
| `mealie_set_recipe_image` | Has Mealie download an image from a URL and makes it the recipe's photo |
| `mealie_duplicate_recipe`, `mealie_mark_recipe_made` | Copies a recipe; records that it was cooked |
| `mealie_delete_recipe` | Deletes a recipe (the client asks for confirmation) |
| `mealie_tag_recipes`, `mealie_categorize_recipes` | Adds tags or categories to several recipes at once, keeping their own |
| `mealie_delete_recipes` | Deletes several recipes at once (the client asks for confirmation); nothing is deleted if a slug is unknown |
| `mealie_list_shopping_lists`, `mealie_get_shopping_list` | Shopping lists; numbered items, grouped by label, unchecked ones by default |
| `mealie_create_shopping_list`, `mealie_rename_shopping_list`, `mealie_delete_shopping_list` | Creates, renames or deletes a list; two lists cannot share a name |
| `mealie_add_shopping_items` | Adds items with foods and units from the catalog, which Mealie merges with existing items |
| `mealie_update_shopping_items`, `mealie_remove_shopping_items` | Checks, unchecks, changes quantity or note; removes items |
| `mealie_add_recipe_to_shopping_list`, `mealie_remove_recipe_from_shopping_list` | Adds or removes a recipe's ingredients, for a scale factor or a number of servings |
| `mealie_list_mealplans`, `mealie_get_todays_meals` | Meal plans between two dates (current week by default); today's meals |
| `mealie_add_mealplan_entry`, `mealie_update_mealplan_entry`, `mealie_delete_mealplan_entry` | Plans a recipe or a note for a date and a meal; moves, changes or removes a planned meal |
| `mealie_plan_random_meal`, `mealie_list_mealplan_rules` | Has Mealie pick a recipe for a date and a meal, following the household's rules; lists those rules (day, meal, allowed recipes, by name) |

## Importing a recipe from a photo

Send the photo (or a screenshot, or the text) in the conversation with Claude: Claude reads it, then creates the recipe with `mealie_create_recipe`. Ingredients are structured and matched to the catalog, steps are linked to their ingredients, and a note records where the recipe comes from. A food missing from the catalog is reported with close matches: Claude picks the right one, or creates it with `createMissing`.

Mealie's own image import is not used: it needs an AI provider configured in Mealie, and an MCP tool does not receive the images of the conversation. For the same reason, the photo does not become the recipe's image: `mealie_set_recipe_image` only takes a URL.

## Running locally

Requirement: Node at the version in `.node-version` (24.22.0). Version managers that read this file, such as fnm or nodenv, select it automatically.

```sh
npm install
MEALIE_URL=http://localhost:9000 npm run dev
```

The MCP server listens on `http://localhost:8080/mcp`. To explore it:

```sh
npx @modelcontextprotocol/inspector
```

then choose the "Streamable HTTP" transport and the URL `http://localhost:8080/mcp`.

## Docker image

Each release publishes `ghcr.io/nicolascochin/mealie-mcp:X.Y.Z` (and `:X.Y`, `:latest`) for amd64 and arm64: merging a version bump of `package.json` into main tags it `vX.Y.Z` and publishes its notes from [CHANGELOG.md](CHANGELOG.md). The image runs as a non-root user and declares a `HEALTHCHECK` on `/healthz`.

```sh
docker run -d -p 8080:8080 -e MEALIE_URL=http://mealie:9000 ghcr.io/nicolascochin/mealie-mcp:0.2.0
```

## Environment variables

| Variable      | Required | Default | Purpose                                                                     |
| ------------- | -------- | ------- | --------------------------------------------------------------------------- |
| `MEALIE_URL`  | yes      |         | Mealie's address as the server sees it, for example `http://mealie:9000`   |
| `PORT`        | no       | `8080`  | Listening port                                                              |
| `LOG_LEVEL`   | no       | `info`  | `debug`, `info`, `warn`, `error` or `silent`                                |
| `TRUST_PROXY` | no       | `0`     | Number of reverse proxies in front of the server whose `X-Forwarded-For` is read (like Express's `trust proxy`) |

The server refuses to start if a variable is missing or invalid, and lists every problem at once.

## Routes

- `POST /mcp`: MCP endpoint (Streamable HTTP, stateless)
- `GET /healthz`: answers `ok`, for health probes

## Authentication

Every request to `/mcp` must carry `Authorization: Bearer <Mealie API token>`. The token is created in Mealie, from the user's profile, under "API Tokens".

- No token: `401`.
- Token refused by Mealie: `401`. After 10 refusals in 15 minutes from the same IP, every request from that IP gets `429` until the window ends. Behind a reverse proxy, set `TRUST_PROXY` so that the counted IP is the client's.
- Mealie unreachable: `503`.

A valid token is kept in memory for 5 minutes, keyed by its SHA-256 hash; the token itself is neither stored nor written to the logs.

To test with the MCP Inspector, add the `Authorization` header in its authentication settings.

## Development

```sh
npm test            # unit and end-to-end tests (simulated Mealie)
npm run test:live   # integration tests against a throwaway Mealie (Docker required)
npm run typecheck
npm run build       # compiles into dist/
npm start           # runs the compiled version
```
