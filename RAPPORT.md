# Rapport de livraison — Isoline 1.6.0

Ce rapport fait le point sur ce qui est livré, ce qui a été mesuré, les écarts avec le cahier des charges et les limites connues. Toutes les mesures viennent de scripts du dépôt et peuvent être reproduites (`npm run bench`, `npm run bench:app`, `node scripts/perf-app.mjs soak`, `npm run verify:packages`).

**Machine de mesure** : Mac mini Apple M4 Pro (12 cœurs, 24 Go), macOS 27.2, écran 144 Hz, Node 24.19, Electron 44.5.

## 0. Version 1.6 : huitième lot de retours

| Retour | Réponse |
|---|---|
| Adapter le jeu aux résolutions (MacBook Air M2 : tout est serré) | Échelle automatique de l'interface (`min(L/1600, H/900)`, bornée de 85 à 125 %) : 92,5 % sur le MacBook Air (1470×880 ou 956), 85 % en 1366×768, 100 % de 1600×900 à 1920×1080, 115 % en 1440p ; réglage manuel de 75 à 150 %. Barre de construction compacte puis sur deux lignes, classement réduit au top 5, listes d'attaques en pastilles, mini-carte et barre du haut qui se resserrent, panneaux placés selon la hauteur réelle des autres. Vérifié sur une matrice de 108 captures de 1280×720 à 2560×1440. |
| Refaire les bateaux de troupes et de combat | Nouvelles silhouettes vues de dessus (transport, destroyer, porte-conteneurs) à la couleur du propriétaire, contour sombre ; tourelles qui suivent la cible, éclair au tir, fumée sous 50 % de vie, barre de vie, croix de réparation à quai, chevrons de vétéran ; sillage selon la vitesse ; obus traçants avec impact. 20 à 34 px à l'écran ; au moins 162 FPS sur le Monde avec 640 navires. |
| Trouver des choses à ajouter | **Opinion des nations** (jauge, raisons chiffrées, chance d'accord calculée par la même formule que l'IA ; les dons, l'alliance, le commerce et l'ennemi commun comptent) ; **« Reprendre d'ici »** depuis un replay ou la une de fin de partie, avec le pays de son choix ; **mode photo** (F2 : interface masquée, calques et heure du jour réglables, capture). |
| Vérifier qu'il n'y a pas de bug | Parties simulées sur les 41 cartes × 9 variantes avec contrôles d'invariants, de déterminisme, de sauvegarde et de replay ; passage de l'application entière. 15 bugs corrigés, dont des navires de guerre bloqués pour de bon (environ la moitié en fin de partie sur l'Europe et le Monde), des débarquements de l'IA de plus de 10 minutes, les noms restés dans l'ancienne langue après un changement en jeu, deux succès impossibles, des alliances conservées par les éliminés. |

Mesures : 254 tests unitaires et d'intégration, 5 e2e ; 368 parties simulées sur 369 sans anomalie (la dernière est un voyage fluvial de 4 000 tuiles encore en cours).

## 0. Version 1.5 : septième lot de retours

| Retour | Réponse |
|---|---|
| Un refus d'alliance doit sonner comme un rejet ; la déchirure plutôt pour la trahison | Refus : tampon « Refusé » (ou « Sans suite ») qui s'abat sur le document, coup de tampon et note de rejet. Trahison : le pacte se déchire, au même endroit, avec le son de papier déchiré. |
| « Afficher le détail » revient à l'ancien écran de victoire | Un seul journal de fin : page 1 la une, page 2 « Résultats et statistiques » (classement avec drapeaux, bilan, distinctions, archives, actions). L'ancien écran est supprimé, campagne comprise (« Communiqué de mission »). |
| Campagne : mission 3 terminée en éliminant une tribu, ancienne fin | Objectifs requis tous nécessaires et tribus exclues des éliminations ; tests unitaires pour chaque mission ; fin de mission dans le nouveau journal. |
| Enlever le didacticiel, présenter les nouveautés, pas d'argent quand le guide demande une ville | Didacticiel supprimé (la mission 1 en reprend les bases) ; centres de recherche, capitale, bateaux et rappel, routes commerciales, alliances, météo, frontières menacées enseignés au fil des missions ; « Il vous faut X d'or (encore Y s) » avant chaque construction et or de départ adapté. |
| Le journal et les alliances passent devant l'objectif | Objectifs et guide regroupés en bas au centre ; les fenêtres s'ouvrent au-dessus ; vérifié en 1280×800, 1600×900 et 1920×1080 (test e2e). |
| Icônes trop petites sur la carte | Bâtiments à 24–36 px à l'écran (10–18 avant), classés et espacés pour ne pas couvrir la carte vue de loin. |
| Les rivières ne servent à rien | Rivières reliées à la mer navigables (navires à 0,6× de leur vitesse), débarquements sur les berges, ports fluviaux ; données des cartes réparées (77 à 82 % des rivières atteignent la mer, contre 47 à 56 %). |
| Plus de cartes : arcade, planètes, pop culture | 16 cartes : 7 d'arcade symétriques, 4 planètes (Mars, la Lune, Titan, Océanide) avec leur palette, 5 légendes (Atlantide, les Neuf Mondes, l'Olympe, la Terre du Dragon, la Mer des Flibustiers). Parties IA de 28 à 55 min. |
| Le jeu sur GitHub en privé, mis à jour depuis l'app | Dépôt privé `Lippou/isoline`. `npm run release` signe l'app (Developer ID), la fait notariser par Apple, vérifie les paquets, crée le tag et la release. Dans le jeu : vérification au lancement si l'accès est configuré (jeton GitHub en lecture seule dans Paramètres → Mises à jour, ou connexion GitHub CLI), téléchargement, contrôle de la signature (même équipe Apple) et redémarrage sur la nouvelle version. |

