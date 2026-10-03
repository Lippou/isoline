# Crédits et licences

Isoline est un projet original. Le code est sous licence MIT (voir `LICENSE`). Le logo, les cartes, les sprites d'unités et les textures sont créés par le projet. Les icônes, drapeaux, polices, bruitages, musiques, photos de presse et la voix de synthèse proviennent des sources libres listées ci-dessous.

## Polices (embarquées)

| Asset | Auteur | Licence | URL |
|---|---|---|---|
| Fraunces | Undercase Type (Phaedra Charles, Flavia Zimbardi) | SIL Open Font License 1.1 | https://github.com/undercasetype/Fraunces — paquet `@fontsource/fraunces` |
| IBM Plex Sans | IBM / Mike Abbink, Bold Monday | SIL Open Font License 1.1 | https://github.com/IBM/plex — paquet `@fontsource/ibm-plex-sans` |
| IBM Plex Mono | IBM / Mike Abbink, Bold Monday | SIL Open Font License 1.1 | https://github.com/IBM/plex — paquet `@fontsource/ibm-plex-mono` |
| IBM Plex Serif | IBM / Mike Abbink, Bold Monday | SIL Open Font License 1.1 | https://github.com/IBM/plex — paquet `@fontsource/ibm-plex-serif` |

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

Les cartes livrées (`assets/maps/`) sont rastérisées par `scripts/maps/build-maps.ts`. L'altitude, les biomes, les gisements et les noms des tribus sont **synthétisés de façon procédurale**. Les pays réels portent leur vrai drapeau (flag-icons) ; les régions historiques et les nations fictives ont un emblème généré. Les noms de nations reprennent des noms de pays ou de régions (faits géographiques, non protégés).

## Musique

Tous les morceaux : **Kevin MacLeod (incompetech.com)**, *Licensed under Creative Commons: By Attribution 4.0 License* — http://creativecommons.org/licenses/by/4.0/ . Convertis en Ogg Vorbis et normalisés par `scripts/audio/fetch-music.mjs`.

| Morceau | Auteur | Licence | Ambiance |
|---|---|---|---|
| « Lord of the Land » | Kevin MacLeod (incompetech.com) | CC BY 4.0 | menu |
| « Lasting Hope » | Kevin MacLeod (incompetech.com) | CC BY 4.0 | calm |
| « Unwritten Return » | Kevin MacLeod (incompetech.com) | CC BY 4.0 | calm |
| « Reawakening » | Kevin MacLeod (incompetech.com) | CC BY 4.0 | calm |
| « Gathering Darkness » | Kevin MacLeod (incompetech.com) | CC BY 4.0 | tension |
| « Interloper » | Kevin MacLeod (incompetech.com) | CC BY 4.0 | tension |
| « Five Armies » | Kevin MacLeod (incompetech.com) | CC BY 4.0 | war |
| « Prelude and Action » | Kevin MacLeod (incompetech.com) | CC BY 4.0 | war |
| « Volatile Reaction » | Kevin MacLeod (incompetech.com) | CC BY 4.0 | war |
| « Clash Defiant » | Kevin MacLeod (incompetech.com) | CC BY 4.0 | war |
| « Heroic Age » | Kevin MacLeod (incompetech.com) | CC BY 4.0 | victory |
| « Lightless Dawn » | Kevin MacLeod (incompetech.com) | CC BY 4.0 | defeat |

## Bruitages

Enregistrements réels publiés sur Freesound sous **Creative Commons 0** (domaine public). Ils sont découpés, atténués et normalisés par `scripts/audio/fetch-sfx.mjs`.

