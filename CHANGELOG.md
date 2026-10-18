# Changelog

Merging a version bump of `package.json` into main publishes the release: the section below that
matches the version becomes its release notes.

## 0.2.0

Tested against Mealie v3.29.0. 48 tools (30 in 0.1.0), none removed.

### New

- `mealie_parse_ingredients`: structures free-text ingredients with Mealie's parser
- Shopping lists: create, rename and delete lists; items grouped by label
- Catalog: update and merge foods and units; food labels (`mealie_list_labels`)
- Kitchen tools on recipes, and search by tool
- Favorites and ratings of the connected user
- Random meals following the household's meal plan rules, and the rules themselves
- Recipe image from a URL
- Bulk tag, categorize and delete recipes
- Guidance for importing a recipe from a photo or text

### Maintenance

- TypeScript 7, zod 4.6.7, msw 3.0.3, Docker actions updated
- README in English

```sh
docker pull ghcr.io/nicolascochin/mealie-mcp:0.2.0
```

## 0.1.0

First release, tested against Mealie v3.29.0. 30 tools:

- Recipes: search, read, suggest from available foods, create, update, import from a URL, duplicate, mark as made, delete
- Ingredients and steps edited in place, always kept structured, with steps linked to their ingredients
- Catalog: find and create foods and units, list tags and categories
- Shopping lists: items, and adding or removing a recipe's ingredients
- Meal plans: list, today's meals, add, change and remove entries
