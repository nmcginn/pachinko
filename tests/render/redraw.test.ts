// Redraw only on change (M8, Lighthouse): the frame loop draws the canvas
// when what it shows has changed, or while balls or glints move on it.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createTable, stepTable } from '../../src/game/table';
import { createAdjust, nudgeSelected, setEditing } from '../../src/game/adjust';
import { setPower } from '../../src/game/fire';
import { GLINT_STEPS, collectGlints, createGlints, glintLevel } from '../../src/render/glints';
import { type Scene, gateKey, glintsLive, needsRedraw } from '../../src/render/redraw';
import { parseBoard } from '../../src/sim/board';
import type { Gate } from '../../src/sim/world';

const classic = parseBoard(JSON.parse(readFileSync('boards/classic.json', 'utf8')));

function scene(over: Partial<Scene> = {}): Scene {
  return {
    backingWidth: 800,
    backingHeight: 1200,
    cssWidth: 400,
    cssHeight: 600,
    area: { left: 0, top: 80, right: 400, bottom: 520 },
    board: classic,
    gates: '000',
    balls: 0,
    glinting: false,
    editing: false,
    selected: null,
    ...over,
  };
}

describe('needsRedraw', () => {
  it('draws the first frame', () => {
    expect(needsRedraw(null, scene())).toBe(true);
  });

  it('skips a frame when nothing shown has changed', () => {
    expect(needsRedraw(scene(), scene())).toBe(false);
  });

  it('compares the board area by value, not identity', () => {
    const a = scene();
    const b = scene({ area: { ...a.area } });
    expect(needsRedraw(a, b)).toBe(false);
  });

  it.each<[string, Partial<Scene>]>([
    ['the backing store resized (which clears the canvas)', { backingWidth: 801 }],
    ['the backing store resized vertically', { backingHeight: 1199 }],
    ['the CSS width', { cssWidth: 401 }],
    ['the CSS height', { cssHeight: 599 }],
    ['the area moved', { area: { left: 0, top: 81, right: 400, bottom: 520 } }],
    ['the area resized', { area: { left: 0, top: 80, right: 399, bottom: 520 } }],
    ['a gate opened', { gates: '010' }],
    ['edit mode', { editing: true }],
    ['a nail selected', { selected: 0 }],
    ['the last ball left', { balls: 0 }],
  ])('draws when %s changes', (_, over) => {
    // The "last ball left" case starts from a scene with a ball in it.
    const prev = over.balls === 0 ? scene({ balls: 1 }) : scene();
    expect(needsRedraw(prev, scene(over))).toBe(true);
  });

  it('draws when the board is replaced, even by an identical copy', () => {
    const copy = parseBoard(JSON.parse(readFileSync('boards/classic.json', 'utf8')));
    expect(needsRedraw(scene(), scene({ board: copy }))).toBe(true);
  });

  it('draws when a nudge replaces the board', () => {
    const table = createTable(classic, { seed: 1 });
    const adjust = createAdjust(table);
    setEditing(adjust, true);
    adjust.selected = 0;
    const before = scene({ board: table.board, editing: true, selected: 0 });
    expect(nudgeSelected(adjust, table, 1, 0)).toBe(true);
    expect(table.board).not.toBe(before.board);
    expect(needsRedraw(before, { ...before, board: table.board })).toBe(true);
  });

  it('draws every frame while a ball is in play, even if nothing else changed', () => {
    const s = scene({ balls: 1 });
    expect(needsRedraw(s, s)).toBe(true);
  });

  it('draws every frame while a nail glints, and once more when the glint ends', () => {
    const live = scene({ glinting: true });
    expect(needsRedraw(live, live)).toBe(true);
    expect(needsRedraw(live, scene())).toBe(true);
    expect(needsRedraw(scene(), scene())).toBe(false);
  });

  it('draws when a ball arrives on an idle board', () => {
    expect(needsRedraw(scene(), scene({ balls: 1 }))).toBe(true);
  });
});

describe('gateKey', () => {
  const gate = (open: boolean) => ({ open }) as unknown as Gate;

  it('is empty for no gates', () => {
    expect(gateKey([])).toBe('');
  });

  it('writes each gate open or shut in order', () => {
    expect(gateKey([gate(true), gate(false), gate(true)])).toBe('101');
  });

  it('matches the classic table’s gates as they open and shut', () => {
    const table = createTable(classic, { seed: 1 });
    const key = gateKey(table.world.gates);
    expect(key).toHaveLength(table.world.gates.length);
    expect(key).toBe(table.world.gates.map((g) => (g.open ? '1' : '0')).join(''));
  });
});

describe('glintsLive', () => {
  it('is false for a tracker that has seen nothing', () => {
    const table = createTable(classic, { seed: 1 });
    expect(glintsLive(createGlints(table.world), 0)).toBe(false);
  });

  it('is false for a board with no nails', () => {
    const glints = {
      startStep: new Float64Array(0),
      strength: new Float64Array(0),
      velocity: new Map(),
    };
    expect(glintsLive(glints, 100)).toBe(false);
  });

  it('lasts exactly GLINT_STEPS from the step a glint starts', () => {
    const table = createTable(classic, { seed: 1 });
    const glints = createGlints(table.world);
    glints.startStep[5] = 1000;
    glints.strength[5] = 0.5;
    expect(glintsLive(glints, 999)).toBe(false);
    expect(glintsLive(glints, 1000)).toBe(true);
    expect(glintsLive(glints, 1000 + GLINT_STEPS - 1)).toBe(true);
    expect(glintsLive(glints, 1000 + GLINT_STEPS)).toBe(false);
  });

  it('agrees with drawGlints’ rule (glintLevel) through a real game', () => {
    const table = createTable(classic, { seed: 3 });
    setPower(table.fire, 0.2);
    table.fire.held = true;
    const glints = createGlints(table.world);
    let sawLive = false;
    for (let s = 0; s < 8000; s++) {
      stepTable(table);
      collectGlints(glints, table.world);
      if (s % 7 !== 0) continue;
      const now = table.world.steps;
      const any = table.board.nails.some((_, i) => glintLevel(glints, i, now) > 0);
      // glintLevel can be 0 for a live glint only if its strength is 0,
      // which collectGlints never records (kicks below the minimum don't glint).
      expect(glintsLive(glints, now)).toBe(any);
      sawLive ||= any;
    }
    expect(sawLive).toBe(true);
  });
});
