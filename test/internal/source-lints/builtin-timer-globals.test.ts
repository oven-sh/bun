import { Glob } from "bun";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// The global setTimeout/setInterval/clearTimeout/clearInterval belong to user
// code: jest.useFakeTimers() freezes, counts, advances and clears every timer
// created through them, and user code may replace them. The runtime's own
// deadlines (socket idle timeouts, listen() callbacks, child_process kill
// timers, connection retries, ...) must keep firing regardless, so built-in
// modules take these four functions from require("internal/timers"), which
// schedules on the real clock no matter what a test does to the globals. This
// is the same rule Node's lib/ enforces with eslint's no-restricted-globals;
// capturing the globals at module load is not enough in Bun because fake timers
// are implemented inside the native setTimeout itself.
//
// A module that destructures one of these names from internal/timers shadows
// the global for the whole module, so every bare use in it is fine. In any
// other module a bare use of the name is a use of the global.

const TIMER_GLOBALS = ["setTimeout", "setInterval", "clearTimeout", "clearInterval"] as const;

// The modules implementing the user-facing timer APIs on top of the globals,
// and the module that defines the internal ones.
const IMPLEMENTERS = new Set(["node/timers.ts", "node/timers.promises.ts", "internal/timers.ts"]);

const srcJs = path.resolve(import.meta.dir, "..", "..", "..", "src", "js");

describe("builtin modules take setTimeout & co. from internal/timers", () => {
  test("scanner self-check", () => {
    expect(
      globalTimerUses(`
        const { setTimeout } = require("internal/timers");
        const { kTimeout: timeoutSymbol, clearTimeout: realClearTimeout } = require("internal/timers");
        // clearTimeout(t) in a comment
        /* or in a block comment
           clearTimeout(t) */
        const s = "clearTimeout(" + 'setInterval(' + \`clearInterval(
          clearInterval(\` + "a \\" setInterval(" + "http://x";
        Foo.prototype.setInterval = function setInterval(ms) {};
        class Socket {
          setTimeout(msecs, callback) {}
          clearInterval(a = 1, { b }): this {}
          get clearTimeout() {}
        }
        const t: ReturnType<typeof setInterval> = setTimeout(fn, 1);
        realClearTimeout(t);
        socket.setTimeout(1);
        this.#clearInterval(t);
        clearTimeout(t); // after code
        const keep = setInterval;
        promisify(clearInterval);
      `),
    ).toEqual([
      { line: 19, name: "clearTimeout" },
      { line: 20, name: "setInterval" },
      { line: 21, name: "clearInterval" },
    ]);
  });

  test("src/js", () => {
    const violations: string[] = [];
    let scanned = 0;

    for (const rel of [...new Glob("**/*.{js,ts}").scanSync({ cwd: srcJs })].sort()) {
      const posixRel = rel.replaceAll("\\", "/");
      if (posixRel.endsWith(".d.ts") || IMPLEMENTERS.has(posixRel)) continue;
      scanned++;
      for (const { line, name } of globalTimerUses(readFileSync(path.join(srcJs, rel), "utf8"))) {
        violations.push(
          `src/js/${posixRel}:${line}: global ${name}; add it to the require("internal/timers") destructure of this module`,
        );
      }
    }

    expect(violations).toEqual([]);
    // Guards against the scan going vacuous if the modules move.
    expect(scanned).toBeGreaterThan(100);
  });
});

type Use = { line: number; name: string };

// Not a property access (`socket.setTimeout`, `this.#setTimeout`) or part of a
// longer identifier. The leading character is captured instead of using a
// lookbehind, which is very slow on large files in debug builds of JSC.
const REFERENCE = new RegExp(String.raw`(^|[^\w$.#])(${TIMER_GLOBALS.join("|")})\b`, "gm");

