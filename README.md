# mealie-mcp

Serveur MCP pour piloter [Mealie](https://github.com/mealie-recipes/mealie) depuis Claude (claude.ai web, mobile, desktop et Claude Code), sans casser les ingrédients structurés.

Chaque personne se connecte avec son propre token API Mealie, passé dans l'en-tête `Authorization` du connecteur. Le serveur ne stocke rien.

> En construction : un seul outil pour l'instant, `mealie_whoami`.

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
npm test            # tests unitaires et de bout en bout
npm run typecheck
npm run build       # compile dans dist/
npm start           # lance la version compilée
```
