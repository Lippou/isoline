# Isoline — Identité de marque

> **Isoline** — *Trace ta ligne. Tiens le monde.* / *Draw the line. Hold the world.*

Tous les éléments graphiques de la marque sont **générés par code** (`npm run brand`, script
`scripts/brand/build-brand.ts`). Chaque SVG est autonome : le texte y est vectorisé, sans dépendance
de police. Cela garantit des assets 100 % originaux et reproductibles.

---

## 1. Nom

### Candidats étudiés

| # | Candidat | Sens | Vérification (recherche web, oct. 2026) | Verdict |
|---|---|---|---|---|
| 1 | **Isoline** | Courbe de niveau : la ligne qui relie des points de même altitude sur une carte | Aucun jeu vidéo à ce nom (Steam, itch.io, stores). Le terme existe en cartographie et dans des API de routage (« isoline routing »), hors du domaine du jeu | **Retenu** |
| 2 | Graticule | Quadrillage des méridiens et parallèles d'une carte | Aucun jeu trouvé. Mot plus technique et difficile à retenir | Écarté |
| 3 | Tessera | Tesselle de mosaïque (la tuile) | Conflits : *Tessera* (Steam, 2025), *Tessera Tribes* (4X sur navigateur) | Écarté (conflit) |
| 4 | Inkfront | Front d'encre | Une entreprise « Ink Front » existe (Toronto) ; trop proche d'« OpenFront » | Écarté |
| 5 | Vellum | Vélin, le parchemin des atlas | Lieu de *Tyranny* (Obsidian), et une app d'écriture porte ce nom | Écarté |

### Pourquoi « Isoline »

- **Prononçable** en français (/i.zɔ.lin/) comme en anglais (/ˈaɪ.sə.laɪn/), en un seul mot.
- **Le cœur du genre** : on trace des frontières. Une isoline est une ligne qui se déplace sur la carte
  comme un front.
- **La direction artistique** : les courbes de niveau sont la signature visuelle du jeu (voir §5).
  Le nom, le logo et le rendu racontent la même chose.
- **Disponible** : pas de jeu homonyme connu.

## 2. Slogan

| Langue | Slogan | Mots |
|---|---|---|
| Français | **Trace ta ligne. Tiens le monde.** | 6 |
| English | **Draw the line. Hold the world.** | 6 |

## 3. Logo

Le symbole représente **trois courbes de niveau imbriquées** qui montent vers un **sommet en losange
laiton**. Le losange reprend le repère de triangulation des cartes topographiques ; dans le jeu, il
marque aussi la capitale. Les courbes ont une forme organique : ce sont des harmoniques déterministes,
pas des cercles. Le logotype est composé en **Fraunces SemiBold**, en capitales espacées (+16 %), à la
manière des grands toponymes des atlas.

| Fichier | Usage |
|---|---|
| `brand/symbol-dark.svg`, `symbol-light.svg`, `symbol-mono.svg`, `symbol-mono-white.svg` | Symbole seul (fond sombre, clair, monochrome noir, monochrome blanc) |
| `brand/logo-dark.svg`, `logo-light.svg`, `logo-mono.svg`, `logo-mono-white.svg` | Symbole + logotype |
| `brand/logo-dark-slogan.svg` | Version complète avec slogan |
| `brand/logotype-*.svg` | Logotype seul |
| `brand/app-icon-macos.svg` / `app-icon-windows.svg` / `app-icon-small.svg` | Sources des icônes |
| `brand/png/*.png` | Exports PNG (16 → 1600 px) |
| `brand/icon.icns`, `brand/icon.ico` | Icônes d'application (copies de `build-resources/`) |

**Lisibilité de 16 à 1024 px.** En dessous de 48 px, une variante simplifiée est utilisée
(`app-icon-small.svg`) : deux courbes au trait épais, un losange agrandi et pas de graticule. On la
retrouve dans `.icns` (16, 32) et dans `.ico` (16, 24, 32).

