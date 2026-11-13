# mealie-mcp

MCP server to drive [Mealie](https://github.com/mealie-recipes/mealie) from Claude (claude.ai web, mobile, desktop and Claude Code), without breaking structured ingredients.

Each person connects with their own Mealie API token, passed in the connector's `Authorization` header. The server stores nothing.

Targets Mealie v3; recipe durations need v3.29 or later, step durations and meals planned for a week v3.30 or later. Tested against **Mealie v3.31.0**: the integration tests move to each new Mealie release as soon as it passes them.

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
| `mealie_search_recipes` | Searches by text, tags, categories, kitchen tools or foods (by name), or among favorites, with sorting (quickest first included) and pagination |
| `mealie_get_recipe` | Full recipe: times, numbered ingredients (quantity, unit, food, note, section), steps with the numbers of their ingredients and their duration, notes, the user's rating and favorite, whether it has a photo; flags free-text ingredients and the old cooking time Mealie no longer shows |
| `mealie_set_favorite`, `mealie_rate_recipe` | Adds or removes a favorite; rates a recipe from 0.5 to 5 stars (0 removes the rating), for the connected user |
| `mealie_suggest_recipes` | "What can I make with…": recipes that use these foods, with what is missing |
| `mealie_edit_ingredients` | Adds, changes, moves or removes ingredients in one write, never turning them into free text; structures free-text ingredients from imports |
| `mealie_parse_ingredients` | Runs free-text ingredients through Mealie's parser and proposes quantity, unit, food and note, ready for `mealie_edit_ingredients` (writes nothing) |
| `mealie_edit_steps` | Adds, changes, moves or removes steps in one write; links or unlinks ingredients by number, without losing existing links; sets how long a step takes |
| `mealie_create_recipe` | Creates a recipe with structured ingredients, linked steps and metadata |
| `mealie_update_recipe` | Changes the description, times, servings, yield, tags, categories, kitchen tools, notes or source, without touching ingredients or steps; clears the old cooking time |
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
| `mealie_list_mealplans`, `mealie_get_todays_meals` | Meal plans between two dates (current week by default); today's meals; meals planned for a whole week are listed apart |
| `mealie_add_mealplan_entry`, `mealie_update_mealplan_entry`, `mealie_delete_mealplan_entry` | Plans a recipe or a note for a date and a meal, or for a whole week on no specific day; moves, changes or removes a planned meal |
| `mealie_plan_random_meal`, `mealie_list_mealplan_rules` | Has Mealie pick a recipe for a date (or a week) and a meal, following the household's rules; lists those rules (day, meal, allowed recipes, by name) |

## Recipe times

Since Mealie v3.29, each recipe time (total, preparation, cooking) is a duration that Mealie's interface edits in hours and minutes, followed by an optional text. The tools read and write them the same way:

```json
{ "cookTime": { "hours": 1, "minutes": 30, "text": "plus 1 night of marinating" } }
```

Leaving out both `hours` and `minutes` keeps the duration, leaving out `text` keeps the text, 0 hours and 0 minutes clear the duration, and `null` clears the whole time. `cookTime` is the cooking time Mealie shows (its `performTime`). Mealie's migration only turned times written in words ("20 minutes") into durations: abbreviations such as "15 min" or "1 h 30" stay as text until they are set again in hours and minutes.

Since v3.30, a step can also have its own duration, e.g. `{ "minutes": 10 }` for "bake 10 minutes": `mealie_get_recipe` shows it, and `mealie_create_recipe` and `mealie_edit_steps` set it (`null` clears it).

Mealie v3.29 and v3.30 no longer show their older `cookTime` field, and did not migrate it. When a recipe still has one, `mealie_get_recipe` returns it as `legacyCookTime` with a warning: move it to `cookTime` and clear it with `legacyCookTime: null`, in one `mealie_update_recipe` call. Mealie v3.31 moved those values to the cooking time it shows, so `legacyCookTime` no longer appears there.

## Meals planned for a week

Since Mealie v3.30, a meal can be planned for a whole week, on no specific day: "this week we'll have a raclette". Pass `week: true` with any date of that week to `mealie_add_mealplan_entry` or `mealie_plan_random_meal`; the week follows the household's first day of the week, as in Mealie's planner. `mealie_list_mealplans` and `mealie_get_todays_meals` return these meals apart, in `weekMeals`, with the `week` they cover. `mealie_update_mealplan_entry` moves a week meal to the week of a new date, turns a day meal into a week meal (`week: true`), or a week meal into a day meal (`week: false` with the date).

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
docker run -d -p 8080:8080 -e MEALIE_URL=http://mealie:9000 ghcr.io/nicolascochin/mealie-mcp:0.3.0
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
