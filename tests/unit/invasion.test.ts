// The invasion alert: which waves are invasions (red edge) and which are ripostes (the
// country we attack defending itself), and which screen edges face the attack.
import { describe, expect, it } from 'vitest';
import { classifyWave, edgesToward } from '../../src/ui/game/invasion';

const W = 1600;
const H = 900;
const lit = (e: ReturnType<typeof edgesToward>['edges']) =>
  (Object.keys(e) as (keyof typeof e)[]).filter((k) => e[k] > 0).sort();

describe('invasion alert: classification', () => {
  it('a wave at someone else is nothing; at me, an invasion unless it answers my attack', () => {
    expect(classifyWave({ target: 3, riposte: false }, 1)).toBeNull();
    expect(classifyWave({ target: 3, riposte: true }, 1)).toBeNull();
    expect(classifyWave({ target: 1, riposte: false }, 1)).toBe('invasion');
    expect(classifyWave({ target: 1, riposte: true }, 1)).toBe('riposte');
    // Spectators are attacked by no one.
    expect(classifyWave({ target: 0, riposte: false }, 0)).toBeNull();
  });
});

describe('invasion alert: the edge facing the attack', () => {
  it('lights one edge only for an attack straight off a side', () => {
    expect(lit(edgesToward(-400, H / 2, W, H).edges)).toEqual(['left']);
    expect(lit(edgesToward(W + 50, 300, W, H).edges)).toEqual(['right']);
    expect(lit(edgesToward(W / 2, -10, W, H).edges)).toEqual(['top']);
    expect(lit(edgesToward(900, H + 2000, W, H).edges)).toEqual(['bottom']);
    const c = edgesToward(W + 50, 300, W, H);
    expect(c.edges.right).toBe(1);
    expect(c.onScreen).toBe(false);
    // The glow peaks where the attack lies along that edge.
    expect(c.ex).toBe(1);
    expect(c.ey).toBeCloseTo(0.5 + (300 - H / 2) / (H / 2) / ((W + 50 - W / 2) / (W / 2)) / 2, 5);
  });

  it('lights the two edges of a corner for an attack from a corner', () => {
    const c = edgesToward(-800, -450, W, H); // exactly along the diagonal
    expect(lit(c.edges)).toEqual(['left', 'top']);
    expect(c.edges.left).toBe(1);
    expect(c.edges.top).toBe(1);
    // Off the diagonal but still in the corner's cone: the second edge glows less.
    const d = edgesToward(W + 1200, H + 400, W, H);
    expect(lit(d.edges)).toEqual(['bottom', 'right']);
    expect(d.edges.right).toBe(1);
    expect(d.edges.bottom).toBeGreaterThan(0);
    expect(d.edges.bottom).toBeLessThan(1);
    // Far off a side, slightly above the top: only that side.
    expect(lit(edgesToward(-3000, -100, W, H).edges)).toEqual(['left']);
  });

  it('a front in view lights its nearest edge softly (the map marks the front)', () => {
    const c = edgesToward(1500, 450, W, H);
    expect(c.onScreen).toBe(true);
    expect(lit(c.edges)).toEqual(['right']);
    expect(c.edges.right).toBeLessThan(1);
    expect(c.ex).toBe(1);
    expect(c.ey).toBeCloseTo(0.5);
    expect(lit(edgesToward(300, 80, W, H).edges)).toEqual(['top']);
  });

  it('without a known front, the top edge', () => {
    expect(lit(edgesToward(null, null, W, H).edges)).toEqual(['top']);
    expect(lit(edgesToward(NaN, 3, W, H).edges)).toEqual(['top']);
  });
});
