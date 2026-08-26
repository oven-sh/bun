import { Glob } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// `$ERR_INVALID_ARG_TYPE(message)` and `$ERR_INVALID_ARG_VALUE(message)`
// with one string argument take it as the whole message (ErrorCode.cpp
// `$makeErrorWithCode`). Everywhere else the first argument is a name and
// the message is built from the arguments that follow, so a call that
// dropped its value would throw an error whose message is the bare name.
// Only the builtins written against the message form may use it.
const allowed = new Set(["src/js/bun/objc.ts", "src/js/bun/appkit.ts"]);

/**
 * The number of arguments in the call whose opening parenthesis is at
 * `open`, or null when the source ends first; a spread argument counts
 * as many. Strings, template literals (and the expressions inside them),
 * comments and nested brackets are stepped over.
 */
function argumentCount(source: string, open: number): number | null {
  let depth = 0;
  let commas = 0;
  // Whether the argument after the last comma has anything in it (the
  // last argument may be followed by a trailing comma).
  let filled = false;
  let spread = false;
  const closers: string[] = [];
  for (let i = open; i < source.length; i++) {
    const c = source[i]!;
    if (depth === 1 && !filled && source.startsWith("...", i)) spread = true;
    if (c === "/" && source[i + 1] === "/") {
      i = source.indexOf("\n", i);
      if (i < 0) return null;
      continue;
    }
    if (c === "/" && source[i + 1] === "*") {
      i = source.indexOf("*/", i + 2);
      if (i < 0) return null;
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      for (i++; i < source.length && source[i] !== c; i++) if (source[i] === "\\") i++;
      filled = true;
      continue;
    }
    if (c === "`") {
      // A template literal runs to its closing backtick; a `${` inside it
      // opens an expression that its `}` closes.
      for (i++; i < source.length; i++) {
        const t = source[i]!;
        if (t === "\\") i++;
        else if (t === "`") break;
        else if (t === "$" && source[i + 1] === "{") {
          let inner = 1;
          for (i += 2; i < source.length && inner > 0; i++) {
            if (source[i] === "{") inner++;
            else if (source[i] === "}") inner--;
          }
          i--;
        }
      }
      filled = true;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") {
      depth++;
      closers.push(c === "(" ? ")" : c === "[" ? "]" : "}");
      if (depth > 1) filled = true;
      continue;
    }
    if (c === ")" || c === "]" || c === "}") {
      if (closers.pop() !== c) return null;
      depth--;
      if (depth === 0) return spread ? Infinity : commas + (filled ? 1 : 0);
      continue;
    }
    if (depth === 1 && c === ",") {
      commas++;
      filled = false;
      continue;
    }
    if (!/\s/.test(c)) filled = true;
  }
  return null;
}

test("the message-only $ERR_INVALID_ARG_TYPE / $ERR_INVALID_ARG_VALUE form stays in the builtins written for it", async () => {
  const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");
  const root = path.join(repoRoot, "src/js");
  const call = /\$ERR_INVALID_ARG_(?:TYPE|VALUE)\s*\(/g;
  const violations: string[] = [];
  const allowedUses: string[] = [];
  let scanned = 0;
  for await (const rel of new Glob("**/*.{ts,js}").scan({ cwd: root })) {
    if (rel.endsWith(".d.ts")) continue;
    scanned++;
    const relFromRepo = `src/js/${rel}`.replaceAll("\\", "/");
    const source = readFileSync(path.join(root, rel), "utf8");
    for (const match of source.matchAll(call)) {
      const open = match.index + match[0].length - 1;
      const count = argumentCount(source, open);
      const line = source.slice(0, match.index).split("\n").length;
      const where = `${relFromRepo}:${line}`;
      if (count === null) {
        violations.push(`${where} (unbalanced call)`);
      } else if (count === 1) {
        (allowed.has(relFromRepo) ? allowedUses : violations).push(where);
      }
    }
  }
  expect(scanned).toBeGreaterThan(0);
  // The allow-list exists for these; an empty count means the scan or the
  // call shape changed and the lint proves nothing.
  expect(allowedUses.length).toBeGreaterThan(0);
  violations.sort();
  expect(violations).toEqual([]);
});

test("argumentCount reads the call shapes the builtins use", () => {
  const count = (call: string) => argumentCount(call, call.indexOf("("));
  expect(count(`$ERR_INVALID_ARG_TYPE("a message")`)).toBe(1);
  expect(count(`$ERR_INVALID_ARG_TYPE(\`a \${f(x, y)} message, with a comma\`)`)).toBe(1);
  expect(count(`$ERR_INVALID_ARG_TYPE("name", "string", value)`)).toBe(3);
  expect(count(`$ERR_INVALID_ARG_TYPE("name", ["a", "b"], { x: 1, y: 2 })`)).toBe(3);
  expect(count(`$ERR_INVALID_ARG_VALUE("name", value, "reason, with a comma")`)).toBe(3);
  expect(count(`$ERR_INVALID_ARG_VALUE(\n  "name", // a comment, with a comma\n  value,\n)`)).toBe(2);
  expect(count(`$ERR_INVALID_ARG_VALUE()`)).toBe(0);
  expect(count(`$ERR_INVALID_ARG_VALUE(...args)`)).toBe(Infinity);
  expect(count(`$ERR_INVALID_ARG_VALUE("open`)).toBeNull();
});
