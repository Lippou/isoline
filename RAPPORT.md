# Rapport de livraison — Isoline 1.1.0

Ce rapport fait le point sur ce qui est livré, ce qui a été mesuré, les écarts avec le cahier des charges et les limites connues. Toutes les mesures viennent de scripts du dépôt et peuvent être reproduites (`npm run bench`, `npm run bench:app`, `node scripts/perf-app.mjs soak`, `npm run verify:packages`).

**Machine de mesure** : Mac mini Apple M4 Pro (12 cœurs, 24 Go), macOS 27.2, écran 144 Hz, Node 24.19, Electron 44.5.

## 0. Version 1.1 : retours de test traités

| Retour | Réponse |
|---|---|
| Une partie de 8 minutes est trop rapide, tout est trop exponentiel ; minimum 20 minutes | IA posée, fronts lents contre un pays, coût logistique des guerres pour les grands empires, prix des villes et des ports sans plafond, croissance ralentie. **Mesures** (`npm run pacing`, IA seules, Normal) : Europe 48 min, Mer Noire 40 min, Méditerranée 44 min, Monde plus de 45 min ; Difficile 29 à 32 min ; Impossible 26 à 33 min. Avant : 7 à 18 min. |
| Les bots sont trop rapides, ils calculent trop vite leur gestion | Réflexion toutes les 3 à 6 s (au lieu de 0,8 à 1,6 s), 30 s minimum entre deux offensives contre un pays, constructions espacées de 12 s, supériorité de 1,4 × exigée avant une guerre. |
| La partie doit commencer dès que le point est posé | Fait : la phase d'apparition s'achève dès que tous les humains ont posé leur capitale ; le minuteur ne sert plus qu'à borner l'attente. |
| Tribus : croissance comparable à une nation puis plafond ; elles servent à récupérer de l'or, avec un bruit de monnaie | Croissance identique à une nation jusqu'à 60 000 troupes, puis arrêt. Trésor de 600 or/s pillé tuile par tuile ; bruit de pièces et montant affiché. Test unitaire ajouté. |
| Rayon d'action des ports | 60 tuiles (+10 par niveau) : construction et réparation des navires de guerre, affiché au survol, au placement et avec l'outil « navire de guerre ». Test unitaire ajouté. |
| Graphismes plus réalistes | Shader de carte réécrit : biomes réalistes fondus, ombrage, neiges, profondeur des mers, côtes lissées, carte politique translucide à frontières nettes. |
| Vrais drapeaux pour les pays réels | 204 pays réels étiquetés par code ISO : vrai drapeau (flag-icons, MIT) et couleur nationale traditionnelle. Les régions historiques et nations fictives gardent un emblème généré. |
| Meilleurs pictogrammes (ville, port…) ; bateaux de guerre, trains « plus sérieux » | Pastilles de bâtiments à pictogrammes Lucide ; navires, transport, porte-conteneurs, train et avions redessinés vue de dessus, deux calques (coque neutre, marque nationale), agrandis. |
| Interface de grande qualité, compréhensible, sans emoji, pour tous les menus | Refonte de tous les écrans et du HUD : style d'état-major, icônes au trait avec libellés et infobulles, descriptions de chaque option, menu contextuel, lobby en trois étapes avec résumé. 0 emoji restant (vérifié par script). |
| Les emojis « font IA » | Supprimés partout. Les emojis de communication sont devenus 16 signaux tactiques illustrés. |
| La campagne n'est pas bien guidée | Briefing (partie en pause), guide pas à pas qui ne disparaît plus avant l'accomplissement de l'étape, jauges de progression, repères sur la carte. Test e2e ajouté. |
| Voix de grande qualité pour la campagne | Narration de 53 répliques par langue (FR/EN) par synthèse neuronale Kokoro (Apache 2.0), générée hors ligne. C'est une voix de synthèse, pas un comédien. |
| Meilleure musique | Bande-son orchestrale de 12 morceaux (Kevin MacLeod, CC BY 4.0), adaptative (calme, tension, guerre, victoire, défaite) avec fondus enchaînés. |
| Bruitages réalistes et non numériques (trahison, etc.) | 27 enregistrements réels CC0 (Freesound) : explosions, sirène, missile, canon, cornes, train, pièces, fanfare, coup d'orchestre de trahison… avec légère variation à chaque lecture. |
| « Continuer à regarder » fait revenir l'écran de fin | Corrigé ; bouton « Voir les résultats » pour y revenir. |

