import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createAdjust, nudgeSelected, selectNailAt } from '../../src/game/adjust';
import { createTable } from '../../src/game/table';
import { describeSelection } from '../../src/render/adjust';
import { parseBoard } from '../../src/sim/board';

const classic = parseBoard(JSON.parse(readFileSync('boards/classic.json', 'utf8')));

describe('describeSelection', () => {
  it('asks for a selection when there is none', () => {
    const table = createTable(classic);
    const adjust = createAdjust(table);
    expect(describeSelection(adjust, table.board)).toBe('Click or tap a nail to select it');
  });

  it('names the nail, gives its position and its offset in signed millimetres', () => {
    const table = createTable(classic);
    const adjust = createAdjust(table);
    selectNailAt(adjust, table, 0.2573, 0.178, 0.001);
    expect(describeSelection(adjust, table.board)).toBe('Nail 1 at 257.3, 178.0 mm, not moved');
    nudgeSelected(adjust, table, 3, 0);
    expect(describeSelection(adjust, table.board)).toBe(
      'Nail 1 at 257.6, 178.0 mm, moved +0.3, 0.0 mm',
    );
    nudgeSelected(adjust, table, -13, -25);
    expect(describeSelection(adjust, table.board)).toBe(
      'Nail 1 at 256.3, 175.5 mm, moved −1.0, −2.5 mm',
    );
  });
});
