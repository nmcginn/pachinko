import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createAdjust, leanSelected, nudgeSelected, selectNailAt } from '../../src/game/adjust';
import { createTable } from '../../src/game/table';
import { arrowLabel, createAdjustPanel, describeSelection } from '../../src/render/adjust';
import { parseBoard } from '../../src/sim/board';

const classic = parseBoard(JSON.parse(readFileSync('boards/classic.json', 'utf8')));

describe('describeSelection', () => {
  it('asks for a selection when there is none', () => {
    const table = createTable(classic);
    const adjust = createAdjust(table);
    expect(describeSelection(adjust, table.board)).toBe('Click or tap a nail to select it');
  });

  it('names the nail, gives its position and its nudge in signed millimetres', () => {
    const table = createTable(classic);
    const adjust = createAdjust(table);
    selectNailAt(adjust, table, 0.2573, 0.178, 0.001);
    expect(describeSelection(adjust, table.board)).toBe('Nail 1 at 257.3, 178.0 mm, not moved');
    nudgeSelected(adjust, table, 3, 0);
    expect(describeSelection(adjust, table.board)).toBe(
      'Nail 1 at 257.6, 178.0 mm, nudged +0.3, 0.0 mm',
    );
    nudgeSelected(adjust, table, -13, -25);
    expect(describeSelection(adjust, table.board)).toBe(
      'Nail 1 at 256.3, 175.5 mm, nudged −1.0, −2.5 mm',
    );
  });
});

describe('describeSelection with a lean', () => {
  it('says which way the nail leans, in degrees, after any nudge', () => {
    const table = createTable(classic);
    const adjust = createAdjust(table);
    selectNailAt(adjust, table, 0.2573, 0.178, 0.001);
    leanSelected(adjust, table, 3, 0);
    // 1.5° right is 0.144 mm: the position rounds to 257.4.
    expect(describeSelection(adjust, table.board)).toBe(
      'Nail 1 at 257.4, 178.0 mm, leaning 1.5° right',
    );
    leanSelected(adjust, table, -4, -1);
    expect(describeSelection(adjust, table.board)).toBe(
      'Nail 1 at 257.3, 178.0 mm, leaning 0.5° left, 0.5° down',
    );
    nudgeSelected(adjust, table, 0, 10);
    leanSelected(adjust, table, 1, 5);
    expect(describeSelection(adjust, table.board)).toBe(
      'Nail 1 at 257.3, 179.2 mm, nudged 0.0, +1.0 mm, leaning 2.0° up',
    );
    // Straight again, and un-nudged: not moved.
    leanSelected(adjust, table, 0, -4);
    nudgeSelected(adjust, table, 0, -10);
    expect(describeSelection(adjust, table.board)).toBe('Nail 1 at 257.3, 178.0 mm, not moved');
  });
});

describe('arrowLabel', () => {
  it('names the step the arrow takes in each mode', () => {
    expect(arrowLabel('nudge', 'left')).toBe('Nudge left 0.1 mm');
    expect(arrowLabel('nudge', 'down')).toBe('Nudge down 0.1 mm');
    expect(arrowLabel('bend', 'up')).toBe('Lean up 0.5°');
    expect(arrowLabel('bend', 'right')).toBe('Lean right 0.5°');
  });
});

describe('createAdjustPanel', () => {
  /** A stand-in element with what the panel touches. */
  const element = () => {
    const attrs = new Map<string, string>();
    const classes = new Set<string>();
    return {
      hidden: false,
      textContent: '',
      title: '',
      dataset: {} as Record<string, string>,
      setAttribute: (k: string, v: string) => attrs.set(k, v),
      getAttribute: (k: string) => attrs.get(k) ?? null,
      classList: { toggle: (c: string, on: boolean) => (on ? classes.add(c) : classes.delete(c)) },
      classes,
    };
  };

  it('shows the mode, labels the arrows for it, and mirrors the lean and moved count', () => {
    const els = {
      toggle: element(),
      panel: element(),
      selection: element(),
      problem: element(),
      root: element(),
      nudgeMode: element(),
      bendMode: element(),
      arrows: { left: element(), right: element(), up: element(), down: element() },
    };
    const panel = createAdjustPanel(els as unknown as Parameters<typeof createAdjustPanel>[0]);
    const table = createTable(classic);
    const adjust = createAdjust(table);
    adjust.editing = true;
    panel.update(adjust, table.board);
    expect(els.panel.dataset['mode']).toBe('nudge');
    expect(els.nudgeMode.getAttribute('aria-pressed')).toBe('true');
    expect(els.bendMode.getAttribute('aria-pressed')).toBe('false');
    expect(els.arrows.up.getAttribute('aria-label')).toBe('Nudge up 0.1 mm');
    expect(els.panel.dataset['lean']).toBe('');
    expect(els.root.classes.has('editing')).toBe(true);

    adjust.mode = 'bend';
    selectNailAt(adjust, table, 0.2428, 0.178, 0.001);
    leanSelected(adjust, table, -2, 0);
    panel.update(adjust, table.board);
    expect(els.panel.dataset['mode']).toBe('bend');
    expect(els.bendMode.getAttribute('aria-pressed')).toBe('true');
    expect(els.nudgeMode.getAttribute('aria-pressed')).toBe('false');
    expect(els.arrows.left.getAttribute('aria-label')).toBe('Lean left 0.5°');
    expect(els.arrows.left.title).toBe('Lean left 0.5°');
    expect(els.panel.dataset['lean']).toBe('-2,0');
    expect(els.panel.dataset['offset']).toBe('0,0');
    // A bent nail counts as moved, though it has no nudge.
    expect(els.panel.dataset['moved']).toBe('1');
    expect(els.selection.textContent).toBe('Nail 0 at 242.7, 178.0 mm, leaning 1.0° left');
  });
});