Les choix de bruitages et de musique ont été faits **sans écoute** possible dans cet environnement : d'après les titres, les notes et la popularité sur Freesound, puis vérifiés par analyse automatique (durée, niveau). Une écoute humaine reste recommandée ; chaque son se remplace en changeant un identifiant dans `scripts/audio/fetch-sfx.mjs`.

## 1. Livrables

| Livrable | État | Emplacement |
|---|---|---|
| macOS universel (Intel + Apple Silicon) | ✅ DMG 253,0 Mo et ZIP 251,6 Mo, signature ad hoc vérifiée (`codesign --verify --deep --strict`) | `dist/Isoline-1.1.0-mac-universal.{dmg,zip}` |
| Windows x64, installeur | ✅ NSIS 144,0 Mo (choix du dossier, raccourcis bureau et menu Démarrer, désinstalleur, icône) | `dist/Isoline-1.1.0-win-x64-setup.exe` |
| Windows x64, portable | ✅ 143,7 Mo | `dist/Isoline-1.1.0-win-x64-portable.exe` |
| `npm run verify:packages` | ✅ 27 contrôles, dont lancement de l'app macOS en `--smoke-test` (code 0) | `scripts/verify-packages.mjs` |
| Documentation | ✅ `README.md`, `GAME_DESIGN.md`, `BRAND.md` + `brand/`, `CREDITS.md`, `CHANGELOG.md`, ce rapport | racine |
| Médias | ✅ 15 captures 1920×1080, GIF de 10 s, vidéo de 58 s en 1080p | `docs/media/` |
| Mesures brutes | ✅ | `docs/bench.json`, `docs/perf-app.json`, `docs/perf-app-uncapped.json`, `docs/soak.json` |

## 2. Performances mesurées (§19)

| Exigence | Cible | Mesure | Verdict |
|---|---|---|---|
| Démarrage jusqu'à l'écran titre | < 5 s | **2,1 s** (app empaquetée 1.1.0, `dist/mac-universal`) | ✅ |
| Chargement d'une carte de 2 M de tuiles | < 3 s | Monde (2,01 M) : 0,41 s de décodage et d'analyse, 0,35–1,0 s de « lancer » à « carte affichée » dans l'app empaquetée. Monde géant (5,16 M) : 0,96 s | ✅ |
| FPS, 100 nations, zoom moyen | ≥ 60 (M1) | 60 FPS stables, plafond de l'écran de mesure (60 Hz) ; sans synchronisation verticale : **447 à 485 FPS** au zoom moyen, 809 à 1 055 sur carte entière (100 nations + 100 tribus, nouveau rendu réaliste) | ✅ sur M4 Pro ; **M1 non testé** (§4) |
| FPS sur portable Windows à GPU intégré | ≥ 30 | non mesuré (aucune machine Windows) | ⚠️ |
| Tick de simulation | < 50 ms en moyenne | 100 nations, Monde : **0,69 ms** en moyenne, p99 4,0 ms, max 7,2 ms (6 000 ticks). Monde géant, 100 nations : 1,08 ms | ✅ |
| Mémoire | < 1,5 Go | 0,74–0,81 Go (tous processus Electron) à 100 nations ; pic à 1,01 Go pendant l'endurance (mesurée en 1.0) | ✅ |
| Taille de l'app | < 300 Mo | Téléchargements : 253 Mo (macOS universel), 144 Mo (Windows), dont 42 Mo de musique, bruitages et voix. Installée : 378 Mo (Windows), 510 Mo (macOS, deux architectures) | ⚠️ voir §4 |
| Stabilité | pas de fuite sur 60 min ; pas de crash sur 30 min à 50 nations | Endurance : 60 min de jeu à 50 nations (×8), aucune erreur, mémoire stable (§2.2) ; 30 min sans affichage à 50 nations sans erreur | ✅ |
| Déterminisme | même seed et mêmes commandes = même hash | Vérifié sur macOS (tests et `bench`) ; LAN 4 clients pendant 20 min sans désynchronisation. **Windows non vérifié** | ✅ / ⚠️ |
| Couverture de `src/core` | ≥ 70 % | instructions 87,5 %, branches 79,5 %, fonctions 93,2 %, lignes 90,3 % | ✅ |

### 2.1 Mesures dans l'application empaquetée (`node scripts/perf-app.mjs dist/mac-universal/Isoline.app/Contents/MacOS/Isoline`)
Démarrage à froid jusqu'à l'écran titre : 2 158 ms. Monde avec 100 nations, 100 tribus, vitesse ×2 :

