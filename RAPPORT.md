# Rapport d'avancement

## Écarts et décisions d'environnement
- **Dossier de travail** : le cahier des charges prévoit `~/projets/<nom-du-jeu>/`. La session de développement a été lancée dans `~/Desktop/Jeu/Claude Opus 5.5 High/` (dossier dédié à ce projet) ; le projet est donc créé dans `~/Desktop/Jeu/Claude Opus 5.5 High/isoline/` afin de ne rien écrire hors du dossier de travail fourni. Tous les caches (npm, Electron, electron-builder) sont redirigés dans `isoline/.cache/`.
- **NSIS sur Apple Silicon** : le binaire `makensis` historique d'electron-builder est x86_64 et Rosetta n'est pas installé (installation système interdite). Résolu en sélectionnant le toolset NSIS 3.12 (`toolsets.nsis: "1.2.1"`) qui fournit un binaire compatible. Les ressources PE (icône, version) sont écrites sans Wine.
