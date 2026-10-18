// A second set of inputs from the compiler's fixtures, in which a linter compiles what the fixtures mean to be compiled.
//
//   bun force.ts <fixtures> <out directory>
//
// The fixtures are written for a compiler that compiles every function of a file. A linter compiles what looks like a
// component or a hook (it has a name like one, and makes JSX or calls a hook), so `function Component() { return foo(); }`
// is never looked at. Here each function that starts at the start of a line gets the directive 'use memo', which asks for
// it to be compiled. Lines keep their numbers. The heads are found by their looks, on one line or ending in a line `}) {`:
// it does not matter if some are missed, or if a file no longer parses, since both sides read the same files.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { inputsByDirectory, options, table } from "./shared.ts";

const { rest } = options(process.argv.slice(2));
if (rest.length !== 2) throw new Error("usage: bun force.ts <fixtures> <out directory>");
const [fixtures, out] = rest.map(path => resolve(path));

const EXPORT = String.raw`(?:export\s+(?:default\s+)?)?`;
const FUNCTION = new RegExp(String.raw`^${EXPORT}(?:async\s+)?function\b.*\{$`);
const FUNCTION_OPEN = new RegExp(String.raw`^${EXPORT}(?:async\s+)?function\b.*[({[,]$`);
const ARROW = new RegExp(String.raw`^${EXPORT}(?:const|let|var)\s+\w+.*=>\s*\{$`);
const HEAD_END = /^[}\]]?\)(?::.*)?\s*\{$/;

/** As many `)` as `(`: the `{` at the end is not in the parameters. */
const closed = (line: string) => line.split("(").length === line.split(")").length;

let files = 0;
let changed = 0;
let functions = 0;
for (const paths of inputsByDirectory(fixtures).values()) {
  for (const path of paths) {
    files++;
    let open = false;
    let count = 0;
    const lines = readFileSync(join(fixtures, path), "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const whole = (FUNCTION.test(line) || ARROW.test(line)) && closed(line);
      const head = whole || (open && HEAD_END.test(line));
      if (/^\S/.test(line)) open = !whole && FUNCTION_OPEN.test(line);
      if (!head || /^\s*['"]use /.test(lines[i + 1] ?? "")) continue;
      lines[i] = `${line} 'use memo';`;
      count++;
    }
    if (count > 0) changed++;
    functions += count;
    mkdirSync(dirname(join(out, path)), { recursive: true });
    writeFileSync(join(out, path), lines.join("\n"));
  }
}
console.log(table(["Files", "With a directive more", "Directives"], [[files, changed, functions]]));
