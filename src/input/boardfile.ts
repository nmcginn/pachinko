// Board files (M7): the adjust panel's Export button saves the board as it
// stands as a JSON file, and Import loads one in its place, through a
// hidden file input. The text and the checks are game/boardfile.ts's; the
// table and the adjustments change in game/adjust.ts's importBoard.

import { type Adjust, importBoard, noteExported, refuseImport } from '../game/adjust';
import { MAX_BOARD_FILE_CHARS, boardFileName, exportBoard } from '../game/boardfile';
import type { Table } from '../game/table';

export interface BoardFileElements {
  readonly exportButton: EventTarget;
  readonly importButton: EventTarget;
  /** The hidden `<input type="file">`: Import opens its picker, and its change event brings the file. */
  readonly file: EventTarget & {
    click(): void;
    value: string;
    readonly files: ArrayLike<Blob> | null;
  };
}

export interface BoardFileHost {
  /** Hand the browser a file to save. */
  download(fileName: string, text: string): void;
}

/** How long a download's object URL is kept: long enough for any browser to have started saving it. */
const DOWNLOAD_URL_LIFETIME_MS = 10_000;

/** Save files through an `<a download>` on `doc`. */
export function browserDownloads(doc: Document): BoardFileHost {
  return {
    download(fileName, text) {
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const a = doc.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_URL_LIFETIME_MS);
    },
  };
}

/**
 * Wire Export and Import. Calls `changed` after anything that changed the
 * adjust state (an import, a refused file, the export notice), and
 * `replaced` first after an import has swapped the table's board and
 * world, so the page can rebuild what it keeps per world. Returns an
 * unbind function. Reading a file is asynchronous; one that finishes after
 * unbinding is ignored.
 */
export function bindBoardFile(
  els: BoardFileElements,
  adjust: Adjust,
  table: Table,
  host: BoardFileHost,
  changed: () => void,
  replaced: () => void,
): () => void {
  let bound = true;
  const save = (): void => {
    const fileName = boardFileName(table.board);
    host.download(fileName, exportBoard(table.board));
    noteExported(adjust, fileName);
    changed();
  };
  const open = (): void => {
    // Cleared, so picking the same file again still fires `change`.
    els.file.value = '';
    els.file.click();
  };
  const load = (): void => {
    const file = els.file.files?.[0];
    if (!file) return;
    // Bytes are at least characters, so a file under the limit in bytes is under it in characters.
    if (file.size > MAX_BOARD_FILE_CHARS) {
      refuseImport(
        adjust,
        `file: ${file.size.toLocaleString('en-US')} bytes is more than a board file's ` +
          `${MAX_BOARD_FILE_CHARS.toLocaleString('en-US')}`,
      );
      changed();
      return;
    }
    file.text().then(
      (text) => {
        if (!bound) return;
        if (importBoard(adjust, table, text)) replaced();
        changed();
      },
      (e: unknown) => {
        if (!bound) return;
        refuseImport(
          adjust,
          `file: couldn't read it (${e instanceof Error ? e.message : String(e)})`,
        );
        changed();
      },
    );
  };
  els.exportButton.addEventListener('click', save);
  els.importButton.addEventListener('click', open);
  els.file.addEventListener('change', load);
  return () => {
    bound = false;
    els.exportButton.removeEventListener('click', save);
    els.importButton.removeEventListener('click', open);
    els.file.removeEventListener('change', load);
  };
}
