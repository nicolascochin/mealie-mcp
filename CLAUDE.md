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
npm install
MEALIE_URL=http://localhost:9000 npm run dev   # serveur sur http://localhost:8080/mcp
npm test                                       # tests unitaires et de bout en bout
npm run typecheck
npm run build                                  # compile dans dist/
```

## Structure

- `src/index.ts` : démarrage et arrêt propre (SIGTERM, SIGINT)
- `src/config.ts` : lecture et validation des variables d'environnement
- `src/log.ts` : logs JSON, une ligne par évènement
- `src/http/app.ts` : serveur HTTP, routes `/mcp` et `/healthz`
- `src/mcp/server.ts` : fabrique du serveur MCP et instructions envoyées au modèle
- `tests/` : tests vitest ; `tests/helpers/app.ts` démarre le vrai serveur sur un port aléatoire

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
- La CI (`.github/workflows/ci.yml`) lance typecheck, tests et build sur chaque PR.
- `package-lock.json` est régénéré et committé par la CI sur la PR quand `package.json` change : certaines sessions de travail n'ont pas accès au registre npm.
