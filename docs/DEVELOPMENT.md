# Développer Isoline

## Prérequis

- **Node.js ≥ 20** et npm ≥ 10.
- macOS pour produire le paquet macOS. Les paquets Windows se construisent aussi depuis macOS (NSIS fourni par electron-builder, sans Wine).
- Aucune installation globale : les dépendances restent dans `node_modules/`, les caches npm, Electron et electron-builder dans `.cache/`.

## Commandes

```bash
npm install            # dépendances locales
npm run dev            # Vite + Electron avec rechargement
npm test               # tests unitaires et d'intégration (Vitest)
npm run test:e2e       # parcours de l'interface dans Electron (Playwright)
npm run typecheck      # tsc strict + svelte-check
npm run lint           # ESLint, aucun avertissement toléré

npm run build          # renderer (dist-renderer/) + processus principal (dist-electron/)
npm run package:all    # dist/ : macOS universel (.dmg, .zip), Windows (installeur, portable)
npm run release        # mainteneur : paquets signés et notarisés, tag et version GitHub
```

Le paquet macOS est signé avec l'identité Developer ID du mainteneur (`electron-builder.yml`). Sans elle, construisez avec `npx electron-builder --mac -c.mac.identity=null`.

### Contenus générés (versionnés)

| Commande | Produit |
|---|---|
| `npm run maps` | Cartes de `assets/maps/` depuis Natural Earth (`npm run maps -- europe,world` pour n'en refaire que certaines) |
| `npm run brand` | Logo, icônes, fond du DMG, palettes (`brand/`) |
| `npm run media` | Bande-annonce et extraits du README (`docs/media/`), voir plus bas |
| `npm run audio:sfx` / `audio:music` | Bruitages (Freesound, CC0) et musique (Kevin MacLeod, CC BY 4.0) |
| `npm run audio:voice` | Narration de la campagne, synthétisée en local (Kokoro) |

La voix demande un environnement Python local au projet :

```bash
python3 -m venv .tools/venv && .tools/venv/bin/pip install kokoro-onnx soundfile
mkdir -p .cache/tts && cd .cache/tts
curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
```

### Bande-annonce

`npm run media` filme le vrai jeu puis monte le film en code :

1. `scripts/press/footage.mjs` lance l'application, joue une partie scénarisée par le crochet `?automation` et filme chaque plan sans interface (1920×1080, 30 i/s) dans `.cache/press/footage/`.
2. `scripts/press/trailer/trailer.js` compose le film image par image sur un canvas : symbole tracé, titres, fondus, aux couleurs de la marque. `render.mjs` le rend dans Chromium et l'encode avec la musique du jeu, puis en tire `trailer.mp4` et les extraits WebP du README.

Pour retoucher le montage sans tout refaire : `node scripts/press/trailer/render.mjs --stills 8,25.5` (images isolées) ou `--from 20 --to 30` (aperçu d'un passage).

## Lancement automatisé

- `--smoke-test` : ouvre l'écran titre puis quitte avec le code 0 (`npm run verify:packages`).
- `ISOLINE_USER_DATA=<dossier>` : dossier de données isolé.
- `ISOLINE_QUERY="autostart=europe&nations=30&spectate&speed=4"` lance directement une partie. Paramètres : `autostart`, `nations`, `tribes`, `spawn`, `mode`, `difficulty`, `fog`, `gold`, `startGold`, `seed`, `spectate`, `speed`, `zoom`, `x`, `y`, `perf`, `screen`, `automation`.

## Architecture

```
src/core/      simulation déterministe pure (sans DOM), exécutable sous Node
  map/ game/ rules/ buildings/ units/ npc/ (IA) net/ (commandes, hash, snapshots)
src/engine/    Worker de simulation, protocole, tours lockstep, replays
src/render/    PixiJS v8 + shaders GLSL (carte), unités, effets, caméra
src/ui/        Svelte 5 : écrans, HUD, i18n FR/EN, campagne, éditeur
src/audio/     musique adaptative, bruitages, narration
src/server/    serveur LAN lockstep embarqué (ws), découverte UDP
src/desktop/   processus principal Electron, stockage, mises à jour, journal de bug
tests/         Vitest (unit/) et Playwright (e2e/)
scripts/       build, paquets, publication, cartes, marque, médias, équilibrage
```

- **Simulation** : 10 ticks/s dans un Web Worker, PRNG xoshiro128\*\* initialisé par graine, aucun `Math.random` dans `src/core` (règle ESLint). L'état se vérifie par hash et se restaure par snapshot.
- **Réseau** : lockstep. L'hôte relaie les tours, garde une simulation de référence pour valider les commandes, détecte une désynchronisation et renvoie un snapshot. Hôte et joueurs doivent avoir la même version.
- **Règles** : toutes les valeurs chiffrées sont dans [`GAME_DESIGN.md`](../GAME_DESIGN.md).
