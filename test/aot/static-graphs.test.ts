import { readFileSync } from "node:fs";
import { join } from "node:path";
import { testCells } from "./harness/cells";
import { call, cells, helpers } from "./harness/static-graphs";

// static-graphs.expected.txt: what node, `bun run` and `bun build --compile` all print. A cell on which they differ is not in it.
const stored = new Map<string, string>(
  readFileSync(join(import.meta.dir, "static-graphs.expected.txt"), "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line: string): [string, string] => [line.slice(0, line.indexOf(" ")), line]),
);
const held = ["mmm", "mmc", "mcm", "cmm", "mcc", "cmc", "ccm", "ccc"]
  .flatMap(cells)
  .filter(cell => stored.has(cell.id));
testCells("graphs of ES and CommonJS modules below one root", held, 1000, helpers, call, stored);
