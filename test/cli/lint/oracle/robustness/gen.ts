// bun gen.ts <directory> <wide|deep> <n> [--more] [--jsdoc] [part of a name ..]: writes the shapes of size n, one file each.
// --more: also the shapes that are each for some rules: see sets.ts.
// --jsdoc: only the JavaScript ones, after a JSDoc comment with a type: such a file has nodes that are made from comments.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { shapesOf } from "./sets";

const flags = process.argv.slice(2).filter(it => it.startsWith("--"));
const [directory, kind, size, ...filters] = process.argv.slice(2).filter(it => !it.startsWith("--"));
if (!directory || (kind !== "wide" && kind !== "deep") || !(Number(size) > 0)) {
  console.error("usage: bun gen.ts <directory> <wide|deep> <n> [--more] [--jsdoc] [part of a name ..]");
  process.exit(2);
}
const jsdoc = flags.includes("--jsdoc");
mkdirSync(directory, { recursive: true });
let count = 0;
for (const [name, text] of shapesOf(kind, Number(size), flags.includes("--more"))) {
  if (filters.length && !filters.some(it => name.includes(it))) continue;
  if (jsdoc && !/\.jsx?$/.test(name)) continue;
  writeFileSync(join(directory, name), (jsdoc ? "/** @type {number} */ var jsdoc = 1;\n" : "") + text() + "\n");
  count++;
}
console.log(`${count} files`);