Mesures : 229 tests unitaires et d'intégration, 5 e2e ; app signée et notarisée, contrôle des paquets réussi.

## 0. Version 1.4 : sixième lot de retours

| Retour | Réponse |
|---|---|
| Tirs des navires de guerre trop rapides (cadence et projectile) | Un obus toutes les 3 s (au lieu de 1,8 s), qui vole à 3 tuiles par tick (au lieu de 9), toujours autoguidé et plus rapide que tout navire. |
| Replay : ×2, ×4, ×8 changent la vitesse mais l'affichage reste sur ×1 | Les boutons de vitesse et de pause suivent maintenant l'état réel. |
| Arbre des technologies trop vite terminé, facile à oublier ; des centres de recherche | Nouveau bâtiment **Centre de recherche** (touche J ; 250 k, 500 k, 1 M puis 2 M) : 1,5 point/s par niveau (0,5 sans centre), les villes ne produisent plus de recherche. 36 technologies sur 6 paliers (150 à 11 000 points, 143 100 au total au lieu de 17 300) plus une technologie sans fin par branche. Parties IA : palier II vers 10 min, III vers 15–20, IV vers 25–35, V vers 40–55. File d'attente (Maj+clic, 12 objectifs), rappel « Recherche à l'arrêt » (point sur le bouton, pastille au-dessus de la barre de construction, brève au journal), option « Continuer automatiquement ». |
| Pas de son en demandant une alliance depuis la Diplomatie | Chaque action de la Diplomatie, du Commerce et des Messages émet un son de confirmation ; le bouton passe à « Proposée… » pendant 20 s. |
| On ne voit plus le journal derrière l'arbre ; déplacer les fenêtres ; menu à gauche | Barre de menus verticale à gauche ; chaque panneau est une fenêtre déplaçable et redimensionnable, plusieurs ouvertes à la fois (Technologies et Journal côte à côte), positions mémorisées, « Replacer les fenêtres » dans le menu Échap. |
| Choisir un drapeau, l'afficher à côté des noms, créer le sien | 270 drapeaux réels ou éditeur (16 dispositions, 3 couleurs, 10 emblèmes) dans le profil et le salon ; le drapeau suit le joueur partout (carte, classement, journal, une, réseau local, sauvegardes, replays) et chaque nation a son drapeau devant son nom sur la carte. |
| Demande d'alliance reçue : petite fenêtre en bas à droite | Carte au style du bandeau de pacte, au-dessus de la mini-carte : drapeaux, nom, Accepter (K) / Refuser (L), barre des 20 s, empilement jusqu'à trois. |
| Garder les compétences (Blitz…) ? | Inchangé : elles se désactivent déjà dans le salon (« Généraux »). Avis ci-dessous dans la réponse. |

Mesures : 184 tests unitaires et d'intégration, 5 e2e. Rythme (IA seules, 3 graines × 3 cartes × 2 difficultés) : 17 parties sur 18 entre 28 et 50 min, une sans fin à 60 min (Monde, Normal, graine 1234 ; la prolongation la termine ensuite).

## 0. Version 1.3 : cinquième lot de retours