**Icône macOS.** Elle suit la grille Apple : corps de 824 px dans un canevas de 1024, coins arrondis
de 185 px, ombre portée douce et liseré intérieur. Le `.icns` contient les 10 tailles standard
(16 → 512@2x). **Icône Windows** : un carré arrondi à fond perdu. Le `.ico` contient 7 tailles
(16, 24, 32, 48, 64, 128, 256) en PNG.

**Zone de protection** : un quart de la hauteur du symbole autour du logo. **Taille minimale** du
logo complet : 120 px de large.

## 4. Direction artistique 1.2 : « Levé hydrographique »

**Idée.** Isoline est un levé cartographique **en plein jour**. La référence n'est pas le vieux
parchemin, mais la **carte marine moderne** : papier blanc froid, bleus de hauts-fonds, encre marine,
terres chamois, et le **magenta**, que les cartes marines réservent aux dangers. Il marque ici le
nucléaire, la guerre et les alertes. Le laiton reste la couleur de l'or.

**Une seule signature : les isolignes qui se tracent.** Des courbes de niveau, celles du logo,
se dessinent d'elles-mêmes. Elles s'ouvrent autour du sommet du logo à l'accueil, balaient l'écran
pendant les transitions et ondulent pendant les chargements. Ce motif, qui donne son nom au jeu, n'a
qu'un rôle de signature. Tout le reste reste calme : pas de dégradés décoratifs, pas d'ombres
partout, pas d'animation gratuite.

### 4.1 Deux thèmes, une même encre

| Rôle | Menus (thème « carte », clair) | Jeu (thème « encre », sombre, lisible sur la carte) |
|---|---|---|
| Fond | Papier `#EEF3F2` | Encre profonde `#0C1A26` |
| Panneaux | `#FAFCFB` / `#E8F0F0` / `#DCE8EA` | `#0E1D2A` / `#142636` / `#1B3044` |
| Filets | `#C9D8DC` / `#9DB4BC` | `#253D52` / `#3A5770` |
| Texte | Encre marine `#16324A` | Papier `#EEF3F2` |
| Texte secondaire | `#4B6478` / `#7D93A2` | `#9FB3C2` / `#6B8394` |
| Sélection, focus | Brasse `#2C6E91` | Haut-fond `#6FB3D8` |
| Or, action principale | Laiton `#B8862A` | Laiton `#D6A53F` |
| Danger, nucléaire, guerre | Magenta `#B3245F` | Magenta `#E0456F` |
| Succès, alliance | Vert sonde `#2F7D55` | `#5BC98A` |

Les jetons CSS gardent leurs noms historiques (`--parchment` est la couleur du texte, `--aurora`
celle de la sélection). Le thème « carte » s'applique à tous les écrans hors partie (classe `chart`).

### 4.2 Règles

- **Casse normale partout** : plus d'étiquettes en capitales espacées. La hiérarchie passe par la
  taille, la graisse et l'espace.
- **Chiffres** en IBM Plex Sans à chasse fixe des chiffres (`tabular-nums`), pas en police
  monospace.
- **Légendes plutôt que cartes** : les listes d'actions et d'options suivent une légende de carte
  (pictogramme, libellé, explication courte), alignées à gauche.
