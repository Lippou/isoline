# Changelog

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/). Versions selon SemVer.

## [1.1.0] — Retours de test : rythme, réalisme, interface, audio
### Modifié — rythme et équilibrage
- **Parties de 25 à 60 minutes** au lieu de 7 à 18 minutes (mesuré avec `npm run pacing`) :
  - IA posée : réflexion toutes les 3 à 6 s, 30 s entre deux offensives, constructions espacées, supériorité nette exigée avant de déclarer une guerre ;
  - fronts plus lents contre un pays (environ 2 tuiles/s) et défense renforcée ;
  - coût logistique des guerres proportionnel à la taille de l'empire ;
  - prix des villes et des ports sans plafond : l'économie n'est plus exponentielle ;
  - croissance ralentie.
- **La partie commence dès que la capitale est posée** : le minuteur borne seulement l'attente.
- **Tribus** : croissance comparable à une nation jusqu'à 60 000 troupes, puis arrêt ; elles thésaurisent de l'or, pillé tuile par tuile quand on les conquiert, avec un bruit de pièces.
- L'IA construit de nouveau des ports (priorités de construction pondérées).
- **Ports** : rayon d'action de 60 tuiles (+10 par niveau), affiché sur la carte. Les navires de guerre y sont construits et réparés.

### Modifié — graphismes
- **Carte réaliste** : biomes façon vue satellite, ombrage du relief, neiges éternelles, profondeur des mers, côtes lissées, territoires en aplat translucide et frontières nettes, brouillard de guerre nuageux.
- **Vrais drapeaux** et couleurs nationales traditionnelles pour les 204 pays réels.
- **Navires, trains et avions** redessinés vue de dessus (coque réaliste et marque nationale), agrandis.
- **Pictogrammes de bâtiments** lisibles (pastilles cerclées de la couleur du propriétaire).

### Modifié — interface
- Refonte complète de tous les écrans et du HUD :
  - style sobre, plus aucun emoji, icônes au trait avec libellés et infobulles ;
  - menu contextuel clair à la place de l'anneau d'icônes ;
  - lobby en trois étapes avec explication de chaque option ;
  - pages Paramètres, Replays, Sauvegardes, Réseau local, Profil et À propos homogènes.
- Signaux tactiques illustrés (Alt + clic) à la place des emojis.
- **Campagne guidée** : briefing lu par la conseillère (partie en pause), guide pas à pas qui reste affiché jusqu'à l'accomplissement de chaque étape, objectifs avec jauges, repères sur la carte.

### Ajouté — audio
- Bruitages enregistrés (Freesound, CC0) : explosions, sirène, missiles, canon, cornes de navire, train, pièces, fanfare d'alliance, coup d'orchestre de trahison…
- Musique orchestrale adaptative (Kevin MacLeod, CC BY 4.0) : calme, tension, guerre, victoire, défaite, en fondu enchaîné.
- Voix de la conseillère pour la campagne et le didacticiel, en français et en anglais (synthèse neuronale Kokoro, générée hors ligne).

### Corrigé
- « Continuer à regarder » ne fait plus réapparaître l'écran de fin ; un bouton « Voir les résultats » permet d'y revenir.
- La fin naturelle d'une alliance ne joue plus le son de trahison.

## [1.0.0] — Phase 9 : packaging, QA, livrables
### Ajouté
- `npm run verify:packages` contrôle les paquets :
  - DMG et ZIP universels : taille, structure `.app`, `Info.plist`, binaire universel (lipo), signature ad hoc vérifiée, cartes dans les ressources, lancement en `--smoke-test` (code 0) ;
  - installeur NSIS et exécutable portable : en-tête PE, archive Nullsoft, `app.asar`, cartes, icône 16–256 px et ressource de version de `Isoline.exe`.
- Benchmarks : `npm run bench` (Node : chargement de carte, tick à 100 nations, 30 min à 50 nations, carte géante, déterminisme) et `npm run bench:app` (Electron : démarrage, FPS, mémoire, endurance de 60 min de jeu).
- Médias : `npm run media` produit 13 captures 1920×1080, un GIF de 10 s et une vidéo de 58 s en 1080p (`docs/media/trailer.mp4`, assemblée avec `ffmpeg-static`, dépendance locale). Le jeu expose un hook d'automatisation (`?automation`) pour ces scripts.
- Test e2e LAN : une instance héberge, une seconde rejoint par adresse et code, et les deux jouent la même partie.
- Vérification de mise à jour optionnelle (désactivée par défaut) : manifeste JSON en HTTPS, appel fait par le process principal, bandeau sur l'écran titre.
- Le salon LAN affiche l'adresse `IP:port` de l'hôte.
- `npm run maps:fetch` : téléchargement reproductible des couches Natural Earth.
- Option de lobby « or de départ des joueurs » (bac à sable).
- `README.md`, `GAME_DESIGN.md`, `RAPPORT.md`, crédits complétés.