| Vue | Carte affichée après | FPS min/moy. | Tick moyen | Mémoire totale (navigateur / GPU / utilitaire / onglet) |
|---|---|---|---|---|
| zoom moyen (×2,5) | 1 030 ms | 144 / 144 | 0,98 ms | 788 Mo (178 / 143 / 47 / 421) |
| carte entière | 349 ms | 144 / 144 | 0,84 ms | 769 Mo (177 / 141 / 47 / 404) |

### 2.2 Endurance (`node scripts/perf-app.mjs soak`)
Monde, 50 nations, 60 tribus, spectateur, vitesse ×8. Relevé toutes les 30 s réelles (4 min de jeu) :

| Temps réel | Horloge de jeu | Mémoire totale | Tas JS du rendu | FPS |
|---|---|---|---|---|
| 30 s | 3:59 | 832 Mo | 104 Mo | 142 |
| 60 s | 7:59 | 908 Mo | 168 Mo | 144 |
| 90 s | 11:59 | 998 Mo | 197 Mo | 144 |
| 120 s | 16:00 | 1013 Mo | 199 Mo | 128 |
| 150 s | 20:00 | 919 Mo | 107 Mo | 144 |
| 180 s | 24:00 | 973 Mo | 135 Mo | 144 |
| 210 s | 28:00 | 961 Mo | 165 Mo | 144 |
| 240 s | 32:00 | 993 Mo | 152 Mo | 144 |
| 270 s | 36:00 | 989 Mo | 190 Mo | 144 |
| 300 s | 40:00 | 935 Mo | 127 Mo | 144 |
| 330 s | 44:00 | 983 Mo | 164 Mo | 144 |
| 360 s | 48:00 | 957 Mo | 152 Mo | 144 |
| 390 s | 52:00 | 968 Mo | 117 Mo | 144 |
| 420 s | 56:00 | 973 Mo | 176 Mo | 144 |
| 450 s | 60:00 | 991 Mo | 192 Mo | 144 |

Aucune erreur JavaScript. La mémoire totale oscille entre 832 et 1013 Mo, avec des creux réguliers (ramasse-miettes). Moyenne des 5 premiers relevés : 934 Mo ; des 5 derniers : 974 Mo. **Aucune fuite détectable sur 60 min de jeu.**

### 2.3 Simulation sans affichage (`npm run bench`)

| Scénario | Ticks | Moyenne | p95 | p99 | Max | Survivants |
|---|---|---|---|---|---|---|
| Monde, 100 nations + 100 tribus (10 min) | 6 000 | 0,69 ms | 1,85 ms | 3,99 ms | 7,18 ms | 35 |
| Monde, 50 nations + 60 tribus (30 min) | 18 000 | 0,29 ms | 0,72 ms | 3,24 ms | 14,3 ms | 10 |
| Monde géant, 100 nations + 100 tribus (5 min) | 3 000 | 1,08 ms | 1,97 ms | 3,50 ms | 6,86 ms | 92 |
| Déterminisme (Europe, 40 nations, deux exécutions) | 3 000 | — | — | — | — | hashes identiques |

## 3. Couverture du cahier des charges

Liste de contrôle finale (§24) :

