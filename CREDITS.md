# Crédits et licences

Isoline est un projet original. Le code est sous licence MIT (voir `LICENSE`). Toutes les images de marque, icônes, sprites, effets sonores et musiques sont **générés par le code du projet** (aucun asset tiers n'est copié).

## Polices (embarquées)

| Asset | Auteur | Licence | URL |
|---|---|---|---|
| Fraunces | Undercase Type (Phaedra Charles, Flavia Zimbardi) | SIL Open Font License 1.1 | https://github.com/undercasetype/Fraunces — paquet `@fontsource/fraunces` |
| IBM Plex Sans | IBM / Mike Abbink, Bold Monday | SIL Open Font License 1.1 | https://github.com/IBM/plex — paquet `@fontsource/ibm-plex-sans` |
| IBM Plex Mono | IBM / Mike Abbink, Bold Monday | SIL Open Font License 1.1 | https://github.com/IBM/plex — paquet `@fontsource/ibm-plex-mono` |

## Bibliothèques (embarquées dans l'application)

| Bibliothèque | Licence | URL |
|---|---|---|
| PixiJS v8 | MIT | https://github.com/pixijs/pixijs |
| Svelte 5 | MIT | https://github.com/sveltejs/svelte |
| ws | MIT | https://github.com/websockets/ws |
| Electron (Chromium, Node.js) | MIT (Chromium : BSD-3 et autres, voir `LICENSES.chromium.html` dans le paquet) | https://github.com/electron/electron |
| fast-png (+ fflate, iobuffer) | MIT | https://github.com/image-js/fast-png |
| Dépendances de PixiJS : earcut (ISC), eventemitter3, @pixi/colord, ismobilejs, parse-svg-path, gifuct-js, tiny-lru, @xmldom/xmldom (MIT) | MIT / ISC | via `pixi.js` |

## Données géographiques

| Données | Auteur | Licence | URL |
|---|---|---|---|
| Natural Earth 1:10m (terres, îles mineures, lacs, glaciers, fleuves, régions géographiques) et 1:50m (pays, pour les noms et positions des nations) | Natural Earth (NACIS) | Domaine public | https://www.naturalearthdata.com — copie GeoJSON : https://github.com/nvkelso/natural-earth-vector |

Les cartes livrées (`assets/maps/`) sont rastérisées par `scripts/maps/build-maps.ts`. L'altitude, les biomes, les gisements, les noms des tribus et les drapeaux sont **synthétisés de façon procédurale** : aucun relief ni drapeau réel n'est reproduit, et les drapeaux des nations sont des emblèmes générés à partir d'une graine. Les noms de nations reprennent des noms de pays ou de régions (faits géographiques, non protégés).

## Sons et musique

Tous les sons et musiques sont **synthétisés en temps réel** par `src/audio/audio.ts` (Web Audio API : oscillateurs, bruit filtré, enveloppes). Aucun échantillon audio n'est embarqué.

## Outils de build (non distribués)

electron-builder (MIT), Vite (MIT), esbuild (MIT), TypeScript (Apache-2.0), Vitest (MIT), Playwright (Apache-2.0), ESLint (MIT), Prettier (MIT), lefthook (MIT), opentype.js (MIT), @resvg/resvg-js (MPL-2.0), pngjs (MIT), resedit (MIT), tsx (MIT), gifenc (MIT), ffmpeg-static (binaire FFmpeg, GPL ; utilisé seulement pour assembler la vidéo de présentation, non distribué), svelte-check (MIT), typescript-eslint (MIT), NSIS 3.12 (zlib/libpng, via electron-builder).

## Inspirations

Le genre (conquête de territoires sur grille) est inspiré de jeux comme OpenFront.io et Territorial.io. **Aucun code, carte, sprite, texte ni son** de ces jeux n'a été repris : Isoline a été écrit de zéro, avec ses propres règles chiffrées (`GAME_DESIGN.md`), sa propre direction artistique (`BRAND.md`) et ses fonctionnalités originales.