| Son | Titre | Auteur | Licence | Source |
|---|---|---|---|---|
| `coin` | « Money Bag » | PhilSavlem | CC0 1.0 | https://freesound.org/people/PhilSavlem/sounds/338260/ |
| `coinSmall` | « Coin dropping.wav » | Jace | CC0 1.0 | https://freesound.org/people/Jace/sounds/17502/ |
| `conquest` | « sword-01.wav » | audione | CC0 1.0 | https://freesound.org/people/audione/sounds/52458/ |
| `attack` | « unsheath_sword.wav » | Qat | CC0 1.0 | https://freesound.org/people/Qat/sounds/107589/ |
| `build` | « hammering 2.wav » | cognito perceptu | CC0 1.0 | https://freesound.org/people/cognito perceptu/sounds/17012/ |
| `siren` | « Nuclear Alarm » | radio_illuminati | CC0 1.0 | https://freesound.org/people/radio_illuminati/sounds/206141/ |
| `launch` | « Far Away Rocket Launch » | qubodup | CC0 1.0 | https://freesound.org/people/qubodup/sounds/211617/ |
| `explosionA` | « Explosion_01.wav » | tommccann | CC0 1.0 | https://freesound.org/people/tommccann/sounds/235968/ |
| `explosionH` | « Huge Explosion » | unfa | CC0 1.0 | https://freesound.org/people/unfa/sounds/259300/ |
| `explosionSmall` | « Muffled Distant Explosion » | NenadSimic | CC0 1.0 | https://freesound.org/people/NenadSimic/sounds/149966/ |
| `intercept` | « bad explosion » | deleted_user_364925 | CC0 1.0 | https://freesound.org/people/deleted_user_364925/sounds/47252/ |
| `cannon` | « cannon.mp3 » | Kneeling | CC0 1.0 | https://freesound.org/people/Kneeling/sounds/448002/ |
| `sunk` | « Splash » | swordofkings128 | CC0 1.0 | https://freesound.org/people/swordofkings128/sounds/398032/ |
| `horn` | « ship horn very close » | tierrafilm@gmail.com | CC0 1.0 | https://freesound.org/people/tierrafilm@gmail.com/sounds/420716/ |
| `train` | « Steam Whistle.mp3 » | Bidone | CC0 1.0 | https://freesound.org/people/Bidone/sounds/71778/ |
| `alliance` | « PEN SIGNATURE SIGNING 2 » | ListenTonyBoy | CC0 1.0 | https://freesound.org/people/ListenTonyBoy/sounds/326961/ |
| `betrayal` | « Orchestral Hit - The Villain Appears » | Dredile | CC0 1.0 | https://freesound.org/people/Dredile/sounds/164273/ |
| `event` | « Church bell.wav » | Audeption | CC0 1.0 | https://freesound.org/people/Audeption/sounds/425172/ |
| `victory` | « Success Fanfare Trumpets.mp3 » | FunWithSound | CC0 1.0 | https://freesound.org/people/FunWithSound/sounds/456966/ |
| `defeat` | « Timpani C2 » | Terry93D | CC0 1.0 | https://freesound.org/people/Terry93D/sounds/369394/ |
| `eliminated` | « Cinematic Hit With Horns.wav » | DeVern | CC0 1.0 | https://freesound.org/people/DeVern/sounds/427803/ |
| `warHorn` | « Battle_horn_1.wav » | kirmm | CC0 1.0 | https://freesound.org/people/kirmm/sounds/392180/ |
| `click` | « Mouse Click Sound.mp3 » | Pixeliota | CC0 1.0 | https://freesound.org/people/Pixeliota/sounds/678248/ |
| `open` | « Page Turn 01 » | LilMati | CC0 1.0 | https://freesound.org/people/LilMati/sounds/397548/ |
| `confirm` | « traditional stamp.wav » | I.fekry | CC0 1.0 | https://freesound.org/people/I.fekry/sounds/470710/ |
| `error` | « door_knock.wav » | wjtaylor | CC0 1.0 | https://freesound.org/people/wjtaylor/sounds/268500/ |
| `paper` | « rustling paper.wav » | keweldog | CC0 1.0 | https://freesound.org/people/keweldog/sounds/181774/ |

## Voix du conseiller (campagne et didacticiel)

