// How the map tells a player's relation to the viewer: a colour, and (never colour alone,
// BRAND.md §4.3) a line style for the rings drawn by relation.

/** Map colours of a relation: own, ally or teammate, everyone else. */
export const REL_COLOR = { own: 0x4ade80, friend: 0xfacc15, foe: 0xef4444 } as const;
/**
 * Line of a relation's rings (SAM coverage), never colour alone: [dash, gap, outward barb] in
 * screen px. Own: solid; ally or teammate: long dashes; hostile: short barbed dashes.
 */
export const SAM_LINE: Record<keyof typeof REL_COLOR, readonly [number, number, number]> = {
  own: [12, 0, 0],
  friend: [16, 7, 0],
  foe: [6, 6, 4.5],
};
