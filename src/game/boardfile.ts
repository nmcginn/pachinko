// Boards as files (M7's export and import). Pure: the input layer reads and
// writes the files, this turns a board into the text of one and back.
//
// An exported board is the board as it stands: every nail where it is now,
// nudged or bent, as a plain position (a bend is stored as its position
// only, the maintainer's decision), in the same schema and layout as
// boards/classic.json. The unedited classic board exports byte for byte as
// that file. Importing reads it back through parseBoard, so a file that
// was hand-edited gets the same checks as a board loaded at start-up.

import { type Board, BoardError, boardData, parseBoard } from '../sim/board';

/**
 * Largest board file we read, in characters. The classic board is about
 * 15 kB; this leaves room for a much busier one while refusing, say, a
 * photo picked by mistake before JSON.parse or parseBoard's nail-against-
 * nail check (O(n²)) can stall the page.
 */
export const MAX_BOARD_FILE_CHARS = 1_000_000;

/**
 * The text of a board file: JSON, two-space indented, with each point
 * [x, y] on one line and the launcher on one line, as boards/classic.json
 * is laid out (Prettier's layout for it). Ends with a newline.
 */
export function exportBoard(board: Board): string {
  const data = boardData(board);
  const text = JSON.stringify(data, null, 2)
    // A point: an array of two numbers, the innermost arrays in the schema.
    .replace(/\[\n\s*(-?[\d.e+-]+),\n\s*(-?[\d.e+-]+)\n\s*\]/g, '[$1, $2]')
    .replace(/"launcher": \{[^}]*\}/, () => {
      const l = data.launcher;
      return `"launcher": { "x": ${l.x}, "y": ${l.y}, "angleDeg": ${l.angleDeg}, "minSpeedMps": ${l.minSpeedMps} }`;
    });
  return `${text}\n`;
}

/** A file name for a board: its name, kept to letters, digits, '-' and '_', then ".json". */
export function boardFileName(board: Board): string {
  const stem = board.name
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return `${stem || 'board'}.json`;
}

/**
 * Read a board file's text. Throws a BoardError listing what's wrong: too
 * big, not JSON, or every problem parseBoard finds.
 */
export function readBoard(text: string): Board {
  if (text.length > MAX_BOARD_FILE_CHARS) {
    throw new BoardError([
      `file: ${text.length.toLocaleString('en-US')} characters is more than a board file's ` +
        `${MAX_BOARD_FILE_CHARS.toLocaleString('en-US')}`,
    ]);
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new BoardError([`file: not JSON (${e instanceof Error ? e.message : String(e)})`]);
  }
  return parseBoard(data);
}
