# mealie-mcp

Serveur MCP distant qui permet à Claude (claude.ai web, mobile, desktop et Claude Code) de piloter un Mealie auto-hébergé : recettes, menus, listes de courses, catalogue d'aliments et d'unités.

Le travail est suivi dans Kaneo, projet « Code cloud - mealie mcp » (tickets CCMM-n).

## Décisions

- **Stack** : TypeScript, Node 24 (version exacte figée dans `.node-version`, utilisée par la CI et l'environnement cloud), SDK MCP TypeScript officiel (`@modelcontextprotocol/server` + `@modelcontextprotocol/node`), transport Streamable HTTP sur `/mcp`, serveur `node:http` sans framework.
- **Sans état** : une instance de serveur MCP par requête HTTP. Rien n'est stocké : ni base de données, ni session, ni clé de chiffrement.
- **Authentification** : chaque personne colle son token API Mealie dans les en-têtes du connecteur (`Authorization: Bearer <token>`). Le serveur le transmet à Mealie pour chaque appel et agit donc avec les droits de cette personne.
- **Ingrédients** : toujours manipulés sous forme structurée (quantité, unité, aliment, note). Avant d'écrire, relire la recette ; renvoyer à Mealie les ingrédients non modifiés exactement tels qu'il les a fournis (`referenceId`, sections, sous-recettes, substitutions, texte d'origine). Jamais de réécriture en texte libre.
- **Sécurité** : pas d'outil d'accès brut à l'API Mealie. Les outils destructifs sont annotés pour que le client demande confirmation. Le contenu des recettes importées est non fiable (injection de prompt possible).
- **Cible** : Mealie v3.

## Commandes

```sh
npm ci
MEALIE_URL=http://localhost:9000 npm run dev   # serveur sur http://localhost:8080/mcp
npm test                                       # tests unitaires et de bout en bout (Mealie simulé)
npm run test:live                              # tests d'intégration contre un vrai Mealie (Docker requis)
npm run typecheck
npm run build                                  # compile dans dist/
```

## Structure

- `src/index.ts` : démarrage et arrêt propre (SIGTERM, SIGINT)
- `src/config.ts` : lecture et validation des variables d'environnement
- `src/log.ts` : logs JSON, une ligne par évènement
- `src/http/app.ts` : serveur HTTP, routes `/mcp` et `/healthz`
- `src/http/auth.ts` : contrôle du token avant chaque requête `/mcp` (401, 429, 503) ; `src/http/client-ip.ts` : IP réelle derrière `TRUST_PROXY` proxies
- `src/auth/` : lecture de l'en-tête Bearer, validation du token par `GET /api/users/self` avec cache (hash SHA-256), limite des échecs par IP
- `src/mealie/client.ts` : client Mealie d'un utilisateur (timeout, une relance sur les GET après une erreur réseau ou un 5xx) ; `src/mealie/errors.ts` : erreurs et messages pour le modèle ; `src/mealie/path.ts` : `` api`/api/recipes/${slug}` `` encode chaque segment et refuse `.`, `..` et `/`
- `src/mcp/server.ts` : fabrique du serveur MCP (une par requête, avec le client Mealie de l'utilisateur) et instructions envoyées au modèle
- `src/catalog/` : résolution des noms d'aliments et d'unités. `normalize.ts` compare sans casse, accents, ligatures ni ponctuation ; `resolve.ts` renvoie `found`, `ambiguous` (égalité : jamais de choix au hasard) ou `not_found` avec des suggestions proches. Le nom exact l'emporte sur le pluriel et l'abréviation, qui l'emportent sur un alias. `catalog.ts` charge le catalogue Mealie et fournit les vues compactes. À réutiliser pour les ingrédients et les listes de courses
- `src/recipes/ingredients.ts` : champs d'un ingrédient tels que le modèle les écrit (`ingredientFields`, noms et non identifiants), résolution des aliments et unités (`resolveCatalogRefs`, création seulement avec `createMissing`), `applyFields` qui ne change que les champs fournis et conserve le texte d'origine d'un ingrédient en texte libre, `newIngredient`. À réutiliser pour la création de recette
- `src/recipes/list-edit.ts` : `ListEdit`, moteur commun aux ingrédients et aux étapes. Les numéros et positions `after` désignent toujours la liste lue ; les éléments non visés ressortent comme les mêmes objets ; les problèmes sont tous collectés et rien n'est appliqué si une opération est invalide
- `src/recipes/edit.ts` : `applyIngredientOperations`, fonction pure bâtie sur `ListEdit`. L'outil relit la recette juste avant d'écrire puis envoie un seul `PATCH` (`recipeIngredient`, plus `recipeInstructions` seulement si des liens sont retirés)
- `src/recipes/steps.ts` : `applyStepOperations`, fonction pure bâtie sur `ListEdit`. Les ingrédients sont désignés par numéro et liés par leur `referenceId` ; une étape modifiée garde ses liens et ses autres clés sauf `link`, `unlink` ou `ingredients`. L'outil envoie un seul `PATCH` avec `recipeInstructions`. Mealie donne un nouvel `id` aux étapes à chaque écriture : ne jamais s'appuyer dessus
- `src/recipes/view.ts` : vues compactes des recettes. Ingrédients et étapes numérotés à partir de 1 ; les étapes citent les ingrédients par numéro, jamais par `referenceId`. Un ingrédient sans aliment (ni sous-recette) est signalé `freeText`
- `src/mcp/tools/` : un fichier par outil ou famille d'outils ; `result.ts` (`runTool`) renvoie le JSON compact ou un message d'erreur actionnable (`ToolError` pour un message écrit pour le modèle)
- `tests/` : tests vitest ; `tests/helpers/app.ts` démarre le vrai serveur sur un port aléatoire ; `tests/helpers/mealie.ts` simule Mealie avec msw (`mealie.use(...)` pour surcharger une route dans un test)
- `tests/live/` : tests d'intégration (`vitest.live.config.ts`, un fichier à la fois), exclus de `npm test`. Un test qui modifie des recettes crée la sienne avec `createFixtureRecipe` et la supprime à la fin. `run.ts` démarre le Mealie jetable de `docker-compose.test.yml` (version épinglée, SQLite en tmpfs), attend qu'il réponde, lance `seed.ts`, exécute la suite puis supprime le conteneur (`KEEP_MEALIE=1` le laisse tourner). `fixtures.ts` : utilisateur non admin, aliments et unités en français avec pluriels et alias, recettes avec sections et étapes liées aux ingrédients. `helpers.ts` : `liveSeed()` et `readRawRecipe(slug)` pour comparer le JSON brut d'une recette avant et après un appel d'outil

## Conventions

- Outils nommés `mealie_<verbe>_<objet>` (ex. `mealie_get_recipe`), avec une description courte en anglais écrite pour le modèle et un schéma d'entrée zod.
- Chaque outil déclare ses annotations MCP : `readOnlyHint`, `destructiveHint`, `idempotentHint`.
- Réponses compactes : seulement les champs utiles au modèle, pas d'identifiants techniques qu'il n'a pas à manipuler.
- Erreurs renvoyées au modèle sous forme de messages actionnables (« introuvable, utilise `mealie_search_recipes` »), jamais de traces.
- Chaque outil a ses tests : unitaires avec un Mealie simulé, et d'intégration contre le Mealie de test (à partir de CCMM-3).
- Ne jamais écrire d'en-têtes HTTP ni de token dans les logs. Le logger masque aussi les clés sensibles en dernier recours.
- ESM : les imports relatifs portent l'extension `.js`.
- Code, commentaires, noms et messages de commit en anglais ; README et CLAUDE.md en français.
- `VERSION` (`src/version.ts`) suit `package.json` : un test le vérifie.

## Workflow

- Une branche et une PR par ticket Kaneo : `ccmm-<n>-<sujet>`.
- Dès que la CI est verte, la PR est fusionnée en squash merge, sans attendre de validation. Ensuite on passe le ticket en « Done » dans Kaneo.
- Une fois la PR fusionnée, on enchaîne directement sur le ticket suivant (ordre des numéros, en respectant les relations « bloque »).
- La CI (`.github/workflows/ci.yml`) lance typecheck, tests et build sur chaque PR, et `npm run test:live` dans un job séparé (`live`). L'environnement cloud ne peut pas télécharger l'image Mealie : les tests d'intégration se vérifient dans la CI.
- La CI installe avec `npm ci` : `package-lock.json` est committé et doit être à jour. Après une modification de `package.json`, lancer `npm install` et committer le lockfile dans la même PR.
- Environnement cloud : le hook SessionStart (`.claude/settings.json`, `.claude/hooks/session-start.sh`) installe dans `/opt` la version de Node lue dans `.node-version`, l'ajoute au `PATH`, puis lance `npm ci` (ou `npm install` sans lockfile). Il saute l'installation si `package.json`, `package-lock.json` et la version de Node n'ont pas changé. Hors du cloud, il ne fait rien.
