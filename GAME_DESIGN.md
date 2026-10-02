# Isoline — Game Design Document

> Conquête territoriale en temps réel sur un atlas vivant.
> Source de vérité des valeurs : `src/core/game/constants.ts` (ce document en est le miroir commenté).

Sommaire : 1. Vision · 2. Boucle de jeu · 3. Carte et terrain · 4. Apparition · 5. Population et économie · 6. Combat · 7. Bâtiments · 8. Marine · 9. Rail · 10. Nucléaire · 11. Aviation · 12. Diplomatie · 13. Nations et tribus (IA) · 14. Modes et victoire · 15. Fonctionnalités inédites · 16. Interface et contrôles · 17. Réseau et déterminisme · 18. Données · 19. Équilibrage

---

## 1. Vision

Isoline reprend la profondeur du genre « conquête de territoires sur carte en grille » (expansion, économie, marine, rail, nucléaire, diplomatie, nations automatisées) et y ajoute une couche stratégique originale : météo, brouillard de guerre, technologies, ressources, loyauté, généraux, conseil mondial, aviation, campagne.

La direction artistique (**atlas nocturne, encre lumineuse**) sert aussi la lisibilité. Les courbes de niveau montrent le relief, donc le coût d'attaque. Le lavis translucide laisse voir le terrain. Les frontières lumineuses montrent les fronts. Voir `BRAND.md`.

## 2. Boucle de jeu

1. **Apparition** (30 s par défaut) : choisir un point de départ.
2. **Expansion** dans les terres libres et absorption des tribus.
3. **Économie** : villes (population), ports (commerce), usines (rail), recherche.
4. **Guerre** contre les nations et les joueurs : fronts terrestres, débarquements, marine, aviation, nucléaire.
5. **Diplomatie** : alliances temporaires, trahisons, embargos, dons, conseil mondial.
6. **Victoire** à 80 % des terres utiles (configurable), ou objectif du mode.

Simulation : **10 ticks/s** (1 tick = 100 ms), déterministe, dans un Web Worker. Le rendu est interpolé à la fréquence de l'écran.

## 3. Carte et terrain

