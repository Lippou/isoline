// Map packs added in 1.5 (built by build-maps.ts through worlds.ts).
import type { WorldDef } from './worlds';
import { ARCADE } from './worlds-arcade';
import { PLANETS } from './worlds-planets';
import { LEGENDS } from './worlds-legends';

export const PACKS: WorldDef[] = [...ARCADE, ...PLANETS, ...LEGENDS];
