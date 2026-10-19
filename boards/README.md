# Boards

Board definitions as data: nails, rails as polylines, pockets as sensor regions (an `attacker` pocket also has a `lid`, the polyline that closes over its mouth), and the launcher. SI metres, origin at the bottom-left corner, y up. The schema and its validator are in `src/sim/board.ts`; `parseBoard` reports every problem in a file at once, each with the path of the offending item.

`classic.json` is the default board. `tools/gen-classic-board.ts` generated its first version and documents the design; the JSON is the source of truth from then on, so edit it directly (and log geometry changes in PHYSICS.md).
