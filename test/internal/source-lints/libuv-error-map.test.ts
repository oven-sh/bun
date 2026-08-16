import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// bun_sys::libuv_error_map (src/sys/libuv_error_map.rs) is the errno ->
// uv_strerror() text table behind every Node-shaped SystemError message bun
// builds for a failed syscall ("ENOENT: no such file or directory, open 'x'").
// It is a hand-written copy of UV_ERRNO_MAP in src/jsc/bindings/libuv/uv.h:
// one `arr[SystemErrno::X as usize] = "..."` row per errno, wrapped in a
// #[cfg] block where some target's SystemErrno (src/errno/<os>_errno.rs) has
// no such variant. The array is pre-filled with "unknown error", so a row the
// copy lacks, or one whose #[cfg] excludes a target that does have the errno,
// does not fail to compile; it prints as "unknown error" on that target
// (ENOEXEC had no row at all, so spawning a non-executable file reported
// "ENOEXEC: unknown error"). These lints replay the rows for each target and
// compare the result with uv.h. The shell-facing strerror() table
// (bun_core::coreutils_error_map) is a different table with a different
// reference and is not covered here.

const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");

// Every target_os bun builds for, with the errno module bun_errno selects for
// it (src/errno/lib.rs).
const TARGETS: [targetOs: string, enumFile: string][] = [
  ["linux", "linux_errno.rs"],
  ["android", "linux_errno.rs"],
  ["macos", "darwin_errno.rs"],
  ["freebsd", "freebsd_errno.rs"],
  ["windows", "windows_errno.rs"],
];

test.each(TARGETS)("%s: every uv.h errno the target has is labelled with uv.h's text", (targetOs, enumFile) => {
  const reference = parseUvErrnoMap();
  const errnos = parseSystemErrnoNames(enumFile);
  const active = parseRows().filter(row => evalCfg(row.cfg, targetOs));

  // A name written twice would silently keep the last text.
  const names = active.map(row => row.name);
  expect(names.filter((name, i) => names.indexOf(name) !== i)).toEqual([]);

  const labels = new Map(active.map(row => [row.name, row.text]));
  const wrong: string[] = [];
  for (const [name, text] of reference) {
    if (!errnos.has(name) || labels.get(name) === text) continue;
    const actual = labels.has(name) ? JSON.stringify(labels.get(name)) : "no row";
    wrong.push(`${name}: ${actual}, uv.h says ${JSON.stringify(text)}`);
  }
  expect(wrong).toEqual([]);
});

test("every row is a uv.h errno", () => {
  const reference = parseUvErrnoMap();
  expect(
    parseRows()
      .filter(row => !reference.has(row.name))
      .map(row => row.name),
  ).toEqual([]);
});

// The table's header comment says these are the only uv.h rows left out. This
// also keeps the parsers above honest: an enum or uv.h parse that came back
// empty would make every row look unreachable and fail here. (Windows'
// EUNKNOWN slot keeps the array's "unknown error" fill, which is UNKNOWN's
// uv.h text.)
test("the uv.h rows no target's SystemErrno can hold are exactly EAI_* and UNKNOWN", () => {
  const reference = [...parseUvErrnoMap().keys()];
  const anyTarget = new Set(TARGETS.flatMap(([, enumFile]) => [...parseSystemErrnoNames(enumFile)]));

  expect(reference.filter(name => !anyTarget.has(name))).toEqual(
    reference.filter(name => name.startsWith("EAI_") || name === "UNKNOWN"),
  );
});

// The `XX(ENOENT, "no such file or directory")` lines of uv.h's UV_ERRNO_MAP
// macro (its body continues for as long as the lines end in a backslash).
function parseUvErrnoMap(): Map<string, string> {
  const source = readFileSync(path.join(repoRoot, "src", "jsc", "bindings", "libuv", "uv.h"), "utf8");
  const lines = source.split("\n");
  const start = lines.findIndex(line => line.startsWith("#define UV_ERRNO_MAP(XX)"));
  expect(start).toBeGreaterThan(-1);

  const rows = new Map<string, string>();
  for (let i = start; ; i++) {
    const line = lines[i];
    const row = line.match(/^\s*XX\((\w+), "([^"]*)"\)/);
    if (row) {
      expect(rows.has(row[1])).toBeFalse();
      rows.set(row[1], row[2]);
    }
    if (!line.trimEnd().endsWith("\\")) break;
  }
  expect(rows.size).toBeGreaterThan(50);
  return rows;
}

type Row = { name: string; text: string; cfg: string | undefined };

