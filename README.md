# mealie-mcp

Serveur MCP pour piloter [Mealie](https://github.com/mealie-recipes/mealie) depuis Claude (claude.ai web, mobile, desktop et Claude Code), sans casser les ingrédients structurés.

Chaque personne se connecte avec son propre token API Mealie, passé dans l'en-tête `Authorization` du connecteur. Le serveur ne stocke rien.

> En construction : le serveur répond au protocole MCP mais n'expose encore aucun outil.

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

Le serveur refuse de démarrer si une variable est absente ou invalide, et liste tous les problèmes d'un coup.

## Routes

- `POST /mcp` : point d'entrée MCP (Streamable HTTP, sans état)
- `GET /healthz` : répond `ok`, pour les sondes de santé

## Développement

```sh
npm test            # tests unitaires et de bout en bout
npm run typecheck
npm run build       # compile dans dist/
npm start           # lance la version compilée
```