- **Cartouche** : le seul cadre décoratif est le cartouche du titre (double filet fin et épais,
  comme le cadre d'une carte). Il n'apparaît que sur l'écran d'accueil.
- **Mouvement** : un moment orchestré par écran au plus, plus des réponses aux actions (survol,
  sélection, confirmation). `prefers-reduced-motion` et le réglage « Réduire les animations »
  coupent tout.
- **Carte de jeu claire** : ombrage du relief adouci, mers plus claires, cycle jour/nuit réduit à un
  crépuscule léger.

## 4 bis. Palette 1.1 (historique)

Version 1.1 : l'interface passe à une palette sobre d'« état-major ». Les noms historiques des jetons
CSS sont conservés.

| Rôle | Jeton | Hex | Usage |
|---|---|---|---|
| Fond | `--abyss` | `#0D1015` | Fond de l'application |
| Panneaux | `--panel` / `--panel-2` / `--panel-3` | `#15191F` / `#1D222A` / `#252B34` | Panneaux opaques, lignes, survol |
| Bordures | `--line` / `--line-strong` | `#2D343E` / `#46505C` | Filets fins |
| Action principale | `--brass` (or) | `#D1A64A` | Boutons principaux, or, étoiles |
| Sélection | `--aurora` (bleu acier) | `#7FA9D6` | Sélection, focus, progression |
| Danger | `--signal` | `#D2544B` | Alertes, trahisons, erreurs |
| Succès | `--verdant` | `#6FAE74` | Alliances, objectifs atteints |
| Texte | `--parchment` | `#E8E5DD` | Texte principal |
| Texte secondaire | `--muted` / `--faint` | `#A7ACB4` / `#6F7680` | Explications, légendes |

Contrastes sur le fond : texte 15:1, texte secondaire 8:1, or 8,4:1, bleu acier 7,6:1 (WCAG AA ≥ 4,5:1).
Le logo garde ses teintes d'origine (Aurora `#4FE3C1`, Brass `#F2B84B`).

### Couleurs des pays

- **Pays réels** : une couleur traditionnelle de carte politique par code ISO (France bleue, Italie
  verte, Royaume-Uni rouge, Allemagne grise…), choisie pour rester distincte de ses voisins
  (`src/core/data/nationalColors.ts`, 118 pays). Ils affichent aussi leur **vrai drapeau** (flag-icons).
- **Joueurs, nations fictives et régions historiques** : 40 encres générées par
  `scripts/brand/gen-palette.ts`. Candidats en **OKLCH**, luminance 0,50 à 0,74 et chroma 0,11 à 0,21
  (ni pastel ni fluo), puis sélection gloutonne du point le plus éloigné en OKLab.
- **Modes daltoniens** : trois palettes optimisées après simulation de Machado et al. (2009). En mode
  daltonien, les couleurs nationales cèdent la place à ces palettes et des hachures s'ajoutent.
- Les tribus utilisent une encre neutre, `#B9B2A2`.

## 5. Direction artistique : carte réaliste, interface d'état-major

**Concept.** Une carte de stratégie crédible, comme celle d'un état-major : on doit lire d'un coup
d'œil le relief, les mers, les pays et les fronts. Les retours de test ont écarté le style « atlas
nocturne lumineux » de la version 1.0, jugé trop stylisé.

**Carte** (`src/render/shaders.ts`) :

- **Terrains réalistes**, façon vue satellite : plaines et cultures vert olive, forêts denses vert
  sombre, collines, roche des montagnes et **neiges éternelles** en altitude, déserts de sable et
  de regs, toundra et glaciers. Les limites entre biomes sont fondues et légèrement déformées par du
  bruit, pour ne pas laisser voir de pixels.
- **Ombrage du relief** marqué (lumière du nord-ouest) : c'est lui qui porte le réalisme et rend
  lisible le coût d'attaque (montagnes, collines).
- **Mers** : dégradé selon la profondeur (plateau continental turquoise, fosses bleu nuit), reflets
  animés, écume discrète. **Côtes lissées** au-delà du pixel, avec une frange de plage.
- **Territoires** en **aplat translucide** (42 % d'opacité) : le terrain reste lisible. Les
  **frontières** sont un trait net à la couleur du pays, cerné de sombre, et la couleur s'intensifie
  près des fronts. Pas de frontière tracée le long des côtes.
- **Brouillard de guerre** en nappes nuageuses grises ; la géographie reste visible, les possessions
  ennemies non.
- **Nuit** : désaturation bleutée, villes éclairées par des halos chauds.
- **Retombées nucléaires** : terre calcinée veinée de fissures incandescentes.

**Unités** (`src/render/icons.ts`) : silhouettes vues de dessus en deux calques, une coque neutre
réaliste et une marque à la couleur du pays. Croiseur gris avec tourelles et superstructure,
transport de troupes, porte-conteneurs à coque rouge, train (locomotive et wagons), chasseur,
bombardier, avion de reconnaissance. Taille réelle quand on zoome, taille minimale lisible quand on
dézoome.

**Bâtiments** : pastilles sombres cerclées de la couleur du propriétaire, avec un pictogramme Lucide
(immeubles, ancre, usine, château, fusée, viseur, radar, avion). Les niveaux s'affichent en points
dorés, la construction en anneau de progression.

**Interface** : panneaux opaques, filets fins, accent or pour l'action principale, bleu acier pour
la sélection. **Aucun emoji** : un seul jeu d'icônes au trait (Lucide), toujours accompagné d'un
libellé ou d'une infobulle. Chaque menu dit ce qu'il fait (sous-titres, descriptions d'options,
résumés). Signaux tactiques illustrés à la place des emojis.

## 6. Typographie (licence OFL, embarquée)

| Rôle | Police | Graisses | Source |
|---|---|---|---|
| Logotype, titres d'écran, noms de missions | **Fraunces** (Undercase Type) | 400, 600, 700 | `@fontsource/fraunces` (OFL 1.1) |
| Lignes d'ambiance, noms d'eaux, slogan | **Fraunces italique** | 400 | idem |
| Interface, texte, chiffres (`tabular-nums`) | **IBM Plex Sans** | 400, 500, 600 | `@fontsource/ibm-plex-sans` (OFL 1.1) |
| Noms de pays sur la carte de jeu | **IBM Plex Serif** | 500, 600 | `@fontsource/ibm-plex-serif` (OFL 1.1) |
| Code (outils de développement uniquement) | IBM Plex Mono | 400, 600 | `@fontsource/ibm-plex-mono` (OFL 1.1) |

Depuis la version 1.2, les chiffres de l'interface utilisent IBM Plex Sans à chasse fixe des chiffres
plutôt qu'une police monospace (§4.2). Les fichiers WOFF2 sont intégrés au bundle de l'application
par Vite : aucun chargement réseau.

## 7. Écrans de marque

- **Splash** (moins de 2 s) : les isolines du symbole se tracent une à une, puis le losange
  s'allume (animation CSS/SVG par `stroke-dashoffset`).
- **Écran titre** : une partie de démonstration réelle entre nations automatisées tourne en fond,
  floutée et assombrie. La carte est vivante.
- **À propos** : version, plateforme, crédits (contenu de `CREDITS.md`) et licences.

## 8. Captures

Générées par `npm run media` (1920×1080, jeu réel, aucune retouche), dans `docs/media/` :

| Fichier | Contenu |
|---|---|
| `01-title.png` | Écran titre : menu commenté, partie de démonstration en fond |
| `02-lobby.png` | Lobby solo : cartes, modes, options, fonctionnalités inédites |
| `03-gameplay.png` | Partie en Europe : relief réaliste, vrais drapeaux, HUD complet |
| `04-nukes-flight.png` | Bombe H : flash, onde de choc, cercles d'impact, sous-titre |
| `05-nuclear-impact.png` | Cratère : retombées calcinées et fissures lumineuses |
| `06-naval-rail.png` | Méditerranée à 9 min : ports, réseau ferré, navires |
| `07-night.png` | Méditerranée de nuit : carte désaturée, villes éclairées |
| `08-tech-panel.png` | Arbre technologique |
| `09-diplomacy.png` | Panneau de diplomatie, demande d'alliance |
| `10-fog-of-war.png` | Brouillard de guerre sur l'Afrique |
| `11-campaign.png` | Campagne |
| `12-editor.png` | Éditeur de cartes (Archipel) |
| `13-end-screen.png` | Écran de fin : classement, courbes, statistiques |
| `14-briefing.png` | Campagne : briefing de mission (la partie attend le joueur) |
| `15-guide.png` | Campagne : guide pas à pas, objectifs avec jauges |
| `gameplay.gif` | 10 s de partie en Méditerranée (640×360, 10 i/s) |
| `trailer.mp4` | Vidéo de 58 s (1080p, H.264) : menus, puis partie bac à sable en Europe jusqu'à la frappe nucléaire |
