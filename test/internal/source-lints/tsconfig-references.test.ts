// Every `references[].path` reachable from the repo root tsconfig.json must
// resolve to a real project: a tsconfig file, or a directory containing a
// tsconfig.json (the two shapes tsc accepts). A stale path, left behind when
// a project directory moves, fails `tsc --noEmit` at the root with TS6053
// before checking anything, and breaks editor language service features for
// the whole solution. src/bake -> src/runtime/bake was caught by hand; this
// keeps the graph honest mechanically.

import { expect, test } from "bun:test";
import { statSync } from "fs";
import path from "path";

const root = path.resolve(import.meta.dir, "..", "..", "..");

// tsconfig.json is JSONC: strip // and /* */ comments and trailing commas,
// string-aware, then JSON.parse. This stays hand-rolled because the
// source-lints workflow runs on a bare checkout (no `bun install`), so the
// typescript package's JSONC reader is not importable here. A malformed file
// throws, failing the test with the offending path in the message.
function parseJsonc(text: string, from: string): any {
  let out = "";
  let i = 0;
  let inString = false;
  while (i < text.length) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === "\\") {
        out += text[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (c === '"') inString = false;
      i++;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
      // A space, not nothing: `1/* */2` must stay two tokens, not parse as 12.
      out += " ";
      continue;
    }
    if (c === "}" || c === "]") {
      // Trailing-comma removal happens only here, outside any string: a comma
      // inside a string always has the closing quote between it and this
      // bracket, so `,\s*$` cannot reach into string contents.
      out = out.replace(/,(\s*)$/, "$1");
    }
    out += c;
    i++;
  }
  try {
    return JSON.parse(out);
  } catch (e) {
    throw new Error(`failed to parse ${from}: ${e}`);
  }
}

// tsc's resolution for a reference path: a file is used as-is, a directory
// means <dir>/tsconfig.json. `throwIfNoEntry: false` maps only ENOENT to
// undefined; permission and I/O failures still throw, carrying the path.
function resolveReference(fromDir: string, ref: string): string | null {
  const p = path.resolve(fromDir, ref);
  const stat = statSync(p, { throwIfNoEntry: false });
  if (stat?.isFile()) return p;
  if (stat?.isDirectory()) {
    const sub = path.join(p, "tsconfig.json");
    if (statSync(sub, { throwIfNoEntry: false })?.isFile()) return sub;
  }
  return null;
}

test("tsconfig project references resolve", async () => {
  const missing: string[] = [];
  const visited = new Set<string>();
  const queue = [path.join(root, "tsconfig.json")];
  while (queue.length > 0) {
    const cfgPath = queue.pop()!;
    if (visited.has(cfgPath)) continue;
    visited.add(cfgPath);
    const cfg = parseJsonc(await Bun.file(cfgPath).text(), path.relative(root, cfgPath));
    for (const ref of cfg.references ?? []) {
      const resolved = resolveReference(path.dirname(cfgPath), ref.path);
      if (resolved === null) {
        missing.push(`${path.relative(root, cfgPath)} references "${ref.path}", which does not exist`);
      } else {
        queue.push(resolved);
      }
    }
  }
  expect(missing).toEqual([]);
  // The root is a solution file; reaching only it means the walk went wrong.
  expect(visited.size).toBeGreaterThan(1);
});
