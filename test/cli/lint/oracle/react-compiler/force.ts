// Makes a second set of inputs from the compiler's fixtures, in which a linter compiles the functions the fixtures are
// about.
//
//   bun force.ts <fixtures> <out directory>
//
// The fixtures are written for a compiler that compiles every function in a file. A linter only compiles what looks
// like a component or a hook (it's named like one, and creates JSX or calls a hook), so it skips
// `function Component() { return foo(); }`. This script adds a 'use memo' directive, which opts a function in to
// compilation, to each function that starts in column 1. Line numbers don't change. Function heads are found with
// regular expressions, either on one line or ending in a `}) {` line. It doesn't matter if some are missed, or if a
// file no longer parses, because both tools read the same files.

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

/** True if the line has as many `)` as `(`, so the `{` at its end isn't inside the parameters. */
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
