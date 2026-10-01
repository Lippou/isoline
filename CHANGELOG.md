# Changelog

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/). Versions selon SemVer.

## [0.1.0] — Phase 0 : fondations
### Ajouté
- Nom, slogan, logo SVG (4 variantes), icônes `.icns`/`.ico`, fond de DMG, moodboard, 40 encres joueurs + 3 palettes daltoniennes, le tout généré par `npm run brand`.
- Ossature Electron + Vite + Svelte 5 + TypeScript strict ; protocole `isoline://` ; mode `--smoke-test`.
- Chaîne de packaging : DMG/ZIP macOS universel signé ad hoc, installeur NSIS et portable Windows x64 construits depuis le Mac.
- ESLint, Prettier, hooks `pre-commit` (lefthook).