| Élément | Auteur | Licence | URL |
|---|---|---|---|
| Kokoro TTS v1.0 (modèle de synthèse vocale, exécuté localement) | hexgrad | Apache 2.0 | https://huggingface.co/hexgrad/Kokoro-82M |
| kokoro-onnx (moteur d'inférence) | thewh1teagle | MIT | https://github.com/thewh1teagle/kokoro-onnx |
| Voix française `ff_siwis` (entraînée sur SIWIS French Speech Synthesis Database) | Kokoro / SIWIS (Univ. of Edinburgh, Idiap) | Apache 2.0 / CC BY 4.0 | https://datashare.ed.ac.uk/handle/10283/2353 |

Les fichiers audio sont générés par `scripts/audio/gen-voice.py` à partir des textes de `src/ui/i18n/`.

## Photographies de presse (événements mondiaux)

Chaque événement mondial est illustré dans les articles du Courrier (Flash info, journal, une de fin de partie) par une vraie photographie de **Wikimedia Commons**, sous licence libre vérifiée dans les métadonnées du fichier (domaine public ou Creative Commons Attribution). `scripts/press/build-photos.ts` télécharge les originaux, contrôle leur licence et leur auteur, puis les **modifie** : recadrage au format 3:2, réduction à 768 × 512 px, impression en bichromie (encre marine `#172A3C` sur papier `#F1ECE2`), rouges de l'original reportés en magenta (crise seulement), léger grain de papier, export WebP (`public/press/`). Les images modifiées restent sous la licence de leur original.

| Photo (titre sur Wikimedia Commons) | Auteur | Licence | Événement | Source | Modifications |
|---|---|---|---|---|---|
| « Electronic stock board in Yaesu, Tokyo 2007 » | nappa (Flickr) | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) | Crise économique mondiale (`crisis`) | https://commons.wikimedia.org/wiki/File:Electronic_stock_board_in_Yaesu,_Tokyo_2007.jpg | recadrage 3:2, réduction, bichromie, chiffres rouges en magenta, grain |
| « Connecticut National Guard sets up federal medical station equipment at Southern Connecticut State University (8) » | Staff Sgt. Steven Tucker, U.S. Air National Guard | [Domaine public](https://commons.wikimedia.org/wiki/Template:PD-USGov-Military-National_Guard) (œuvre du gouvernement fédéral américain) | Pandémie mondiale (`pandemic`) | https://commons.wikimedia.org/wiki/File:Connecticut_National_Guard_sets_up_federal_medical_station_equipment_at_Southern_Connecticut_State_University_(8).jpg | recadrage 3:2 (sans le drapeau), réduction, bichromie, grain |
| « Container crane @ Container terminal @ Harbour Tour @ Spido @ Rotterdam » | Guilhem Vellut (Flickr) | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) | Boom commercial (`boom`) | https://commons.wikimedia.org/wiki/File:Container_crane_@_Container_terminal_@_Harbour_Tour_@_Spido_@_Rotterdam_(30530447836).jpg | réduction, bichromie, grain |
| « 220305-F-EI268-1046 - Arctic sky illuminates Patriot (Image 1 of 2) » | Senior Airman Joseph Leveille, U.S. Air Force | [Domaine public](https://commons.wikimedia.org/wiki/Template:PD-USGov-Military-Air_Force) (œuvre du gouvernement fédéral américain) | Tempête solaire (`solarStorm`) | https://commons.wikimedia.org/wiki/File:220305-F-EI268-1046_-_Arctic_sky_illuminates_Patriot_(Image_1_of_2).jpg | recadrage 3:2, réduction, bichromie, grain |
| « United Nations Headquarters - Security Council chamber, angled view (cropped) » | Jdforrester | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Sommet de la paix (`peaceSummit`) | https://commons.wikimedia.org/wiki/File:United_Nations_Headquarters_-_Security_Council_chamber,_angled_view_(cropped).jpg | recadrage 3:2 sur la table du Conseil, réduction, bichromie, grain |

## Icônes et drapeaux

| Élément | Auteur | Licence | URL |
|---|---|---|---|
| Lucide (icônes d'interface et pictogrammes des bâtiments) | Lucide Contributors | ISC | https://lucide.dev |
| flag-icons (drapeaux nationaux, SVG) | Panayiotis Lipiridis et contributeurs | MIT | https://github.com/lipis/flag-icons |

## Outils de build (non distribués)

electron-builder (MIT), Vite (MIT), esbuild (MIT), TypeScript (Apache-2.0), Vitest (MIT), Playwright (Apache-2.0), ESLint (MIT), Prettier (MIT), lefthook (MIT), opentype.js (MIT), @resvg/resvg-js (MPL-2.0), pngjs (MIT), resedit (MIT), tsx (MIT), gifenc (MIT), ffmpeg-static (binaire FFmpeg, GPL ; utilisé seulement pour assembler la vidéo de présentation et imprimer les photos de presse, non distribué), svelte-check (MIT), typescript-eslint (MIT), NSIS 3.12 (zlib/libpng, via electron-builder).

## Inspirations

Le genre (conquête de territoires sur grille) est inspiré de jeux comme OpenFront.io et Territorial.io. **Aucun code, carte, sprite, texte ni son** de ces jeux n'a été repris : Isoline a été écrit de zéro, avec ses propres règles chiffrées (`GAME_DESIGN.md`), sa propre direction artistique (`BRAND.md`) et ses fonctionnalités originales.