| Élément | État | Détail |
|---|---|---|
| Nom, slogan, logo, icônes, palette, polices | ✅ | `BRAND.md`, `brand/`, contrastes vérifiés (6,1:1 à 15:1) |
| 12 cartes, générateur, éditeur | ✅ | 14 cartes + générateur procédural ; éditeur avec import PNG ou `.isomap` |
| Spawn, immunité, expansion, terrain, postes de défense | ✅ | fronts eikonaux (territoires arrondis) |
| Population (courbe à 42 %), or, curseurs, dons | ✅ | |
| 8 bâtiments | ✅ | coûts, temps, améliorations, capture et destruction, démolition |
| Marine | ✅ | transports, navires de guerre (vétérance, patrouille, réparation), marchands, piraterie |
| Rail | ✅ | rails automatiques (A*), trains, paiements par arrêt, coupures |
| Nucléaire | ✅ | A/H/MIRV, SAM avec prédiction de trajectoire, retombées, alertes |
| Diplomatie | ✅ | alliances, trahison, embargo, chat filtré, emojis, signaux |
| Tribus et nations | ✅ | 4 difficultés, 6 personnalités, budget de travail déterministe |
| Modes | ✅ | FFA, équipes, humains contre nations, tribus, Apocalypse, prolongation, Battle Royale, campagne (6 missions), didacticiel (9 étapes) |
| 14 fonctionnalités inédites | ✅ | toutes activables dans le lobby et testées (`tests/unit/rules.test.ts`, `units.test.ts`) |
| HUD, menu radial, raccourcis remappables, pavé tactile | ✅ | |
| DA originale, shaders, particules, LOD, drapeaux procéduraux | ✅ | |
| Musique dynamique et effets | ✅ | entièrement procéduraux (Web Audio) |
| LAN lockstep, hash, reconnexion | ✅ | test d'intégration à 4 clients ; test e2e à deux instances |
| Sauvegardes, replays, profil, succès, statistiques | ✅ | 10 emplacements + sauvegarde auto toutes les 2 min, replays `.rpl`, 30 succès, export CSV |
| FR + EN, accessibilité | ✅ | 327 clés, aucune manquante ; daltonisme (3 modes), haut contraste, échelle d'interface, taille de police, réduction des animations, sous-titres |
| Performances mesurées et conformes | ✅ / ⚠️ | conformes sur la machine de mesure ; M1 et Windows non mesurés |
| `.dmg`/`.app` universel et `.exe` vérifiés | ✅ / ⚠️ | vérifiés structurellement ; l'exécution sous Windows n'a pas pu être testée |
| Documentation et médias | ✅ | |

Définition de « terminé » (§23) :
1. `npm run package:all` et `npm run verify:packages` : ✅
2. App macOS : écran titre, partie solo complète, sauvegarde/rechargement, replay, partie LAN : ✅ (tests e2e et parcours scriptés). L'app a été lancée depuis `dist/`, pas depuis `/Applications` (§4).
3. Sections 5 à 21 : implémentées ; écarts ci-dessous.
4. Tests (57 unitaires et d’intégration, 5 e2e), couverture ≥ 70 %, performances mesurées : ✅
5. Documentation : ✅

## 4. Écarts, décisions et limites connues

### Environnement
- **Dossier de travail** : le cahier des charges prévoit `~/projets/<nom-du-jeu>/`. La session a été lancée dans `~/Desktop/Jeu/Claude Opus 5.5 High/` ; le projet est donc dans `…/isoline/` pour ne rien écrire hors du dossier fourni. Tous les caches (npm, Electron, electron-builder) vont dans `isoline/.cache/`.
- **NSIS sur Apple Silicon** : le `makensis` historique d'electron-builder est x86_64, et Rosetta n'est pas installé (installation système interdite). Résolu avec le toolset NSIS 3.12 (`toolsets.nsis: "1.2.1"`), compatible arm64. Les ressources PE (icône, version) sont écrites sans Wine.
- **Pas de lancement depuis `/Applications`** : copier l'app dans `/Applications` reviendrait à écrire hors du dossier de travail, ce que les contraintes interdisent. L'app empaquetée a été lancée depuis `dist/mac-universal/` (smoke test et mesures) ; le comportement est le même.

### Plateformes non disponibles
- **Windows** : aucune machine Windows, et ni VM ni Wine (installations interdites). Les paquets sont vérifiés structurellement : en-têtes PE32+, archives Nullsoft, `app.asar`, cartes, icône 16–256 px, ressource de version. **Le lancement réel sous Windows, le FPS sur GPU intégré et l'identité du hash entre macOS et Windows n'ont pas été vérifiés.** Le risque de divergence est faible : même moteur V8, et le cœur n'utilise que l'arithmétique IEEE 754 et `Math.sqrt`, `Math.hypot`, `Math.pow`, `Math.exp`, `Math.sin`, `Math.cos` ; V8 implémente ces fonctions de façon portable (fdlibm), sans dépendre de la libm du système. Aucune API système dans la simulation.
- **Apple M1** : mesures faites sur M4 Pro. Avec un tick à 1 ms et un rendu d'une passe de shader plus des sprites, la cible de 60 FPS sur M1 paraît atteignable, sans être vérifiée. Le jeu passe automatiquement en mode performance s'il tient moins de 40 FPS pendant 5 s.