// The rows of build_libuv_error_map(), each with the #[cfg(...)] predicate it
// is compiled under: the one on the `{ ... }` block enclosing it, or on the
// statement itself, or none.
function parseRows(): Row[] {
  const source = readFileSync(path.join(repoRoot, "src", "sys", "libuv_error_map.rs"), "utf8");
  const start = source.indexOf("const fn build_libuv_error_map()");
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf("EnumMap::from_array(arr)", start);
  expect(end).toBeGreaterThan(start);

  const rows: Row[] = [];
  // The predicate in force for each `{` block currently open.
  const blocks: (string | undefined)[] = [];
  // A `#[cfg(...)]` attribute that applies to the next block or statement.
  let pending: string | undefined;
  let attribute = "";
  for (const rawLine of source.slice(start, end).split("\n")) {
    const line = (attribute + rawLine.replace(/\/\/.*/, "")).trim();
    if (line === "") continue;
    if (line.startsWith("#[")) {
      // rustfmt may wrap a long attribute over several lines.
      if (!line.endsWith("]")) {
        attribute = line + " ";
        continue;
      }
      attribute = "";
      const cfg = line.match(/^#\[cfg\((.*)\)\]$/);
      expect(cfg).not.toBeNull();
      expect(pending).toBeUndefined();
      pending = cfg![1];
      continue;
    }
    if (line === "{") {
      blocks.push(combine(blocks.at(-1), pending));
      pending = undefined;
      continue;
    }
    if (line === "}") {
      expect(blocks.length).toBeGreaterThan(0);
      blocks.pop();
      continue;
    }
    const row = line.match(/^arr\[SystemErrno::(\w+) as usize\] = "([^"]*)";$/);
    if (row) {
      rows.push({ name: row[1], text: row[2], cfg: combine(blocks.at(-1), pending) });
      pending = undefined;
      continue;
    }
    // The function signature and the `let mut arr` fill; nothing here takes a cfg.
    expect(pending).toBeUndefined();
  }
  expect(blocks).toEqual([]);
  expect(pending).toBeUndefined();
  expect(rows.length).toBeGreaterThan(50);
  return rows;
}

function combine(outer: string | undefined, inner: string | undefined): string | undefined {
  if (outer === undefined) return inner;
  if (inner === undefined) return outer;
  return `all(${outer}, ${inner})`;
}

// Evaluates a cfg predicate for a target_os. Only the forms the table uses are
// understood; a new one fails loudly here rather than being guessed at.
function evalCfg(predicate: string | undefined, targetOs: string): boolean {
  if (predicate === undefined) return true;
  predicate = predicate.trim();
  const call = predicate.match(/^(any|all|not)\((.*)\)$/s);
  if (call) {
    const operands = splitOperands(call[2]).map(operand => evalCfg(operand, targetOs));
    if (call[1] === "not") {
      expect(operands).toHaveLength(1);
      return !operands[0];
    }
    return call[1] === "any" ? operands.some(Boolean) : operands.every(Boolean);
  }
  if (predicate === "windows") return targetOs === "windows";
  if (predicate === "unix") return targetOs !== "windows";
  const targetOsPredicate = predicate.match(/^target_os = "(\w+)"$/);
  if (targetOsPredicate) return targetOs === targetOsPredicate[1];
  throw new Error(`libuv-error-map.test.ts does not understand the cfg predicate ${JSON.stringify(predicate)}`);
}

// Splits `a, b(c, d), e` on the commas outside parentheses.
function splitOperands(list: string): string[] {
  const operands: string[] = [];
  let depth = 0;
  let operandStart = 0;
  for (let i = 0; i < list.length; i++) {
    if (list[i] === "(") depth++;
    else if (list[i] === ")") depth--;
    else if (list[i] === "," && depth === 0) {
      operands.push(list.slice(operandStart, i));
      operandStart = i + 1;
    }
  }
  // The list may legally end in a comma.
  if (list.slice(operandStart).trim() !== "") operands.push(list.slice(operandStart));
  return operands;
}

// The variants of `pub enum SystemErrno` in src/errno/<file>, plus the
// associated consts that alias one variant under another errno's name (FreeBSD
// spells ENOTSUP that way), since a row may index the array by either.
function parseSystemErrnoNames(file: string): Set<string> {
  const source = readFileSync(path.join(repoRoot, "src", "errno", file), "utf8");
  const start = source.indexOf("pub enum SystemErrno {");
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf("\n}", start);
  expect(end).toBeGreaterThan(start);

  const names = new Set<string>();
  for (const [, name] of source.slice(start, end).matchAll(/^\s+(\w+) = \d+,/gm)) names.add(name);
  expect(names.size).toBeGreaterThan(50);
  for (const [, alias, target] of source.matchAll(/^\s+pub const (\w+): SystemErrno = SystemErrno::(\w+);/gm)) {
    expect(names.has(target)).toBeTrue();
    names.add(alias);
  }
  return names;
}
