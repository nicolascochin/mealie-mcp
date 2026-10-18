# mealie-mcp

Serveur MCP pour piloter [Mealie](https://github.com/mealie-recipes/mealie) depuis Claude (claude.ai web, mobile, desktop et Claude Code), sans casser les ingrédients structurés.

Chaque personne se connecte avec son propre token API Mealie, passé dans l'en-tête `Authorization` du connecteur. Le serveur ne stocke rien.

> En construction.

## Outils

| Outil | Rôle |
| ----- | ---- |
| `mealie_whoami` | Utilisateur connecté : nom, foyer, groupe |
| `mealie_search_foods` | Retrouve un aliment par nom, pluriel ou alias (sans casse ni accents), ou propose des candidats |
| `mealie_search_units` | Idem pour les unités, abréviations comprises |
| `mealie_list_tags`, `mealie_list_categories` | Tags et catégories de recettes |
| `mealie_create_food`, `mealie_create_unit` | Ajoute un aliment ou une unité ; refuse un nom déjà utilisé |
| `mealie_search_recipes` | Recherche par texte, tags, catégories ou aliments (par leur nom), avec tri et pagination |
| `mealie_get_recipe` | Recette complète : ingrédients numérotés (quantité, unité, aliment, note, section), étapes avec les numéros de leurs ingrédients, notes ; signale les ingrédients en texte libre |
| `mealie_suggest_recipes` | « Que puis-je faire avec… » : recettes qui utilisent ces aliments, avec ce qui manque |
| `mealie_edit_ingredients` | Ajoute, modifie, déplace ou supprime des ingrédients en une écriture, sans jamais les passer en texte libre ; structure les ingrédients importés en texte libre |
| `mealie_parse_ingredients` | Passe les ingrédients en texte libre au parseur de Mealie et propose quantité, unité, aliment et note, prêts pour `mealie_edit_ingredients` (n'écrit rien) |
| `mealie_edit_steps` | Ajoute, modifie, déplace ou supprime des étapes en une écriture ; lie ou délie des ingrédients par leur numéro, sans perdre les liens existants |
| `mealie_create_recipe` | Crée une recette avec ingrédients structurés, étapes liées et métadonnées |
| `mealie_update_recipe` | Modifie description, temps, portions, rendement, tags, catégories, notes ou source, sans toucher aux ingrédients ni aux étapes |
| `mealie_import_recipe_from_url` | Fait importer une page web par Mealie ; indique les ingrédients restés en texte libre |
| `mealie_duplicate_recipe`, `mealie_mark_recipe_made` | Copie une recette ; note qu'elle a été cuisinée |
| `mealie_delete_recipe` | Supprime une recette (le client demande confirmation) |
| `mealie_list_shopping_lists`, `mealie_get_shopping_list` | Listes de courses ; articles numérotés, non cochés par défaut |
| `mealie_add_shopping_items` | Ajoute des articles avec aliments et unités du catalogue, que Mealie fusionne avec les articles existants |
| `mealie_update_shopping_items`, `mealie_remove_shopping_items` | Coche, décoche, change quantité ou note ; supprime des articles |
| `mealie_add_recipe_to_shopping_list`, `mealie_remove_recipe_from_shopping_list` | Ajoute ou retire les ingrédients d'une recette, pour un facteur ou un nombre de portions |
| `mealie_list_mealplans`, `mealie_get_todays_meals` | Menus entre deux dates (semaine en cours par défaut) ; repas du jour |
| `mealie_add_mealplan_entry`, `mealie_update_mealplan_entry`, `mealie_delete_mealplan_entry` | Place une recette ou une note à une date et un repas ; déplace, change ou retire un repas |

## Lancer en local

Prérequis : Node à la version de `.node-version` (24.22.0). Les gestionnaires de versions qui lisent ce fichier, comme fnm ou nodenv, la sélectionnent automatiquement.

```sh
npm install
MEALIE_URL=http://localhost:9000 npm run dev
```

Le serveur MCP écoute sur `http://localhost:8080/mcp`. Pour l'explorer :

```sh
npx @modelcontextprotocol/inspector
```

puis choisir le transport « Streamable HTTP » et l'URL `http://localhost:8080/mcp`.

## Image Docker

Chaque tag `vX.Y.Z` publie `ghcr.io/nicolascochin/mealie-mcp:X.Y.Z` (et `:X.Y`) pour amd64 et arm64. L'image tourne avec un utilisateur non-root et déclare un `HEALTHCHECK` sur `/healthz`.

```sh
docker run -d -p 8080:8080 -e MEALIE_URL=http://mealie:9000 ghcr.io/nicolascochin/mealie-mcp:0.1.0
```

## Variables d'environnement

| Variable     | Obligatoire | Défaut | Rôle                                                                        |
| ------------ | ----------- | ------ | --------------------------------------------------------------------------- |
| `MEALIE_URL` | oui         |        | Adresse de Mealie vue par le serveur, par exemple `http://mealie:9000`      |
| `PORT`       | non         | `8080` | Port d'écoute                                                               |
| `LOG_LEVEL`  | non         | `info` | `debug`, `info`, `warn`, `error` ou `silent`                                |
| `TRUST_PROXY` | non        | `0`    | Nombre de reverse proxies devant le serveur dont on lit `X-Forwarded-For` (comme `trust proxy` d'Express) |

Le serveur refuse de démarrer si une variable est absente ou invalide, et liste tous les problèmes d'un coup.

## Routes

- `POST /mcp` : point d'entrée MCP (Streamable HTTP, sans état)
- `GET /healthz` : répond `ok`, pour les sondes de santé

## Authentification

Chaque requête sur `/mcp` doit porter `Authorization: Bearer <token API Mealie>`. Le token se crée dans Mealie, depuis le profil de l'utilisateur, rubrique « API Tokens ».

- Sans token : `401`.
- Token refusé par Mealie : `401`. Après 10 refus en 15 minutes depuis une même IP, toutes les requêtes de cette IP reçoivent `429` jusqu'à la fin de la fenêtre. Derrière un reverse proxy, régler `TRUST_PROXY` pour que l'IP comptée soit celle du client.
- Mealie injoignable : `503`.

Un token valide est gardé 5 minutes en mémoire, indexé par son hash SHA-256 ; le token lui-même n'est ni stocké ni écrit dans les logs.

Pour tester avec le MCP Inspector, ajouter l'en-tête `Authorization` dans sa configuration d'authentification.

## Développement

```sh
npm test            # tests unitaires et de bout en bout (Mealie simulé)
npm run test:live   # tests d'intégration contre un Mealie jetable (Docker requis)
npm run typecheck
npm run build       # compile dans dist/
npm start           # lance la version compilée
```