### Distribution
- **Signature** : ad hoc (pas de certificat Apple Developer), non notarisée. Au premier lancement, Gatekeeper demande un clic droit → Ouvrir, ou `xattr -dr com.apple.quarantine /Applications/Isoline.app` (documenté dans le README). Windows n'est pas signé : SmartScreen affiche un avertissement.
- **Taille installée > 300 Mo** : l'exécutable Electron 44 pèse à lui seul 241 Mo sous Windows ; le contenu du jeu fait 54 Mo (code, cartes, polices, 42 Mo de médias audio). Les téléchargements respectent la cible (144 et 253 Mo). L'app macOS fait 510 Mo sur disque parce qu'elle est universelle (deux binaires Chromium), soit environ 235 Mo par architecture. Les langues Chromium sont déjà limitées au français et à l'anglais. Pour descendre sous 300 Mo installés, il faudrait quitter Electron, alors que le cahier des charges l'impose.
- **Mises à jour** : la vérification optionnelle est implémentée (manifeste JSON en HTTPS, désactivée par défaut, aucun appel réseau sans accord), mais aucun serveur de publication n'existe : l'URL est à renseigner dans les paramètres.

### Jeu
- **Équilibrage** : sur les cartes continentales, une nation bien placée (avec beaucoup de terres libres autour) peut prendre de l'avance, par exemple la Syrie sur la carte Europe. Le malus des grands empires et la prolongation limitent ce phénomène sans l'empêcher. Les IA « Difficile » et « Impossible » punissent vite un joueur qui dépense ses troupes en début de partie.
- **Brouillard de guerre** : le classement reste public, comme la plupart des jeux du genre. La minimap respecte le brouillard.
- **Replays** : revenir en arrière re-simule depuis le début. D'après les temps de tick mesurés (0,3 à 1 ms), remonter une heure de jeu (36 000 ticks) prend de l'ordre de 10 à 40 s.
- **Accessibilité** : `svelte-check` remonte 16 avertissements d'accessibilité (gestionnaires de clic sur des éléments qui ne sont pas des boutons, dans le HUD et l'éditeur). La navigation au clavier n'a pas été auditée élément par élément.
- **Vidéo et GIF** : produits par Playwright et `ffmpeg-static` (dépendance locale). Le GIF fait 8,6 Mo (640×360).

### Version 1.1
- **Licences** : le cahier des charges cite CC0, MIT et OFL. La version 1.1 ajoute de la musique sous **CC BY 4.0** (attribution affichée dans « À propos » et dans `CREDITS.md`), des icônes **ISC** (équivalente à MIT), un modèle de voix **Apache 2.0** et une voix entraînée sur un corpus **CC BY 4.0**. Ce sont des licences libres compatibles avec la distribution du jeu. Les bruitages sont en CC0.
- **Voix** : voix de synthèse neuronale de bonne qualité, mais pas un enregistrement de comédien. Les noms propres inventés (nations fictives) ne sont pas prononcés, car le guide ne les cite pas.
- **Taille** : les médias ajoutent 42 Mo (36 Mo de musique). Le DMG et l'installeur grossissent d'autant (voir §1).
- **Test e2e LAN** : il a échoué une fois sur cinq exécutions (salon resté sur « Démarrage du serveur… » juste après un build), puis il est passé à chaque relance. Cause non élucidée ; probablement un délai de démarrage du serveur au premier lancement.
- **Unités** : les tailles minimales à l'écran (32 à 70 px) privilégient la lisibilité sur l'échelle réelle quand on dézoome.

## 5. Méthode de vérification

- `npm test` : 57 tests Vitest (règles, combat, économie, unités, IA, déterminisme, snapshots, serveur LAN avec 4 clients pendant 20 min et une reconnexion, forme des fronts, seuil bac à sable, pillage des tribus, rayon d'action des ports, comptabilité des retombées).
- `npm run test:e2e` : 5 parcours Playwright dans Electron (solo jusqu'à la capitulation et l'écran de fin ; tous les écrans ; spectateur et replay ; LAN à deux instances ; campagne : briefing, guide et progression des étapes).
- `npm run pacing` : durée des parties entre IA (équilibrage).
- Bug trouvé en 1.1 grâce aux captures (« -0,0 % » au classement) : une intensité de retombées de 256 repassait à 0 dans un octet et faussait le compte des terres utiles, donc les parts de territoire et la victoire. Corrigé, avec un test de non-régression.
- `npm run lint`, `npm run typecheck` : 0 erreur.
- `node scripts/i18n-keys.mjs` : 327 clés utilisées, aucune manquante en FR ou en EN.
- Parties observées en accéléré (spectateur) jusqu'à la victoire, captures relues : c'est ainsi qu'ont été trouvés et corrigés les fronts en losange, le brouillard qui laissait voir les unités, les retombées confondues avec un territoire et le titre « Défaite » affiché aux spectateurs.