### Modifié
- **Fronts d'attaque arrondis** : les temps d'arrivée se calculent comme une mise à jour eikonale (fast marching) au lieu d'une vague 4-voisins. Les territoires ne poussent plus en losanges (rapport diagonale/axe passé de 0,76 à 0,95, test de non-régression ajouté).
- **Brouillard de guerre** :
  - vision circulaire (chamfer 8-voisins, 30 tuiles de jour, 24 la nuit) ;
  - la géographie reste lisible sous le brouillard (atlas sépia) mais les possessions ennemies sont masquées ;
  - unités, bâtiments et étiquettes ennemis sont cachés hors vue ;
  - le brouillard ne se lève plus en partie (spectateur ou replay uniquement).
- Retombées nucléaires : terre calcinée veinée de fissures lumineuses, au lieu d'un lavis vert confondu avec un territoire.
- Nuit plus marquée et halos de villes plus visibles.
- Moins de navires marchands (intervalle 600 ticks, amortissement global à 80 navires), sprites plus discrets.
- Écran de fin en spectateur : « Victoire de X » au lieu de « Défaite ». Les courbes de territoire partagent une même échelle.

### Corrigé
- Territoires invisibles après les mises à jour partielles de texture : état GL de Pixi (prémultiplication alpha, texture liée) explicitement restauré.
- Capituler depuis le menu laissait la partie en pause.

## [0.8.0] — Phases 7–8 : fonctionnalités inédites et finitions
### Ajouté
- Calque de loyauté (N) : chaleur rouge/vert sur ses propres tuiles, calculé dans le Worker.
- Les bancs de brouillard météo masquent les transports ennemis.
- Mode performance automatique quand le jeu tient moins de 40 FPS pendant 5 s.
- Campagne de 6 missions, didacticiel en 9 étapes, 30 succès, titres, classement local.
- Audio procédural : musique en trois couches (calme, tension, guerre) et effets synthétisés.
- Accessibilité : 3 modes daltoniens, haut contraste, échelle d'interface 80 à 150 %, taille de police, réduction des animations, sous-titres des alertes sonores.

## [0.6.0] — Phase 6 : multijoueur LAN
### Ajouté
- Serveur lockstep embarqué (ws) : simulation de référence côté serveur, validation des commandes, hash toutes les 50 ticks, resynchronisation par snapshot, reconnexion pendant 60 s, spectateurs, limite de 25 commandes/s, découverte UDP, code d'invitation.
- Test d'intégration : 4 clients pendant 20 minutes de jeu, sans désynchronisation, avec une déconnexion et une reconnexion.

## [0.5.0] — Phases 1–5 : moteur, cœur du jeu, marine, rail, nucléaire, diplomatie, IA, modes
### Ajouté
- 14 cartes (Natural Earth et fictives) et générateur procédural ; éditeur de cartes.
- Simulation déterministe à 10 ticks/s dans un Worker ; PRNG seedé ; snapshots ; replays.
- Économie (courbe en cloche à 42 %), combat, 8 bâtiments, transports, navires de guerre, marchands, rail et trains, bombes A, H et MIRV, SAM prédictifs, aviation, diplomatie complète.
- Nations avec 6 personnalités et 4 difficultés, tribus ; tous les modes (FFA, équipes, humains contre nations, tribus, Apocalypse, prolongation, Battle Royale).
- Rendu PixiJS v8 avec shaders GLSL originaux, HUD complet, menu radial, raccourcis remappables, FR/EN.

## [0.1.0] — Phase 0 : fondations
### Ajouté
- Nom, slogan, logo SVG (4 variantes), icônes `.icns`/`.ico`, fond de DMG, moodboard, 40 encres joueurs et 3 palettes daltoniennes, le tout généré par `npm run brand`.
- Ossature Electron + Vite + Svelte 5 + TypeScript strict ; protocole `isoline://` ; mode `--smoke-test`.
- Chaîne de packaging : DMG/ZIP macOS universel signé ad hoc, installeur NSIS et portable Windows x64 construits depuis le Mac.
- ESLint, Prettier, hooks `pre-commit` (lefthook).
