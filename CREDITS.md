# Crédits et licences

Isoline est un projet personnel, sans but commercial, ouvertement inspiré d'OpenFront. Le code est sous licence [GNU AGPL v3](LICENSE) ; l'origine du projet et les conditions reprises d'OpenFront sont détaillées dans [`NOTICE.md`](NOTICE.md). Les icônes, drapeaux, polices, bruitages, musiques, photos de presse et la voix de synthèse proviennent des sources libres listées ci-dessous.

## Origine du projet

| Élément | Rôle | Licence | Lien |
|---|---|---|---|
| OpenFront | Inspiration principale : le genre, les règles et leurs valeurs ; une partie du code de simulation en est traduite (© OpenFront and Contributors) | AGPL v3 | https://github.com/openfrontio/OpenFrontIO |
| Territorial.io | Inspiration d'origine du genre, qui a inspiré OpenFront ; rien n'en est repris | — | https://territorial.io |
| Claude Opus 5.5 (Anthropic) | Tout le code, la marque et les cartes, en vibe coding | — | https://www.anthropic.com |
| Lippou | Idée, direction du projet, tests et retours (sans écrire de code) | — | https://github.com/Lippou |

**Cartes.** Aucun fichier de carte d'OpenFront n'est utilisé : les cartes réelles sont rastérisées depuis Natural Earth (domaine public), les autres dessinées en code. Mais une bonne partie du catalogue reprend volontairement celui d'OpenFront (Monde, Monde géant et ses grandes régions, Europe, Mer Noire, les continents, Pangée, Mars…), sur les mêmes régions : ces cartes lui ressemblent donc beaucoup.