### 3.1 Grille
Chaque tuile a un type de terrain (11 types), une altitude (0–255) et un éventuel gisement. Le voisinage est en 4-connexité. Les données dérivées sont calculées au chargement : composantes connexes (étendues d'eau et masses terrestres séparées), distance à la côte (BFS) et graphe naval grossier (A* sur cellules de 3 à 6 tuiles, lissé par ligne de vue).

### 3.2 Terrains (valeurs de `terrain.ts`)

| Terrain | Pertes attaquant (mag) | Lenteur (speed) | Vision | Franchissable |
|---|---|---|---|---|
| Océan profond, eaux côtières, lac | – | – | – | non (navires) |
| Rivière | 95 | 21 | 0 | oui |
| Plaine | 80 | 16,5 | 0 | oui |
| Colline | 100 | 20 | +1 | oui |
| Montagne | 120 | 25 | +2 | oui |
| Désert | 80 | 16,5 | 0 | oui |
| Forêt | 90 | 18 | −1 | oui |
| Toundra / glace | 95 | 22 | 0 | oui |
| Infranchissable (falaises, glaciers, murs) | – | – | bloque | non |

`mag/80` multiplie les pertes de l'attaquant ; `speed/16,5` multiplie le temps de traversée d'une tuile.

### 3.3 Cartes livrées (14 + générateur)

| Catégorie | Cartes | Taille (tuiles) |
|---|---|---|
| Continents | Monde (projection de Miller, 82°N–62°S) | 2000×1007 (2,01 M) |
| | Monde géant | 3200×1612 (5,16 M) |
| | Europe, Amérique du Nord, Amérique du Sud, Afrique, Asie, Océanie | 1,5 à 2,5 M |
| Régions | Méditerranée, Mer Noire | 1,42 M / 0,95 M |
| Fictives | Pangée, Archipel, Deux lacs | 1,6 M / 1,4 M / 0,77 M |
| Arcade | Labyrinthe (couloirs, murs, canaux) | 960×640 |
| Procédurale | Générateur (graine, taille, terres, îles, montagnes, rivières) | 800×500 à 2000×1000 |

Les **cartes réelles** sont rastérisées depuis Natural Earth (domaine public) : terres, îles mineures, lacs, glaciers, fleuves, chaînes de montagnes, plateaux, déserts, toundra. L'altitude est **synthétisée** à partir des masques régionaux, de bruit fractal et de bruit « ridgé ». Les biomes sortent d'un petit modèle climatique : la température dépend de la latitude et de l'altitude, l'humidité de la distance à la mer et des bandes de latitude.

Les **détroits et canaux** sont creusés explicitement : Bosphore, Dardanelles, Gibraltar, Suez, Panama, Kertch, Øresund, Grand Belt, Bab-el-Mandeb, Messine, Singapour. Les eaux enclavées deviennent des lacs.

**Fichiers** (`assets/maps/`) : `<id>.png` (couleur = terrain), `<id>.elev.png` (altitude), `<id>.json` (nom FR/EN, taille, points de spawn, nations avec nom, position et graine de drapeau, gisements), `<id>.thumb.png` (miniature). Les cartes personnalisées sont des fichiers `.isomap` (JSON contenant les deux PNG en base64 et les métadonnées).

## 4. Apparition (spawn)

- Durée : **30 s** (lobby : 15 à 60 s), compte à rebours affiché.
- Un clic revendique un **disque de rayon 8** sur la terre libre de la même masse terrestre. On peut cliquer ailleurs jusqu'à la fin de la phase.
- Les joueurs qui n'ont pas choisi reçoivent un point de spawn aléatoire. Les nations sont placées **avant** les joueurs, à leur position prédéfinie. Les tribus occupent des points réservés, à au moins 14 tuiles de toute terre déjà prise.
- **Immunité** : 60 s pour les humains après le début. Personne ne peut les attaquer ; un bouclier s'affiche dans le HUD.
- Troupes de départ : humain 25 000, nation 25 000 × multiplicateur de difficulté, tribu 9 000.

## 5. Population et économie

### 5.1 Plafond de population
```
plafond = 100 000 + 250 000 × niveaux_de_villes + 4 000 × tuiles_utiles^0,55
```
Le terme territorial est à rendement décroissant. Les tribus ont un plafond ×0,5. Les terres fertiles ajoutent +6 % de croissance par gisement (maximum 40 %), et le plafond augmente de la moitié de ce bonus. Les tuiles irradiées ne comptent pas.

### 5.2 Croissance (courbe en cloche, pic à 42 %)
```
x = troupes / plafond
cloche(x) = exp(−((x − 0,42) / σ)²),  σ = 0,34 si x < 0,42, sinon 0,30
croissance/tick = 0,0036 × plafond × cloche(x) × (1 − population / plafond)
```
- Nations : × multiplicateur de troupes de la difficulté. Tribus : ×0,55.
- Au-dessus du plafond, la population décroît de 1 % de l'excédent par tick.
- La croissance se répartit selon la **part des troupes** (curseur 5 à 100 %, défaut 60 %). Un **rééquilibrage** progressif (0,4 % de la population par tick) ramène la répartition vers le curseur. En **mode simple** (option), la part est automatique : les troupes restent près de 42 % du plafond.

### 5.3 Malus des grands empires (anti-boule de neige)
Au-delà de 60 000 tuiles, les assaillants subissent moins de pertes contre l'empire :
`malus = min(45 %, (tuiles − 60 000) / 400 000 × 45 %)`. Il est affiché dans la carte de survol.

### 5.4 Or
- Revenu de base : **1 000/s** (humain), **500/s** (nation × multiplicateur de revenu de la difficulté). Les tribus n'ont pas d'or.
- Ouvriers : **0,012 or/s par ouvrier** (+10 % et +15 % avec les technologies Économie 1 et 3).
- Commerce maritime et trains (§8, §9). Pétrole : **+400 or/s par gisement**.
- Multiplicateurs globaux : option « multiplicateur d'or » du lobby (×0,5 à ×4), crise économique (−25 %), sanctions du conseil (−50 %).
- Affichage abrégé (125k, 1,2M) avec la valeur exacte et la décomposition au survol.

## 6. Combat et expansion

### 6.1 Attaques terrestres
Un clic sur une tuile ennemie ou libre lance une attaque avec **ratio × troupes actuelles** (défaut 20 %). Ratio : touches T/Y, Maj + molette, curseur.

Chaque attaque maintient un **front** : un tas binaire de tuiles cibles adjacentes au territoire de l'assaillant, indexé par un **temps d'arrivée** calculé comme dans un « fast marching » (équation eikonale) :
```
c   = speed/16,5 × multiplicateurs × gigue(0,65…1,35)       coût de la tuile
th  = temps du voisin conquis horizontal le plus tôt, tv = idem vertical
       (tuiles déjà possédées au lancement = horloge de départ)
T   = min(th, tv) + c                          si un seul voisin, ou |th − tv| ≥ c
T   = (th + tv + √(2c² − (th − tv)²)) / 2      sinon
priorité = T − 0,02 × (tuiles de l'assaillant dans la fenêtre 5×5 − 10)
```
Une tuile est réinsérée plus tôt quand elle gagne un deuxième voisin conquis. Une vague 4-voisins naïve avance selon la distance de Manhattan et fait pousser des **losanges**. La mise à jour eikonale fait avancer les fronts diagonaux à la même vitesse euclidienne que les fronts droits : les territoires sont **arrondis** (rapport diagonale/axe ≈ 0,95, contre 0,71 pour un losange ; test de non-régression). Le terme 5×5 vaut 10 derrière tout bord droit, quelle que soit son orientation. Il comble les poches concaves et freine les pointes : l'encre se propage de façon organique. La gigue est déterministe (hash de la tuile). À chaque tick, l'horloge avance de 1 × multiplicateurs de vitesse, et l'attaque conquiert les tuiles prêtes dans la limite d'un **budget** :
```
budget/tick = max(1,2 ; 0,36 × √troupes_engagées) × (0,42 contre un joueur)
```

### 6.2 Pertes
- Terres libres : `12 × mag/80` par tuile.
- Contre un joueur : `mag/80 × (20 + 1,6 × densité_défenseur) × supériorité × modificateurs`, avec densité = troupes/tuiles du défenseur.
- **Supériorité numérique** (ratio r = engagés / troupes du défenseur) : si r ≥ 1, ×(1 − 0,35 × min(1, r − 1)), donc jusqu'à −35 % de pertes, plafonné à 2:1. Si r < 1, ×(1 + 0,5 × (1 − r)).
- Le défenseur perd `0,8 × densité` troupes par tuile perdue.
- **Postes de défense** : ×5 sur les pertes et ×3 sur la lenteur dans un rayon de 30 tuiles (×10 sur les pertes pendant le général Rempart).
- **Traître** : la défense du traître est ×0,5, sa vitesse ×0,8 pendant 300 ticks.
- **Retombées** sur la tuile : `mag × (5 − 2 × (1 − intensité/255))`, soit ×5 pour des retombées fraîches et ×3 quand elles s'estompent.
- Technologies militaires (§15.3), malus des grands empires (§5.3).

### 6.3 Règles diverses
- Plusieurs ordres contre la même cible **renforcent** l'attaque en cours. Des attaques opposées se **neutralisent** d'abord (soustraction mutuelle des effectifs).
- **Annulation** : les troupes reviennent avec 10 % de pénalité.
- 12 attaques simultanées au maximum par joueur.
- Un clic au-delà de l'eau (pas de front commun) déclenche automatiquement un **débarquement** (§8.1).
- **Mort** d'un joueur à 0 tuile : ses navires coulent progressivement (−5 à −8 PV par tick) et ses bâtiments disparaissent.
- **Capture des bâtiments** : villes, ports, usines, silos, SAM et aérodromes sont transférés ; postes de défense et radars sont détruits.
- **Vue terrain** (Espace) : carte thermique des coûts d'attaque.

## 7. Bâtiments

| Bâtiment | Coût | Construction | Rôle | Capture |
|---|---|---|---|---|
| Ville | `min(1 M, 125 000 × 2^niveaux_de_villes)` | 20 ticks | +250 000 de plafond par niveau, recherche, gare. Améliorable sans limite (construire sur la ville = +1 niveau) | transférée |
| Port | compteur commun avec l'usine : `min(1 M, 125 000 × 2^niveaux)` | 50 ticks | sur la côte d'une mer de 120 tuiles ou plus ; navires marchands ; navires de guerre ; gare. Niveau max 5 | transféré |
| Usine | même compteur | 20 ticks | rails automatiques et trains. Niveau max 5 | transférée |
| Poste de défense | `min(250 000, 50 000 × (n + 1))` | 50 ticks | ×5 pertes, ×3 lenteur dans 30 tuiles | détruit |
| Silo | 1 000 000 (amélioration 1 M) | 100 ticks | lance A, H et MIRV ; +1 tube par niveau ; rechargement `150 / (1 + 0,5 × (niveau − 1))` ticks | transféré |
| Batterie SAM | 1 500 000, amélioration 3 000 000 | 300 ticks | portée `150 − 480/(niveau + 5)` (70 → 118 au niveau 10) ; recharge 90 ticks ; intercepte aussi les bombardiers | transférée |
| Tour radar | 300 000 | 40 ticks | révèle le brouillard sur 60 tuiles (+20 par niveau) ; aveuglée par les tempêtes solaires | détruite |
| Aérodrome | 800 000 | 80 ticks | 4 avions par niveau (§11) | transféré |

Règles communes :
- placement sur son territoire uniquement ;
- espacement minimal de 4 tuiles ;
- les ports se « collent » automatiquement à la côte la plus proche (rayon 8) ;
- aperçu fantôme vert/rouge et portée affichée au survol ;
- démolition volontaire : **remboursement de 25 %** de l'or investi ;
- coûts réduits par les métaux rares (−5 % par gisement, maximum −30 %) et par les technologies Économie 4 et Défense 3.

## 8. Marine

### 8.1 Transports
- Ils partent de la côte la plus proche du joueur sur la même étendue d'eau ; l'itinéraire est calculé par A* sur le graphe naval.
- Vitesse **1,5 tuile/tick** ; tempêtes ×0,6 ; 300 PV ; **4 transports** au maximum en mer.
- Ils emportent ratio × troupes.
- À l'arrivée : une **tête de pont** est conquise puis l'attaque se poursuit normalement. Si la cible est devenue amie, les troupes rentrent.
- Ils peuvent être coulés par les navires de guerre et les chasseurs ; les troupes sont alors perdues.

### 8.2 Navires de guerre
- Coût **250 000 → 500 000 → 1 000 000** (selon le nombre possédé). Nécessite un port sur la même mer.
- 1 000 PV ; 250 dégâts par obus (vitesse 9) toutes les 18 ticks ; **portée 130**.
- Priorité de ciblage : **transports > navires de guerre > marchands**. Les marchands ne sont pas coulés mais **capturés** (piraterie, à 4 tuiles).
- **Patrouille** autour d'un point (touche 7 puis clic, ou ordre « Déplacer ») dans un rayon de 40 tuiles.
- **Vétérance** à 2, 5 et 9 victoires : +20 % de PV max et +20 % de dégâts par niveau.
- **Réparation** : 3 PV/tick à moins de 20 tuiles d'un port allié.
- **F** sélectionne tous ses navires de guerre ; **Maj + glisser** sélectionne par rectangle.

### 8.3 Navires marchands
- Chaque port en émet un toutes les `600 / (1 + 0,5 × (niveau − 1)) × (1 + marchands_en_mer / 80)` ticks (amortissement global), vers un port étranger aléatoire de la même mer, sans embargo.
- Revenu à l'arrivée : `(3 000 + 55 × distance) × (1 + 25 % × (niveau − 1))` pour l'armateur, plus 50 % pour le port d'accueil.
- Boom commercial ×2 ; technologie Marine 4 : +30 %.
- Un marchand capturé décharge chez le pirate.

## 9. Rail et trains

- Une usine terminée (ou une gare construite près d'une usine) relie automatiquement par A* terrestre jusqu'à **8 gares** (villes, ports, usines) entre **15 et 110 tuiles**.
- Segment de 155 tuiles au maximum (×1,3 de tolérance de tracé). Les tuiles traversées doivent appartenir au propriétaire, à la gare cible ou à leurs alliés et coéquipiers.
- **Fréquence** par usine : `(usines_du_propriétaire + 10) × 15 × (1 + trains_en_circulation / 500)` ticks, divisée par `1 + 0,15 × (niveau − 1)`.
- Trains : 2 tuiles/tick, 16 arrêts au maximum. Ils ne reviennent pas sur leurs pas sauf impasse et évitent les gares sous embargo.
- **Paiement par arrêt** : 10 000 (propre gare), 25 000 (gare d'un autre joueur ou d'un coéquipier), 35 000 (gare alliée). À partir du **10ᵉ arrêt**, −5 000 par arrêt, avec un plancher de 5 000. Le propriétaire d'une gare étrangère reçoit **40 %** du paiement. Technologie Économie 2 : +10 %.
- **Destruction** : une voie est coupée si une de ses tuiles est prise par un tiers hostile. Une bombe ou un bombardier sur la voie la détruit aussi, avec les trains qui y roulent. Le général **Sabotage** détruit un train ou un marchand.
- Rendu : courbes quadratiques lissées, visibles à partir d'un zoom moyen ; trains visibles en zoom rapproché.

## 10. Armes nucléaires

| Arme | Coût | Destruction | Retombées | Interceptable |
|---|---|---|---|---|
| Bombe A | 750 000 | 12 tuiles | 30 tuiles | oui |
| Bombe H | 5 000 000 | 80 tuiles | 100 tuiles | oui |
| MIRV | 25 M + 15 M × MIRV déjà lancés dans la partie (tous joueurs) | porteur → **8 à 12 ogives** (+2 avec Nucléaire 4) de 12/18 tuiles, réparties sur 70 tuiles autour de la cible | | ogives oui, porteur non |

- Uranium : −8 % par gisement (maximum −40 %). Technologies : −10 % (Nucléaire 1), −15 % (Nucléaire 3), rechargement +25 % (Nucléaire 2).
- **Vol** : 10 tuiles/tick, 10 ticks au minimum, arc parabolique avec traînée, point d'impact projeté (cercles de destruction et de retombées). Le MIRV se sépare à 72 % du trajet.
- **Lancement** : touche 8 (une deuxième pression passe à ×5), 9 (H), 0 (MIRV). Menu radial ×1/×2/×5/×Max, plafonné par l'or, les tubes chargés et 50 bombes par ordre. Un même silo tire en file à 1 tick d'intervalle ; plusieurs silos tirent ensemble. Après un MIRV, le silo a 900 ticks de recharge.
- **Interception SAM** : chaque SAM (ni ami ni allié du tireur) cherche le premier tick k où le missile sera dans sa portée et atteignable par un intercepteur (22 tuiles/tick) avant l'impact, c'est-à-dire une **prédiction de trajectoire**. Il tire 1 missile par salve (+1 avec Défense 2 et +1 avec Défense 4), puis recharge 90 ticks.
- **Détonation** :
  - Dans le rayon de destruction : les tuiles terrestres perdent leur propriétaire et reçoivent des retombées maximales (bord irrégulier, ou cercle lisse sur l'eau avec l'option *Water Nukes*). Bâtiments, unités et rails y sont détruits.
  - Entre destruction et retombées : des retombées probabilistes, d'intensité décroissante.
  - Pertes de population : fraction de territoire détruite × 1,4, appliquée aux troupes et aux ouvriers.
- Les **retombées** ne comptent pas dans les terres utiles et rendent l'attaque coûteuse. Elles sont permanentes par défaut ; l'option *Décontamination* les efface en 10 minutes.
- **Alertes** : les joueurs dont le territoire est sous la trajectoire ou dans la zone d'impact reçoivent une sirène, un sous-titre, un compte à rebours d'impact cliquable et une entrée au journal.
- Nucléariser un allié est une **trahison**. Le Conseil mondial peut **interdire** le nucléaire pendant 3 minutes.

## 11. Aviation (inédit)

| Avion | Coût | Vitesse | PV | Rôle |
|---|---|---|---|---|
| Chasseur | 400 000 | 4 | 400 | patrouille 60 s autour de la cible, à 90 tuiles au plus de l'aérodrome ; abat bombardiers, transports et avions de reconnaissance à moins de 30 tuiles (60 dégâts par tick au contact) |
| Bombardier | 900 000 | 2,6 | 700 | rayon de 6 tuiles : pertes = min(35 % des troupes, densité × tuiles touchées × 4 + 2 % des troupes) ; détruit trains et voies ; pas de retombées ; abattu par SAM et chasseurs |
| Reconnaissance | 150 000 | 5 | 150 | révèle 40 tuiles pendant 40 s (brouillard de guerre) |

Un aérodrome porte 4 avions par niveau. Bombarder un allié est une trahison.

## 12. Diplomatie

- **Alliance** : demande par le menu radial ou le panneau Diplomatie, acceptation K / refus L. Des demandes croisées valent acceptation. Durée **3 000 ticks (5 min)**. Renouvellement par consentement mutuel dans les 30 dernières secondes. L'expiration est sans pénalité. Les alliés ne peuvent pas s'attaquer : les attaques en cours entre eux sont annulées et remboursées.
- **Trahison** (attaquer, débarquer, bombarder ou nucléariser un allié) : alliance rompue, défense ×0,5 et vitesse ×0,8 pendant 300 ticks, marque publique de traître 💔 pendant 5 min, **embargo automatique de 5 min** avec la victime, annonce à tous. Aucune pénalité si la victime est inactive. Une confirmation est demandée (désactivable).
- **Embargo** : coupe commerce maritime et trains entre les deux joueurs. Il existe aussi un « embargo général sauf équipe » et une levée globale.
- **Dons** : or et troupes, aux alliés et coéquipiers uniquement (10 % / 25 % dans le radial, montant libre via commande).
- **Communication** : emojis (Alt + clic), 8 messages rapides traduits, chat par canal (tous / équipe / alliés) avec filtre d'injures et masquage par joueur, signaux sur la carte.
- **Panneau Diplomatie** : joueurs, relation (allié et chronomètre / en guerre / neutre / embargo), personnalité, historique des trahisons.

## 13. Nations et tribus (IA)

L'IA tourne **dans la simulation**. Elle utilise uniquement le PRNG seedé et un **budget de travail déterministe** (6 000 unités par tick, chaque réflexion coûtant de 30 à 400 unités) : tous les pairs du lockstep calculent donc exactement les mêmes décisions. Un budget en temps réel aurait brisé le déterminisme.

- **Tribus** : s'étendent lentement en terres libres (ratio 12 %) et attaquent parfois un voisin non humain deux fois plus faible. Elles ne construisent pas.
- **Nations** réfléchissent toutes les 8 à 16 ticks (× facteur de difficulté) :
  1. rééquilibrage troupes/ouvriers selon la personnalité (+15 % de troupes sous attaque) ;
  2. recherche technologique selon la personnalité ;
  3. **évaluation des fronts** par échantillonnage de 80 tuiles frontalières (voisins, contact) ;
  4. **riposte** contre le plus gros assaillant si possible, sinon **défense des goulots** (poste de défense près du contact) ;
  5. expansion vers les terres libres, puis choix d'une cible : force relative × contact, tribus ×2,5, rancune, traîtres ×1,5 ;
  6. **ratio d'attaque adaptatif** `clamp(1,3 × troupes_cible / mes_troupes, 15 %, 60 %) × agressivité` ;
  7. constructions selon la personnalité (villes, ports, usines, silos, SAM après un tir nucléaire subi, radar, aérodrome) ;
  8. débarquements quand aucun voisin terrestre n'est attaquable ;
  9. alliances avec les voisins forts sans rancune, renouvellements, dons aux alliés attaqués ;
  10. réponses aux demandes après un délai : la probabilité dépend de la personnalité, de la taille relative, de la rancune, de l'historique de trahison et de la difficulté ;
  11. **nucléaire** : vengeance d'abord, puis plus forte rancune, puis le leader pour les bellicistes. Cibles : grappes de villes et silos, en évitant les zones couvertes par des SAM selon la qualité de ciblage ;
  12. vote au conseil.
- **Personnalités** (ratio de troupes / agressivité / seuil de force) : Expansionniste 62 % / 1,2 / 1,0 ; Bâtisseur 50 % / 0,7 / 1,4 ; Marchand 45 % / 0,6 / 1,5 ; Diplomate 55 % / 0,6 / 1,3 ; Isolationniste 60 % / 0,5 / 1,6 ; Belliciste 75 % / 1,6 / 0,85. Elles sont affichées discrètement dans la carte de survol et le panneau Diplomatie.
- **Difficultés** :

| | Revenu | Agressivité | Ciblage | Trahison | Troupes | Réflexion |
|---|---|---|---|---|---|---|
| Facile | ×0,7 | ×0,6 | 40 % | 5 % | ×0,85 | ×1,6 |
| Normal | ×1 | ×1 | 70 % | 12 % | ×1 | ×1 |
| Difficile | ×1,35 | ×1,3 | 90 % | 20 % | ×1,15 | ×0,8 |
| Impossible | ×1,9 | ×1,6 | 100 % | 30 % | ×1,35 | ×0,6 |

## 14. Modes et fin de partie

| Mode | Règle |
|---|---|
| Chacun pour soi | 80 % des terres utiles (lobby : 50 à 100 %). **Prolongation** après 30 min : seuil 80 → 70 → 60 → 50 %, un palier toutes les 5 min (affiché dans le HUD) |
| Équipes | 2 à 8 équipes ; part cumulée de l'équipe ; une encre par équipe |
| Humains contre nations | humains équipe 1, nations équipe 2 |
| Solo contre tribus | aucune nation, entraînement |
| Horloge de l'apocalypse | 10 min de grâce, puis seuils croissants toutes les 2 min : 2, 4, 7, 11, 17, 25, 35 % (FFA) ou 5, 10, 16, 24, 33, 45, 60 % (équipes). Sous le seuil : avertissement, puis −2 % de troupes par seconde (plancher 5 % du plafond) et −2 % de PV pour les navires |
| Battle Royale | toutes les 3 min, l'anneau se resserre (rayon × 0,8, minimum 8 % du petit côté) ; les tuiles hors zone deviennent inhabitables (hachures rouges) |
| Campagne | 6 missions à objectifs (§15.11) |
| Didacticiel | 9 étapes guidées (§15.11) |

Fins de partie supplémentaires : **dernier survivant** (si la partie a commencé avec au moins deux prétendants) et « tous les humains éliminés » (le leader gagne).

**Écran de fin** : classement, courbes de territoire dans le temps (échantillon toutes les 5 s) et or/troupes du joueur, statistiques, **export CSV**, accès aux replays, « continuer à regarder », « rejouer ». Le replay est enregistré automatiquement.

**Lobby** : carte (6 catégories), mode, équipes, difficulté, nations (0 à 100), tribus (0 à 200), seuil (au-delà de 100 % : bac à sable sans victoire ni prolongation, via le paramètre de lancement `threshold`), durée du spawn, multiplicateur d'or, or de départ des joueurs (bac à sable, 0 à 50 M), vitesse de jeu, ports, nucléaire, dons, usines, Water Nukes, décontamination, spectateurs, 10 fonctionnalités inédites activables. En LAN : code d'invitation et chat.

## 15. Fonctionnalités inédites

Chacune est implémentée, testée (`tests/unit/rules.test.ts`, `units.test.ts`) et activable dans le lobby (sauf 15.9 à 15.12, qui sont des fonctions de l'application).

1. **Météo et jour/nuit** : cycle de 8 min. La nuit (deuxième moitié du cycle) réduit la vision de 20 % (rayon 24 au lieu de 30), assombrit la carte et allume les villes. **Tempêtes** : ×0,6 sur la vitesse des navires dans la zone, nuages tourbillonnants et éclairs. **Brouillards** : voile clair qui masque les transports. Les cellules sont générées par le PRNG toutes les 45 à 100 s, durent de 90 à 180 s et dérivent. Rendu par shader.
2. **Brouillard de guerre** : visibilité calculée à basse résolution (cellules 4×4) par une distance chamfer 8-voisins (vision circulaire de 30 tuiles, 24 la nuit) depuis le territoire du joueur, de ses alliés et coéquipiers, plus des disques pour les radars (60), navires et avions (25) et la reconnaissance (40). Hors vue, la **géographie reste lisible** (atlas sépia assombri, un peu plus clair pour les zones déjà vues), mais les possessions, unités, bâtiments et étiquettes des autres joueurs sont masqués. La minimap applique le même masque. Le brouillard ne se lève qu'en spectateur ou en replay.
3. **Arbre technologique** : 5 branches × 4 niveaux. Coûts 60 / 150 / 300 / 500 points. Production `0,5 + 0,5 × niveaux_de_villes` points/s. Effets :
   - Économie : +10 % ouvriers ; +10 % trains ; +15 % ouvriers ; −10 % bâtiments.
   - Militaire : −10 % de pertes en collines et montagnes ; +10 % de vitesse ; −10 % de pertes partout ; +15 % de vitesse.
   - Marine : +20 % PV ; +20 % dégâts ; +25 % vitesse ; +30 % commerce.
   - Nucléaire : −10 % coût ; +25 % rechargement ; −15 % coût ; MIRV +2 ogives.
   - Défense : portée SAM +10 ; SAM +1 cible ; −5 % bâtiments ; SAM +1 cible et portée +15.
4. **Ressources stratégiques** : environ 1 gisement pour 9 000 tuiles de terre (10 à 180), espacés, avec des probabilités selon le terrain. Pétrole : +400 or/s. Uranium : −8 % sur le coût des bombes (maximum −40 %). Terres fertiles : +6 % de croissance (maximum 40 %). Métaux rares : −5 % sur le coût des bâtiments (maximum −30 %). Il faut posséder la tuile centrale du gisement. Icônes sur la carte (calque R) et panneau Statistiques.
5. **Loyauté et sécessions** : une tuile conquise à un joueur démarre à 70/255, à 200 si elle vient des terres libres. Elle gagne +4 par balayage (6 s), +12 près d'une ville ou d'un poste de défense (25 tuiles), ×1,5 sous Propagande. Toutes les 15 s, un joueur de plus de 400 tuiles avec une densité inférieure à 6 troupes par tuile peut voir une poche de loyauté basse (moins de 60) **faire sécession**. La zone (jusqu'à 12 % du territoire et 3 000 tuiles) devient une nouvelle tribu dotée de 80 % des troupes locales.
6. **Événements mondiaux** toutes les 4 à 6 min : crise (−25 % d'or, 2 min), pandémie (croissance ×0,5, −3 à −5 % de population), boom commercial (commerce et trains ×2), tempête solaire (radars aveugles 90 s), sommet de paix (trêve forcée de 60 s).
7. **Généraux** (choisis au lobby, touche E, recharge 5 min) : Blitz (+30 % de vitesse d'attaque, 30 s), Rempart (postes de défense ×2, 30 s), Sabotage (détruit le train ou le marchand ennemi le plus proche du point visé, dans 40 tuiles), Propagande (loyauté ×1,5 et aucune sécession, 60 s).
8. **Aviation et radars** : voir §11 et §7.
9. **Replays et mode spectateur** : seed, configuration et commandes de chaque tour non vide, au format `.rpl` (JSON). Lecture ×0,5 à ×8, frise temporelle (le retour arrière re-simule depuis le début), caméra libre ou vue d'un joueur (avec son brouillard), import et export de fichiers.
10. **Éditeur de cartes** : pinceaux de terrain (11 types), d'altitude (élever, abaisser, lisser), import d'un PNG quelconque (couleur la plus proche et luminance comme altitude) ou d'un `.isomap`. Placement des spawns, nations et gisements, génération automatique, validation, **test immédiat**, enregistrement dans les cartes personnalisées, export pour partage.
11. **Campagne** : 6 missions avec dialogues, objectif principal, bonus et temps de référence (1 étoile pour la réussite, +1 sous le temps, +1 pour le bonus). Missions : Premières lignes (15 % des terres), Tenir la ligne (survivre 10 min), L'île (éliminer une nation), Rail et fortune (3 M via commerce et trains), Le soleil artificiel (lancer une bombe H), Minuit moins une (40 % en Apocalypse). Une mission se débloque quand la précédente est réussie. **Didacticiel** interactif en 9 étapes, environ 5 min, détectées automatiquement.
12. **Progression locale** : profil, statistiques cumulées, **30 succès**, 6 titres débloqués selon le nombre de succès, classement local des 20 meilleurs scores.
13. **Battle Royale** : voir §14.
14. **Conseil mondial** toutes les 10 min : 30 s de vote entre trois options (sanctions contre le leader : revenus /2 pendant 3 min ; interdiction nucléaire 3 min ; cessez-le-feu général 60 s). Le poids d'un vote vaut √population. L'IA vote selon sa situation.

## 16. Interface et contrôles

- **HUD** :
  - en haut : barre de territoire, chronomètre, mode, seuil, alertes (événement, cessez-le-feu, interdiction, immunité, traître, apocalypse) ;
  - en bas à gauche : population avec courbe, troupes et ouvriers, or avec détail au survol, ratio d'attaque, part des troupes, général, attaques en cours (annulables) ;
  - en bas à droite : minimap interactive (combats récents, missiles, navires) et barre de construction (coûts, raccourcis, infobulles riches) ;
  - à droite : classement (top 10 + soi, clic pour centrer) ;
  - à gauche : dock des panneaux (diplomatie, technologies, statistiques, journal, messages).
- **Menu radial** contextuel au clic droit, avec sous-menus et quantités ×1/×2/×5/×Max.
- **Raccourcis** : remappables dans Paramètres → Contrôles. Ils sont stockés par position physique (`KeyboardEvent.code`), donc ZQSD sur AZERTY et WASD sur QWERTY.

| Action | Touche |
|---|---|
| Attaque / débarquement sur la cible survolée | G / B |
| Ratio − / + | T / Y, Maj + molette |
| Ville, port, usine, poste, silo, SAM | 1 à 6 |
| Radar / aérodrome | U / I |
| Navire de guerre | 7 |
| Bombe A (×5 à la deuxième pression), H, MIRV | 8, 9, 0 |
| Accepter / refuser une alliance | K / L |
| Sélectionner les navires de guerre | F |
| Vue terrain / brouillard / ressources / loyauté | Espace / V / R / N |
| Caméra | ZQSD/WASD, flèches, glisser (gauche ou milieu), +/−, molette, pincement |
| Centrer sur son territoire | H |
| Emojis | Alt + clic |
| Chat | Entrée |
| Pause (solo) / menu | P / Échap |
| Général | E |
| Capture d'écran | F12 |
| FPS et temps de tick | F3 |

- **Pavé tactile macOS** : défilement à deux doigts pour la caméra, pincement (`ctrl + wheel`) pour le zoom. **Molette Windows** : zoom. Le mode se règle dans les paramètres.

## 17. Réseau et déterminisme

- Toute aléa passe par **xoshiro128\*\*** seedé par splitmix32. Aucune utilisation de `Math.random` dans `src/core` (règle ESLint). Les ordres d'itération sont déterministes (tableaux, `Map`/`Set` par ordre d'insertion). Les caches dérivés sont de pures fonctions de l'état (par exemple, une version des bâtiments).
- **Lockstep** : le serveur relaie les tours (100 ms / vitesse), stampe chaque commande avec l'identifiant du joueur et la valide en deux temps : forme, puis état autoritaire (propriété, or, portée, phase). Il applique aussi un plafond de 25 commandes/s. Les clients simulent chacun localement.
- **Hash d'état** toutes les 50 ticks. En cas d'écart, le serveur envoie un **snapshot complet** et le client redémarre son Worker dessus. Un snapshot restauré reproduit exactement le futur (testé).
- **Reconnexion** automatique pendant 60 s (jeton), joueur marqué « Zzz » entre-temps. **Spectateurs** : ils rejoignent par snapshot.
- **Découverte** : balises UDP broadcast sur les ports 47777 à 47786 (le premier port libre est vérifié par bind), saisie manuelle IP:port et code d'invitation à 6 caractères. Le port de jeu est tiré au hasard entre 40000 et 49999, avec vérification par `listen`.

## 18. Données

Dossier utilisateur standard (`~/Library/Application Support/Isoline`, `%APPDATA%\Isoline`) :
- `settings/` : paramètres versionnés, avec migrations ;
- `profile/` : profil, succès, campagne ;
- `saves/` : 10 emplacements plus la sauvegarde auto toutes les 2 min (snapshot + journal des commandes) ;
- `replays/` : fichiers `.rpl` ;
- `maps/` : cartes personnalisées `.isomap` ;
- `logs/errors.log` ;
- `screenshots/`.

## 19. Équilibrage — notes

- Rythme visé : expansion libre en 1 à 3 min, premières villes à 1–2 min, premiers silos des IA vers 8 à 15 min. Une partie FFA sur une carte régionale dure 20 à 40 min (la prolongation garantit une fin).
- Le terme territorial à exposant 0,55 et le malus des grands empires limitent la boule de neige sans l'empêcher.
- Valeurs ajustées par simulation sans affichage (`npx tsx scripts/bench.ts`) et parties observées en accéléré.
