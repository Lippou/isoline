// Never colour alone (BRAND.md §4.3): states the map and the HUD tell by colour also differ by shape.
import { describe, expect, it } from 'vitest';
import { REL_COLOR, SAM_LINE } from '../../src/render/relations';
import { LEVEL_ICON } from '../../src/ui/hud/levels';
import { STATUS_ICONS, STATUS_STYLE } from '../../src/render/icons';

describe('colour-blind cues', () => {
  it('draws every relation ring with its own line', () => {
    const rels = Object.keys(REL_COLOR) as (keyof typeof REL_COLOR)[];
    const lines = new Set(rels.map((r) => SAM_LINE[r].join('/')));
    expect(lines.size).toBe(rels.length);
    // Own: solid; hostile: barbed.
    expect(SAM_LINE.own[1]).toBe(0);
    expect(SAM_LINE.foe[2]).toBeGreaterThan(0);
    expect(SAM_LINE.friend[2]).toBe(0);
  });

  it('marks good, warning and danger news with distinct signs', () => {
    const signs = [LEVEL_ICON.good, LEVEL_ICON.warn, LEVEL_ICON.danger];
    expect(signs.every((s) => s !== null)).toBe(true);
    expect(new Set(signs).size).toBe(3);
  });

  it('gives teammates a badge of their own', () => {
    expect(STATUS_ICONS).toContain('team');
    expect(STATUS_STYLE.team.icon).not.toBe(STATUS_STYLE.ally.icon);
  });
});