| Retour | Réponse |
|---|---|
| Encore des ondulations sur les territoires | Cause trouvée : l'heure de conquête de chaque tuile n'était gardée qu'à 256 ticks près, et l'animation de conquête se rejouait toutes les 25,6 s en vagues le long des anciens fronts. Les tuiles sont « fixées » une fois l'animation finie ; le fond des pays est uni (±3 % de relief). |
| Bombes A et H interceptées entre deux SAM, hors des zones affichées | La portée réelle comptait le bonus de recherche de l'IA (radar de tir +10, bouclier +15) que l'écran ignorait. Zones, survol, placement et prévision de trajectoire affichent maintenant la portée exacte de la simulation. |
| Musique relancée à chaque changement de page, coupée et reprise en jeu | Chaque clic relançait la musique (dans les menus, le même morceau depuis le début ; en jeu, le suivant). Corrigé, et un changement demandé pendant un fondu attend sa fin. Mesure : une seule mise en route pour 4 pages et 6 clics dans les menus, une seule pour 12 clics en partie. |
| Paramètres du menu Échap différents de ceux de l'accueil | C'est désormais la même page (papier clair, onglets à gauche, interrupteurs). |
| Trop de troupes au départ, 17 M en 20 minutes ; trop d'or trop vite | Départ 12 500 troupes (au lieu de 25 000), plafond `2 × (tuiles^0,6 × 800 + 25 000) + 60 000 par niveau de ville` (au lieu de 1 000, 50 000 et 250 000), régénération −20 %, commerce et trains à moitié. Partie IA à 20 min : meneur à ~3 M de troupes (au lieu de 9,5 à 16 M), nation moyenne ~0,9 M (au lieu de 2,8 M) ; or gagné −50 % environ. Écart assumé avec OpenFront. |
| Son différent pour l'élimination d'une tribu | Coup de taiko pour une tribu, cuivres pour une nation. |
| Navires de guerre qui partent se réparer au premier obus | Ils rompent le combat sous la moitié de leurs PV (75 % dans OpenFront). |
| Confirmation en cliquant sur un allié | Le clic gauche, les touches d'attaque et de débarquement, le bombardier et la bombe visant un allié demandent la même confirmation que le clic droit. |
| Pouvoir frapper son propre territoire, avec confirmation | Bombes A et H permises sur vos terres après confirmation ; MIRV refusé sur votre pays. |
| Être notifié d'un refus d'alliance comme d'une acceptation, mais différemment | Même bandeau que le pacte signé, mais déchiré (sceau barré, drapeaux qui s'écartent, déchirure rouge, son de papier déchiré) ; une demande restée sans réponse le signale aussi. Les bandeaux s'enchaînent quand plusieurs réponses arrivent ensemble. |
| Idée 1 : une de fin de partie | « Le Courrier des Isolignes — Édition finale » : titre selon le dénouement, récit, cartes de l'empire au fil du temps, courbe des terres avec les grands tournants, « Votre sort ». Chaque moment a un bouton « Revoir » qui ouvre le replay 8 s avant. |
| Idée 2 : routes commerciales visibles | Vue « Routes commerciales » (touche C, active par défaut) : vos lignes maritimes en tirets laiton, plus épaisses selon l'or rapporté, celles des autres en filets discrets, voies ferrées actives soulignées ; un embargo montre la route coupée pendant 10 s. Aucun coût mesurable en images par seconde. |
| Idée 3 : capitale au point de départ | Capitale marquée d'une étoile. Si elle tombe : 60 s de désorganisation (renforts et revenu −25 %, attaques −20 %), 10 % de l'or au conquérant, puis vous choisissez la nouvelle capitale (clic droit « Établir la capitale ici », ou « Au plus sûr ») ; sans capitale, revenu −10 %. Les IA se réinstallent seules. |
| Idée 4 : frontière menacée | Un voisin hostile 1,75 fois plus fort que vous (combats récents, mauvaise relation, ou plan d'attaque de l'IA) fait luire la frontière commune en ambre, avec une brève « Vigilance » au journal et une explication au survol. |
| Idée 5 : météo visible | Orages (pluie, éclairs, bandes en spirale) qui ralentissent navires (−40 %) et avions (−25 %), bancs de brouillard qui réduisent de moitié radars et détection des navires ; contour, icône et explication au survol, à toutes les qualités. |
| Conversion en site web (question) | Voir la réponse ci-dessous (§0.1). |

Autres corrections : chargement des sauvegardes et replays ouverts depuis la liste (erreur de copie vers le moteur de simulation) ; objectif de la mission 4 ramené à 1,5 M d'or (commerce divisé par deux) et sa narration réenregistrée ; seuil de victoire en prolongation prolongé jusqu'à 35 % (atteint à 60 min) pour finir les impasses entre continents.

Mesures (IA seules, Europe / Mer Noire / Monde, graines 1234, 42, 7, 99) : Normal 12 parties entre 31,9 et 56,4 min ; Difficile 11 sur 12 entre 34 et 55 min, une à 70 min (Monde). Tests : 163 unitaires et d'intégration, 5 e2e, contrôle des paquets réussi. App empaquetée 1.3.0, carte Monde, 100 joueurs : 144 FPS synchronisés, minimum compris (zoom moyen et carte entière), tick 0,95 à 1,17 ms.

### 0.1 Une version web ?

Possible, et sans risque de régression si on l'ajoute à côté de la version de bureau plutôt qu'à sa place : le jeu est déjà écrit en technologies web (Svelte, PixiJS/WebGL, simulation dans un Web Worker) et contient déjà une variante « navigateur » de son pont avec le système. À prévoir : sauvegardes et replays dans IndexedDB (le stockage du navigateur limité à quelques Mo ne suffit pas), le multijoueur LAN remplacé par un petit serveur relais WebSocket (le navigateur ne peut pas ouvrir de port local), les 37 Mo de musique, voix et cartes chargés à la demande et mis en cache, l'hébergement et la licence. Les tests e2e devraient alors tourner aussi dans un navigateur. Intérêt : partage par simple lien, mises à jour instantanées, multijoueur en ligne. Coût : quelques jours pour une version solo, nettement plus pour le multijoueur en ligne (serveur, comptes, anti-triche).

## 0. Version 1.2 : retours de test traités

Référence : le code source d'OpenFront (dépôt `openfrontio/OpenFrontIO`, état du 1er octobre 2026), relu pour en reprendre les règles et les valeurs. Le code d'OpenFront (AGPL) n'a pas été copié : les règles sont réécrites dans le style d'Isoline.