// Bare references to the timer globals that resolve to the global in this
// module, with 1-based line numbers.
function globalTimerUses(source: string): Use[] {
  if (!TIMER_GLOBALS.some(name => source.includes(name))) return [];
  const shadowed = internalTimerBindings(source);
  const skip = commentsAndStrings(source);
  const uses: Use[] = [];
  let nextSkip = 0;

  for (const match of source.matchAll(REFERENCE)) {
    const name = match[2];
    if (shadowed.has(name)) continue;
    const start = match.index + match[1].length;
    while (nextSkip < skip.length && skip[nextSkip].end <= start) nextSkip++;
    if (nextSkip < skip.length && skip[nextSkip].start <= start) continue;
    const end = start + name.length;
    if (isDeclaration(source, start) || isPropertyKey(source, end) || isMethodDefinition(source, end)) continue;
    uses.push({ line: lineOf(source, start), name });
  }
  return uses;
}

// Local names bound by `const { ..., setTimeout, kTimeout: alias, ... } = require("internal/timers")`.
function internalTimerBindings(source: string): Set<string> {
  const bound = new Set<string>();
  const destructure = /\{([^{}]*)\}\s*=\s*require\(\s*["']internal\/timers["']\s*\)/g;
  for (const [, body] of source.matchAll(destructure)) {
    for (const entry of body.replace(/\/\/[^\n]*/g, "").split(",")) {
      const [key, alias] = entry.split(":").map(s => s.trim());
      const local = (alias ?? key).split("=")[0].trim();
      if (local) bound.add(local);
    }
  }
  return bound;
}

type Range = { start: number; end: number };

// The comments and string/template literals of the file, in order, so that
// mentions inside them are not taken for code. Each token is located with
// indexOf from its opener (a regular expression over the whole file takes tens
// of seconds on the largest modules in a debug build).
function commentsAndStrings(source: string): Range[] {
  const ranges: Range[] = [];
  const opener = /["'`]|\/\/|\/\*/g;
  for (let match = opener.exec(source); match !== null; match = opener.exec(source)) {
    const start = match.index;
    let end: number;
    if (match[0] === "//") {
      end = indexOrEnd(source, "\n", start);
    } else if (match[0] === "/*") {
      const close = source.indexOf("*/", start + 2);
      end = close === -1 ? source.length : close + 2;
    } else {
      end = closingQuote(source, start, match[0]);
    }
    ranges.push({ start, end });
    opener.lastIndex = end;
  }
  return ranges;
}

// End of the literal opened by the quote at `start` (just past the closing
// quote). Backslash-escaped quotes do not close it. A ' or " with no closing
// quote on its line (a quote character inside a regex literal, typically) is
// taken to end at the newline.
function closingQuote(source: string, start: number, quote: string): number {
  const lineEnd = quote === "`" ? source.length : indexOrEnd(source, "\n", start);
  for (let from = start + 1; ; ) {
    const close = source.indexOf(quote, from);
    if (close === -1 || close > lineEnd) return lineEnd;
    let backslashes = 0;
    while (source[close - 1 - backslashes] === "\\") backslashes++;
    if (backslashes % 2 === 0) return close + 1;
    from = close + 1;
  }
}

function indexOrEnd(source: string, needle: string, from: number): number {
  const index = source.indexOf(needle, from);
  return index === -1 ? source.length : index;
}

// `function setTimeout(` (a function named like the global), `get setTimeout()`,
// or `typeof setTimeout` in a type position.
function isDeclaration(source: string, start: number): boolean {
  return /\b(?:typeof|function|get|set)\s+$/.test(source.slice(Math.max(0, start - 64), start));
}

// `{ setTimeout: x }` / `case` labels: the name is a key, not a reference.
function isPropertyKey(source: string, end: number): boolean {
  return /^\s*:/.test(source.slice(end, end + 64));
}

// `setTimeout(msecs, callback) {` / `setTimeout(ms): this {`: a method named
// like the global, not a call of it. The text after the parameter list tells
// the two apart; a call expression is never followed by `{` or a type annotation.
function isMethodDefinition(source: string, end: number): boolean {
  let i = end;
  while (i < source.length && /\s/.test(source[i])) i++;
  if (source[i] !== "(") return false;
  let depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === "(") depth++;
    else if (source[i] === ")" && --depth === 0) break;
  }
  return /^\)\s*(?:\{|:)/.test(source.slice(i, i + 64));
}

function lineOf(source: string, index: number): number {
  let line = 1;
  for (let at = source.indexOf("\n"); at !== -1 && at < index; at = source.indexOf("\n", at + 1)) line++;
  return line;
}
