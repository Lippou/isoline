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

## 4. Palette

| Rôle | Nom | Hex | Usage |
|---|---|---|---|
| Fond | **Abyss** | `#0B1220` | Fond de l'application, océan profond nocturne |
| Surface | **Slate** | `#16233A` | Panneaux, cartes UI (verre dépoli à 72 %) |
| Accent primaire | **Aurora** | `#4FE3C1` | Isolines, sélection, focus, boutons primaires |
| Accent secondaire | **Brass** | `#F2B84B` | Or, capitales, récompenses, éléments rares |
| Danger | **Signal** | `#FF5A5F` | Alertes nucléaires, trahisons, erreurs |
| Succès | **Verdant** | `#7BD88F` | Validations, alliances, croissance |
| Texte | **Parchment** | `#EAE6DA` | Texte principal (contraste 15,0:1 sur Abyss) |

Toutes les combinaisons texte/fond de l'interface respectent le niveau WCAG AA (≥ 4,5:1).
Parchment sur Slate : 12,6:1 ; Aurora sur Abyss : 11,7:1 ; Brass sur Abyss : 10,5:1 ; Signal sur Abyss : 6,1:1.

### Encres des joueurs (40 couleurs)

`src/render/palette.ts` est généré par `scripts/brand/gen-palette.ts` :

1. On échantillonne des couleurs candidates dans l'espace **OKLCH**, avec une luminance de 0,60 à
   0,90 pour rester lisibles en lavis translucide sur la carte sombre comme sur les terrains clairs.
2. On fait une **sélection gloutonne du point le plus éloigné** en OKLab : chaque nouvelle couleur
   maximise sa distance minimale aux couleurs déjà retenues. Les premiers joueurs reçoivent donc les
   couleurs les plus distinctes.
3. On calcule **trois palettes daltoniennes** (protanopie, deutéranopie, tritanopie) selon le même
   principe. Les distances y sont mesurées *après* simulation de Machado et al. (2009, sévérité 1,0).
4. En mode daltonien, des **motifs** (hachures orientées, points) s'ajoutent à la couleur, car
   40 teintes ne peuvent pas toutes rester distinctes pour une vision dichromate.

Planche : `brand/player-palettes.png`. Les tribus utilisent une encre neutre unique, `#B9B2A2`.

## 5. Direction artistique : « Atlas nocturne, encre lumineuse »

Moodboard : `brand/moodboard.png` (généré).

**Concept.** La partie se joue sur une **table de cartographe, la nuit**. Le relief est dessiné en
**courbes de niveau lumineuses** (les isolines) sur un papier bleu nuit. Chaque empire est un **lavis
d'encre translucide** qui laisse voir le relief en dessous. Les frontières sont des **traits d'encre
qui brillent et s'écoulent**. Quand un territoire est conquis, l'encre **diffuse**, comme une goutte
sur du papier humide.

**Pourquoi cette direction.**

- **Elle ne ressemble pas aux jeux existants.** Le genre utilise surtout des aplats de pixels
  saturés sur des cartes réalistes. Isoline mise sur une esthétique d'atlas ancien, réinterprétée en
  lumière.
- **Elle est fonctionnelle.** Les isolines montrent l'altitude, donc le coût d'attaque (colline,
  montagne) sans calque supplémentaire. Le lavis translucide garde le terrain lisible sous les
  territoires.
- **Elle est réaliste techniquement.** Tout passe par un shader de carte unique : courbes calculées
  depuis une texture d'altitude filtrée, lavis et frontières depuis une texture de propriétaires.
  Ça tient à 60 FPS sur 2 millions de tuiles.
- **Elle s'adapte bien au jour et à la nuit.** La nuit, l'encre s'assombrit et les villes s'allument
  comme des points de lumière.

**Éléments clés du rendu.**

- Océans : dégradé de profondeur, **lignes bathymétriques** animées le long des côtes (comme sur les
  cartes marines) et écume.
- Terres : textures procédurales par biome, ombrage du relief (*hillshading*) et isolines tous les
  16 niveaux d'altitude (une ligne maîtresse sur quatre).
- Interface : **verre dépoli** sombre (Slate à 72 % + flou), liserés Aurora, typographie d'atlas.
- Pictogrammes des bâtiments : glyphes géométriques au trait, façon légende de carte.

## 6. Typographie (licence OFL, embarquée)

| Rôle | Police | Graisses | Source |
|---|---|---|---|
| Titres, logotype, toponymes | **Fraunces** (Undercase Type) | 400, 600, 700 | `@fontsource/fraunces` (OFL 1.1) |
| Interface, texte | **IBM Plex Sans** | 400, 500, 600 | `@fontsource/ibm-plex-sans` (OFL 1.1) |
| Nombres, compteurs | **IBM Plex Mono** | 400, 600 | `@fontsource/ibm-plex-mono` (OFL 1.1) |

Les fichiers WOFF2 sont intégrés au bundle de l'application par Vite : aucun chargement réseau.

## 7. Écrans de marque

- **Splash** (moins de 2 s) : les isolines du symbole se tracent une à une, puis le losange
  s'allume (animation CSS/SVG par `stroke-dashoffset`).
- **Écran titre** : une partie de démonstration réelle entre nations automatisées tourne en fond,
  floutée et assombrie. La carte est vivante.
- **À propos** : version, plateforme, crédits (contenu de `CREDITS.md`) et licences.

## 8. Captures

Les captures d'écran 1920×1080 sont dans `docs/media/` (voir `RAPPORT.md`).