| Retour | Réponse |
|---|---|
| Pas de « bip bip » quand ce n'est pas notre pays qui est touché | La sirène et l'alerte ne concernent plus que les pays dont les terres sont dans le souffle (le pays visé pour un MIRV), comme dans OpenFront. Survoler un pays ne déclenche plus rien. Au plus une sirène toutes les 4 s. Le bruit de lancement ne s'entend que pour ses propres tirs, ceux qui vous visent ou ceux visibles à l'écran. Test unitaire ajouté. |
| Voir la zone protégée par les SAM au lancement d'un missile | Pendant la visée (et au survol des boutons nucléaires, silo et SAM, et au placement d'un silo ou d'un SAM) : portée de chaque SAM connu, les vôtres en vert, ceux des alliés en jaune, les autres en rouge, en contours pointillés tournants fusionnés. |
| Voir la trajectoire pour esquiver les SAM, l'inverser (effet miroir) avec un bouton ou un panneau | La trajectoire est désormais **simulée** (arc de Bézier d'OpenFront, hauteur `max(d/3, 50)`). Elle s'inverse avec **U** ou dans le nouveau **panneau de lancement** (salve, arc haut / arc bas, verdict). L'aperçu montre le silo qui tirera, les zones hors de portée des SAM (pointillés fins), le point d'interception prévu (croix rouge) et les cercles de souffle. Test unitaire : un même tir est intercepté en arc haut et passe en arc bas, et l'aperçu le prédit. |
| Le jeu est dur à comprendre visuellement sur la carte | Badges au-dessus des noms (OpenFront), noms colorés par relation avec un contour sombre, frontières teintées (allié vert, guerre rouge pulsé, embargo rouge pâle), territoires plus contrastés et frontières plus épaisses, niveau des bâtiments en chiffres, missiles en vol avec cercles d'impact aux couleurs du lanceur. |
| Alliance : poignée de main et nom en vert ; traître : bouclier cassé et nom en jaune ; guerre : nom en rouge et une épée ; pas de commerce : dollar barré | Fait, sur la carte, dans la carte de survol et le panneau Diplomatie. S'y ajoutent, comme dans OpenFront : couronne (premier), enveloppe (demande d'alliance), radioactivité (missile en vol, rouge s'il vous vise), lune (inactif). La guerre dure tant qu'une attaque, un débarquement ou un missile vous oppose, puis 10 s. |
| Revérifier ce qu'offre OpenFront et reprendre son fonctionnement | Repris : économie complète (ci-dessous) ; SAM (un missile par niveau, 9 s de recharge, portée `150 − 480/(niv + 5)`, interceptions certaines, missiles atteignables seulement à moins de 150 tuiles de leur silo ou de leur cible) ; silos (un tube par niveau, 9 s) ; souffle (rayon intérieur rasé, moitié des tuiles jusqu'au rayon extérieur, bâtiments et unités détruits) ; pertes `troupes × (part restante)^5` ; MIRV (jusqu'à 350 ogives sur tout le pays visé) ; trahison (traître 30 s, rompre une alliance compte) ; embargo de 5 min contre tout agresseur ; alliances qui lèvent ces embargos et rappellent les missiles en vol ; espacement de 15 tuiles entre bâtiments. Combat : rapport de forces d'OpenFront (voir plus bas), sur les fronts arrondis d'Isoline. Conservées : les fonctions inédites d'Isoline (aviation, radar, technologies, ressources, météo, loyauté, conseil). |
| Les villes ne montent pas en prix comme dans le jeu de base ; retrouver l'économie originale | Prix d'OpenFront : ville, port et usine `125 000 × 2ⁿ` **plafonnés à 1 M** ; SAM 1,5 M puis 3 M ; poste de défense jusqu'à 250 000 ; navire de guerre jusqu'à 1 M (n compte les niveaux construits, chantiers et améliorations compris ; un bâtiment perdu fait baisser le prix). Or fixe de 1 000/s, sans ouvriers. Troupes : plafond `2 × (terres^0,6 × 1 000 + 50 000) + 250 000 par niveau de ville` et régénération `(10 + troupes^0,73 / 4) × (1 − troupes / plafond)`. Commerce maritime et trains aux formules d'OpenFront (les deux ports payés). Conquête : trésor de la nation vaincue (moitié pour un humain). |

**Retours suivants (même version)** :

| Retour | Réponse |
|---|---|
| Combats totalement inégaux : 3 M de troupes bloquées face à une nation de 100 000 sans défense ; tribus trop résistantes | Logique de rapport de forces d'OpenFront : la vitesse du front et les pertes dépendent de « armée du défenseur / troupes de l'attaque ». Mesure sur un terrain plat : 3 M contre 100 000 (3 000 tuiles) rasés en 4,9 s pour 3 % de pertes ; 3 contre 1 en 6,5 s ; à 1 contre 1 l'attaque prend 35 % du pays en 48 s puis s'épuise ; 20 % d'une armée de 1,5 M rase une tribu à son plafond en 5 s. 6 tests unitaires figent ce comportement. |
| Bateaux (transport, guerre) et trains trop grands ; les trains doivent s'articuler | Tailles minimales à l'écran réduites de moitié environ (navires 26 à 36 px au lieu de 50 à 70) ; taille réelle de près. Trains en locomotive et wagons séparés qui suivent le tracé parcouru. |
| En attaque, de vrais cubes rouges trop gros | Bords de territoire lissés dans le shader (mélange de propriété sur les 4 cases voisines) : courbes au lieu de l'escalier des cases ; étincelles de conquête 3 fois moins nombreuses et plus petites. |
| Un visuel quand un pacte de paix est signé ; un son de papier signé, pas des trompettes | Bandeau « Pacte d'alliance signé » (drapeaux scellés, signature tracée) au-dessus de la barre de construction, arc vert entre les deux capitales ; son : plume sur parchemin (Freesound 326961, CC0). |
| Au survol de la barre de construction, ne voir que les bâtiments correspondants, avec les distances (SAM, usines…) | Filtre : bâtiments du type survolé mis en valeur (halo, visibles à tous les zooms), les autres estompés ; portées des vôtres (défense 30, usine 110, port, radar, aérodrome), SAM par relation. Aussi pendant le placement. |

**Troisième lot de retours (même version)** :

| Retour | Réponse |
|---|---|
| Bruit d'épée à chaque clic ; pièces trop fréquentes ; sons trop répétés ; trahison audible par tous | Bruit de clic d'attaque supprimé ; pièces de pillage toutes les 4 s au plus ; intervalles minimaux allongés (pièces 3 s, canon 1,5 s, train 20 s…) ; combats, interceptions et naufrages audibles seulement s'ils vous concernent ou sont à l'écran ; trahison pour le traître et la victime seulement. |
| Voir les troupes engagées dans une attaque, et celles de la contre-attaque | Pastille sur chaque front (vos troupes à votre couleur, celles qui vous visent en magenta) et liste « Attaques reçues ». |
| Clic droit avec un bâtiment sélectionné : désélectionner | Le clic droit annule l'outil ou la sélection en cours. |
| Arrêter, accélérer ou ralentir le temps | Pause, ×½, ×1, ×2, ×4 dans la barre du haut (solo), touches `[` et `]` ; la vitesse du lobby est maintenant appliquée. |
| « tech.economy.3 » dans le journal | Le nom de la technologie est affiché. |
| Une vraie direction artistique, des menus plus riches, plus d'animation | Direction « Levé hydrographique » (`BRAND.md` §4) : menus clairs façon carte marine, isolignes qui se tracent (accueil, transitions, chargement), menu en légende, lobby en trois étapes avec aperçus façon carte marine et nations, campagne en itinéraire, profil, réglages, replays et « À propos » refaits. Revue avec les skills de design (frontend-design, ui-ux-pro-max, design-critique) et corrections : focus clavier, contrastes AA, mise en page en 1280×800. |
| Au survol d'un pays : villes, ports, usines, navires… | Fiche de survol : bâtiments par type (et niveaux), navires de guerre, transports. |
| Bateaux trop rapides (les détruire à la bombe A) | Une case par tick comme OpenFront (environ 2 fois plus lents) ; un test vérifie qu'une bombe A détruit un transport en route. |
| Le jeu est trop sombre | Mers et reliefs éclaircis, cycle jour/nuit réduit à un léger crépuscule, fonds clairs. |
| Trop grand au départ | 52 tuiles au départ (OpenFront) au lieu d'environ 200. |
| Accepter une alliance par clic droit sur le pays | « Accepter son alliance » / « Refuser » quand le pays l'a proposée. |
| Voir les alliances en cours et leur durée | Bloc « Alliances en cours » toujours visible : durée, barre, renouvellement. |
| Navires de guerre qui détectent de trop loin | Portée 90 (au lieu de 130), patrouille 70, plus de chasse au-delà de la zone de patrouille (règles d'OpenFront). |
| Continuer à jouer à la fin d'une partie | Bouton « Continuer à jouer » : la partie reprend sans nouvelle victoire. |
| Plus de cartes | 11 cartes ajoutées (25 au total) : Îles britanniques, Scandinavie, Balkans, Moyen-Orient, Inde, Japon et Corée, Asie du Sud-Est, Caraïbes, Continents jumeaux, Fjords, Anneau. |

Mesures après ce lot (app empaquetée 1.2.0) : démarrage 2,1 s ; 144 FPS synchronisés ; sans synchronisation, 298 à 329 FPS au zoom moyen et 553 à 638 sur carte entière ; tick 0,88 à 1,05 ms. Rythme (8 graines × 3 cartes × 2 difficultés) : 45 parties sur 48 entre 25 et 60 minutes (22 à 58 min, médiane 35 min). Tests : 91 unitaires et d'intégration, 5 e2e.

**Quatrième lot de retours (même version)** :

| Retour | Réponse |
|---|---|
| L'indicateur de troupes en attaque bouge trop, texte illisible ; un par front | Le serveur de simulation regroupe la ligne de front en tronçons (jusqu'à 4 par attaque) ; chaque pastille reste fixée tant que son tronçon ne s'éloigne pas de plus de 28 tuiles, puis glisse doucement. Pastille sombre, chiffre en gras 15 px, épée à la couleur du camp. |
| La musique coupe et boucle bizarrement | Plus de boucle native (couture audible) : le morceau suivant prend le relais en fondu 5 s avant la fin. Changement d'ambiance (calme, tension, guerre) avec hystérésis et durée minimale, pour ne plus basculer sans cesse. |
| Combats encore inégaux : reprendre la mécanique de base d'OpenFront | Portage des règles d'`AttackExecution` et de `attackLogic` : chaque tick, l'attaque prend autant de tuiles que la longueur de son front (plus 0 à 4) ; terrain (plaine, colline, montagne), poste de défense (×5 pertes, ×3 coût), retombées ; pertes et vitesse selon le rapport « armée du défenseur / troupes envoyées » ; choc frontal des attaques opposées ; défenseur sous 100 tuiles annexé. Envoi par défaut : 20 % des troupes. Mesures : à 1 contre 1, environ 31 tuiles par tick sur un front de 60 ; 3 M contre 100 000 (3 000 tuiles) rasés en 7,3 s pour 3 % de pertes ; une tribu à son plafond tombe en 6,5 s. |
| Curseur personnalisé | Curseurs dessinés pour Isoline : flèche encre à pointe laiton (losange du logo), variante laiton sur ce qui est cliquable, réticule de géomètre sur la carte (encre), laiton pour construire, magenta pour viser un missile. |
| Trahir doit aussi fragiliser (OpenFront) | Relations d'OpenFront : la victime passe à −100 envers le traître, ses autres voisins à −40, un pays attaqué de −60 à −100 selon la difficulté (retour lent vers 0). Les nations refusent l'alliance d'un pays mal vu et 90 % des demandes d'un traître, et attaquent un traître voisin plus faible même allié (sans devenir traîtres). Toujours : marque de traître 30 s (×0,5 pertes et ×0,8 coût pour ceux qui l'attaquent), embargo de 5 min, annonce mondiale. |
| Les navires regagnent de la vie au port le plus proche, sans tirer, en restant vulnérables | Sous 75 % de vie, le navire rentre au port le plus proche de sa mer, sans tirer, toujours ciblable. À quai (un navire par niveau de port) : intouchable, +5 PV par niveau de port et par tick, puis retour en patrouille. +1 PV par tick à moins de 105 tuiles d'un de vos ports. Un ordre de déplacement annule le retour. |
| Menu « Commerce » : avec qui on échange, poser un embargo, voir qui nous en impose un | Nouveau panneau Commerce (barre en haut à gauche) : or gagné en 5 minutes par la mer et par le rail, partenaires classés par or avec navires et trains en route, embargo en un clic ; liste des embargos (le vôtre, contre vous, réciproque, temporaires après une attaque, avec la durée restante) ; « Embargo sur tous sauf alliés », « Lever tous mes embargos ». |
| On peut attaquer un pays lointain en cliquant dessus | Comme OpenFront, une attaque terrestre exige une frontière commune (terres libres : reliées à vous à moins de 200 tuiles). Sinon, message « Aucune frontière commune : envoyez un bateau (B ou clic droit → Débarquer) » ; plus de bascule automatique vers un débarquement, ni d'effet diplomatique. |
| Accepter ou demander une alliance plus visible au clic droit | En tête du menu, cadre vert : « Accepter son alliance » (avec « vous propose une alliance ») ou « Proposer une alliance ». |
| Trois bateaux au maximum à la fois | Limite de 3 transports (OpenFront) ; liste « Bateaux en mer (n/3) » dans le panneau des ressources. |
| Enlever les « ondes » sur les territoires | Relief et biomes aplanis sous la couleur des pays (seul un léger ombrage reste) ; plus de cercles de portée d'usine au survol. |
| Le SAM protège trop loin | Portée ×0,7 : 49 tuiles au niveau 1, 71 au niveau 5, 105 au plus ; distance d'interception des missiles 105. |
| Annuler un envoi de bateau ou une attaque | Bateau : bouton de rappel dans « Bateaux en mer », il rentre à la côte la plus proche et rend 75 % des troupes (100 % s'il n'a pas de côte). Attaque : ✕ dans « Attaques en cours », gel de 2 s puis retour de 75 % des troupes (100 % sur terres libres), affiché « repli ». |
| Un bouton pour contre-attaquer avec pile les troupes qu'il faut | « Riposter » sur chaque attaque reçue : envoie 110 % des troupes adverses (dans la limite des vôtres), qui annulent l'assaut au choc. |
| Une cible sur le point de débarquement | Réticule pulsé sur la plage visée, relié au bateau par un trait fin, jusqu'à l'arrivée (retiré si le bateau est rappelé). |
| Journal en papier journal ; quand une nation tombe, un article qui se déplie | « Le Courrier des Isolignes » : édition à l'heure de la partie, rubriques (Tout, Conflits, Vigilance, Bonnes nouvelles), titres par minute et brèves, liens vers la carte. Chute d'une nation : « Édition spéciale » dépliée en haut à gauche, drapeau, titre et cause (défaite au combat face à…, capitulation, anéantissement nucléaire, hors de la zone), puis repliée dans le bouton Journal. |
| Technologies plus élaborées ; débloquer le nucléaire pour que l'économie passe avant la guerre | Arbre de 24 technologies (6 branches, 5 paliers, 100 à 2 400 points). Silo et bombe A exigent le « Programme nucléaire » (lui-même après Banque centrale et Industrie lourde), puis bombe H, MIRV, SAM, radar et aviation ont leur technologie. Recherche d'une cible lointaine (prérequis enchaînés et numérotés), fiche détaillée, verrous visibles dans la barre de construction et le panneau de lancement. |
| Nuages légers en vue dézoomée | Nuages et leur ombre dans le shader de la carte, en fondu à partir d'un zoom ×1,1 ; désactivés en mode performance et en mouvement réduit. |
| Événement mondial : l'infobulle affiche « World Event » ; le détailler à gauche en « flash info » | Infobulle corrigée (les 5 événements ont titre, description chiffrée et effet). Carte « Flash info » à gauche : effet principal, explication, début et fin avec barre, décisions du Conseil en vigueur et prochaine séance ; repliée après 30 s. |

Mesures après ce lot (app empaquetée 1.2.0, carte Monde, 100 joueurs) : 144 FPS synchronisés, minimum compris, au zoom moyen comme sur carte entière ; tick 0,97 ms ; carte prête en 0,37 s. 125 tests unitaires et d'intégration, 5 e2e, contrôle des paquets réussi. Rythme (IA seules, Europe / Mer Noire / Monde, 8 graines en Normal et 12 en Difficile) : 58 parties sur 60 entre 25 et 60 minutes (médiane 40 min en Normal, 35 en Difficile). Une partie dure moins de 25 minutes (Mer Noire, 24,0 min). Une autre ne se termine pas (Monde, Difficile, graine 42) : chaque survivant tient un continent et le seuil de victoire en prolongation s'arrête à 50 % (OpenFront n'a pas ce plancher).

Écarts assumés avec OpenFront :
- Un navire qui rentre au port ne tire pas (la demande) alors qu'OpenFront le laisse riposter.
- Le seuil d'annexion reste celui d'OpenFront (100 tuiles) : un pays tout juste apparu (52 tuiles) est annexé dès sa première tuile perdue une fois l'immunité finie.
- Un transport embarque au moins 50 troupes ; la trahison garde l'embargo de 5 minutes d'Isoline.

**Rythme mesuré avant ce dernier lot** (`npm run pacing`, IA seules, fin de partie en minutes, Europe / Mer Noire / Monde) :

| Difficulté | Graine 1234 | Graine 42 |
|---|---|---|
| Facile | 31 / 43 / 40 | 45 / 40 / 40 |
| Normal | 36 / 27 / 30 | 27 / 25 / 40 |
| Difficile | 28 / 30 / 40 | 36 / 33 / 41 |
| Impossible | **18** / 37 / 46 | 35 / **14** / 45 |

22 parties sur 24 durent de 25 à 46 minutes. Les deux parties trop courtes sont en Impossible, entre IA : une nation y fait boule de neige. Restreindre davantage l'IA Impossible faisait chuter d'autres parties (Difficile, Mer Noire) sous 22 minutes ; la variante retenue est celle qui laisse le moins de cas extrêmes. Les combats plus décisifs raccourcissent les parties : avant la refonte du combat, elles duraient de 35 à 59 minutes.

Corrections de l'IA pour garder ce rythme :
- avec des prix plafonnés, une nation riche n'achetait plus que des villes : elle choisit désormais par tirage pondéré (silos, SAM et ports aussi) ;
- deux empires séparés par l'océan ne s'attaquaient plus : une armée au plafond tente des débarquements outre-mer ;
- offensives dimensionnées à la moitié de l'armée visée et guerres plus espacées, contre-attaques qui annulent l'assaut.

Points d'attention :
- L'économie est nettement plus riche qu'en 1.1, comme dans OpenFront. Une nation gagne environ 15 M d'or en 10 minutes sur la carte Monde, surtout grâce au commerce. Les plafonds de troupes atteignent des dizaines de millions en fin de partie.
- Les replays enregistrés avec une version précédente se rejouent avec les nouvelles règles et divergent : la liste des replays le signale. Les sauvegardes 1.1 se chargent ; l'historique de construction y est reconstitué à partir des bâtiments possédés.
- La tour radar passe de U à O ; les réglages existants sont migrés.
- La réplique de campagne `guide.m2.troops` a été réécrite (le curseur « part des troupes » n'existe plus) et sa voix régénérée.

## 0 bis. Version 1.1 : retours de test traités

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
| macOS universel (Intel + Apple Silicon) | ✅ DMG 253,0 Mo et ZIP 251,6 Mo, signature ad hoc vérifiée (`codesign --verify --deep --strict`) | `dist/Isoline-1.2.0-mac-universal.{dmg,zip}` |
| Windows x64, installeur | ✅ NSIS 144,0 Mo (choix du dossier, raccourcis bureau et menu Démarrer, désinstalleur, icône) | `dist/Isoline-1.2.0-win-x64-setup.exe` |
| Windows x64, portable | ✅ 143,7 Mo | `dist/Isoline-1.2.0-win-x64-portable.exe` |
| `npm run verify:packages` | ✅ 27 contrôles, dont lancement de l'app macOS en `--smoke-test` (code 0) | `scripts/verify-packages.mjs` |
| Documentation | ✅ `README.md`, `GAME_DESIGN.md`, `BRAND.md` + `brand/`, `CREDITS.md`, `CHANGELOG.md`, ce rapport | racine |
| Médias | ✅ 15 captures 1920×1080, GIF de 10 s, vidéo de 58 s en 1080p | `docs/media/` |
| Mesures brutes | ✅ | `docs/bench.json`, `docs/perf-app.json`, `docs/perf-app-uncapped.json`, `docs/soak.json` |

## 2. Performances mesurées (§19)

| Exigence | Cible | Mesure | Verdict |
|---|---|---|---|
| Démarrage jusqu'à l'écran titre | < 5 s | **2,1 s** (app empaquetée 1.2.0, `dist/mac-universal`) | ✅ |
| Chargement d'une carte de 2 M de tuiles | < 3 s | Monde (2,01 M) : 0,41 s de décodage et d'analyse, 0,35–1,0 s de « lancer » à « carte affichée » dans l'app empaquetée. Monde géant (5,16 M) : 0,96 s | ✅ |
| FPS, 100 nations, zoom moyen | ≥ 60 (M1) | 144 FPS stables, plafond de l'écran de mesure (144 Hz) ; sans synchronisation verticale : **298 à 329 FPS** au zoom moyen, 553 à 638 sur carte entière (100 nations + 100 tribus, 1.2.0). En 1.1.0 : 447 à 485 et 809 à 1 055 ; l'écart vient surtout de la flotte marchande, bien plus nombreuse avec l'économie d'OpenFront | ✅ sur M4 Pro ; **M1 non testé** (§4) |
| FPS sur portable Windows à GPU intégré | ≥ 30 | non mesuré (aucune machine Windows) | ⚠️ |
| Tick de simulation | < 50 ms en moyenne | App 1.2.0, 100 nations, Monde : **0,88 à 1,05 ms** en moyenne. Mesures 1.1 : 0,69 ms, p99 4,0 ms, max 7,2 ms (6 000 ticks). Monde géant, 100 nations : 1,08 ms | ✅ |
| Mémoire | < 1,5 Go | 0,74–0,81 Go (tous processus Electron) à 100 nations ; pic à 1,01 Go pendant l'endurance (mesurée en 1.0) | ✅ |
| Taille de l'app | < 300 Mo | Téléchargements : 253 Mo (macOS universel), 144 Mo (Windows), dont 42 Mo de musique, bruitages et voix. Installée : 378 Mo (Windows), 510 Mo (macOS, deux architectures) | ⚠️ voir §4 |
| Stabilité | pas de fuite sur 60 min ; pas de crash sur 30 min à 50 nations | Endurance : 60 min de jeu à 50 nations (×8), aucune erreur, mémoire stable (§2.2) ; 30 min sans affichage à 50 nations sans erreur | ✅ |
| Déterminisme | même seed et mêmes commandes = même hash | Vérifié sur macOS (tests et `bench`) ; LAN 4 clients pendant 20 min sans désynchronisation. **Windows non vérifié** | ✅ / ⚠️ |
| Couverture de `src/core` | ≥ 70 % | instructions 88,5 %, branches 79,7 %, fonctions 92,8 %, lignes 91,2 % (1.2.0) | ✅ |

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
| Modes | ✅ | FFA, équipes, humains contre nations, tribus, Apocalypse, prolongation, Battle Royale, campagne (6 missions, qui sert de didacticiel) |
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
4. Tests (91 unitaires et d’intégration, 5 e2e), performances mesurées : ✅
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

- `npm test` : 79 tests Vitest (1.2 : rapport de forces au combat, trajectoires inversables et prédiction d'interception, chargeur des SAM, MIRV, alertes ciblées, traître de 30 s, embargo temporaire, migration des sauvegardes, prix et formules d'OpenFront ; avant : 57) (règles, combat, économie, unités, IA, déterminisme, snapshots, serveur LAN avec 4 clients pendant 20 min et une reconnexion, forme des fronts, seuil bac à sable, pillage des tribus, rayon d'action des ports, comptabilité des retombées).
- `npm run test:e2e` : 5 parcours Playwright dans Electron (solo jusqu'à la capitulation et l'écran de fin ; tous les écrans ; spectateur et replay ; LAN à deux instances ; campagne : briefing, guide et progression des étapes).
- `npm run pacing` : durée des parties entre IA (équilibrage).
- Bug trouvé en 1.1 grâce aux captures (« -0,0 % » au classement) : une intensité de retombées de 256 repassait à 0 dans un octet et faussait le compte des terres utiles, donc les parts de territoire et la victoire. Corrigé, avec un test de non-régression.
- `npm run lint`, `npm run typecheck` : 0 erreur.
- `node scripts/i18n-keys.mjs` : 487 clés utilisées, aucune manquante en FR ou en EN.
- Parties observées en accéléré (spectateur) jusqu'à la victoire, captures relues : c'est ainsi qu'ont été trouvés et corrigés les fronts en losange, le brouillard qui laissait voir les unités, les retombées confondues avec un territoire et le titre « Défaite » affiché aux spectateurs.