**Ce qui est propre à Isoline** : la direction artistique (carte réaliste, interface façon journal, logo, voir `BRAND.md`), et ce qui n'existe pas dans OpenFront, dont les lignes de front, la campagne narrée, la météo, la nuit, les technologies, les révolutions, l'aviation et le conseil mondial (`GAME_DESIGN.md`).

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
| `crowd` | « CRWDBatl_Crowd Commotion, Battle, Riot » | ShangusBurger | CC0 1.0 | https://freesound.org/people/ShangusBurger/sounds/764265/ |
| `drums` | « Military Snaredrum » | aUREa | CC0 1.0 | https://freesound.org/people/aUREa/sounds/475246/ |

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
| « 1985 Mexico Earthquake - Nuevo Leon building 2 » | M. Çelebi, United States Geological Survey | [Domaine public](https://commons.wikimedia.org/wiki/Template:PD-USGov-USGS) (œuvre du gouvernement fédéral américain) | Séisme (`earthquake`) | https://commons.wikimedia.org/wiki/File:1985_Mexico_Earthquake_-_Nuevo_Leon_building_2.jpg | recadrage 3:2, réduction, bichromie, grain |
| « MSH80 eruption mount st helens 05-18-80 » | Austin Post, U.S. Geological Survey | [Domaine public](https://commons.wikimedia.org/wiki/Template:PD-USGov-Interior-USGS) (œuvre du gouvernement fédéral américain) | Éruption volcanique (`volcano`) | https://commons.wikimedia.org/wiki/File:MSH80_eruption_mount_st_helens_05-18-80.jpg | recadrage 3:2 sur le panache, réduction, bichromie, grain |
| « US Navy 050709-N-0000B-005 Hurricane Dennis batters palm trees and floods parts of Naval Air Station (NAS) Key West's Truman Annex » | Jim Brooks, U.S. Navy | [Domaine public](https://commons.wikimedia.org/wiki/Template:PD-USGov-Military-Navy) (œuvre du gouvernement fédéral américain) | Ouragan (`hurricane`) | https://commons.wikimedia.org/wiki/File:US_Navy_050709-N-0000B-005_Hurricane_Dennis_batters_palm_trees_and_floods_parts_of_Naval_Air_Station_(NAS)_Key_West%27s_Truman_Annex.jpg | recadrage 3:2, réduction, bichromie, grain |
| « JR65 Talvisodassa - Paluu rintamalta Kuhmosta » | Auteur inconnu, archives photographiques des forces armées finlandaises (SA-kuva) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Hiver rigoureux (`harshWinter`) | https://commons.wikimedia.org/wiki/File:JR65_Talvisodassa_-_Paluu_rintamalta_Kuhmosta.jpg | recadrage 3:2, réduction, bichromie, grain |
| « Oil pumpjack in the Permian Basin » | Quintin Soloviev | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Choc pétrolier (`oilShock`) | https://commons.wikimedia.org/wiki/File:Oil_pumpjack_in_the_Permian_Basin.jpg | recadrage 3:2 sur le chevalet, réduction, bichromie, grain |
| « Petrograd. Soldiers on horseback and trams in Nevsky Prospekt. LCCN2011647896 (cropped) » | James Maxwell Pringle (Library of Congress) | [Domaine public](https://commons.wikimedia.org/wiki/Template:PD-old-70-1923) (publiée avant 1923) | Mutineries (`mutiny`) | https://commons.wikimedia.org/wiki/File:Petrograd._Soldiers_on_horseback_and_trams_in_Nevsky_Prospekt._LCCN2011647896_(cropped).jpg | recadrage 3:2, réduction, bichromie, grain |
| « Titan Missile (41980404201) » | Mike McBey (Flickr) | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) | Fièvre de réarmement (`armsRace`) | https://commons.wikimedia.org/wiki/File:Titan_Missile_(41980404201).jpg | recadrage 3:2, réduction, bichromie, grain |
| « Striking railroad men LOC npcc.06846 » | National Photo Company (Library of Congress) | [Domaine public](https://commons.wikimedia.org/wiki/Template:PD-National_Photo_Company) (1922) | Grève du rail (`railStrike`) | https://commons.wikimedia.org/wiki/File:Striking_railroad_men_LOC_npcc.06846.jpg | recadrage 3:2 (sans le bord noir), réduction, bichromie, grain |
| « Microscope (1) » | Photographe inconnu, National Cancer Institute | [Domaine public](https://commons.wikimedia.org/wiki/Template:PD-USGov-HHS-NIH) (œuvre du gouvernement fédéral américain) | Percée scientifique (`breakthrough`) | https://commons.wikimedia.org/wiki/File:Microscope_(1).jpg | réduction, bichromie, grain |
| « Empire State Building MET DP106404 » | Lewis Hine (The Metropolitan Museum of Art) | [CC0](https://creativecommons.org/publicdomain/zero/1.0/) | Grands travaux (`publicWorks`) | https://commons.wikimedia.org/wiki/File:Empire_State_Building_MET_DP106404.jpg | recadrage 3:2 (sans les bords du tirage), réduction, bichromie, grain |
| « 2010 Opening Ceremony - France entering » | Jude Freeman (Flickr) | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) | Jeux mondiaux (`worldGames`) | https://commons.wikimedia.org/wiki/File:2010_Opening_Ceremony_-_France_entering.jpg | recadrage 3:2 sur la délégation, réduction, bichromie, grain |

## Icônes et drapeaux

| Élément | Auteur | Licence | URL |
|---|---|---|---|
| Lucide (icônes d'interface et pictogrammes des bâtiments) | Lucide Contributors | ISC | https://lucide.dev |
| flag-icons (drapeaux nationaux, SVG) | Panayiotis Lipiridis et contributeurs | MIT | https://github.com/lipis/flag-icons |

## Outils de build (non distribués)

electron-builder (MIT), Vite (MIT), esbuild (MIT), TypeScript (Apache-2.0), Vitest (MIT), Playwright (Apache-2.0), ESLint (MIT), Prettier (MIT), lefthook (MIT), opentype.js (MIT), @resvg/resvg-js (MPL-2.0), pngjs (MIT), resedit (MIT), tsx (MIT), ffmpeg-static (binaire FFmpeg, GPL ; utilisé seulement pour monter la bande-annonce et imprimer les photos de presse, non distribué), svelte-check (MIT), typescript-eslint (MIT), NSIS 3.12 (zlib/libpng, via electron-builder).
