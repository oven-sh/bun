import { expect, test } from "bun:test";
import path from "path";

// Every `// HOST_EXPORT(Symbol[, abi])` marker in the Rust sources whose thunk
// is `extern "C"` must have a caller on the C++ side.
//
// `src/codegen/generate-host-exports.ts` turns each marker into a
// `#[unsafe(no_mangle)]` thunk in `generated_host_exports.rs`. That thunk is a
// linker root: rustc's `dead_code` lint and the cross-crate hawk analysis both
// treat it as reachable, so an export whose C++ caller was deleted keeps its
// Rust implementation alive forever without a single warning.
// `Bun__WebSocketClient__writeBlob`, `Bun__WebSocketClientTLS__writeBlob`,
// `Bun__WebSocketClientTLS__initWithTunnel` and `Bun__internal_drainTimers` sat
// in that state: thunk emitted, impl compiled, nothing on the other side of the
// boundary naming them.
//
// The check is textual: the exported symbol must appear as a whole word in a
// tracked C, C++, Objective-C++, or header file under `src/`. A
// declaration-only mention counts (the C++ side routinely declares these in
// `headers.h`); the linker is the strict judge of liveness, this lint only
// catches the export nobody names at all.
//
// Exempt:
// - `rust`-abi markers. Their thunk is `extern "Rust"` and its consumers are
//   `extern "Rust" {}` blocks in other Rust crates (cycle-breaking hooks), so a
//   C++ search cannot see them.
// - Symbols the bindgen generators synthesize. `bindgen_*` names are built by
//   `src/codegen/bindgen-lib-internal.ts` from `.bind.ts` inputs and
//   `js2native_*` names by `src/codegen/generate-js2native.ts`; their callers
//   live in generated C++ (`GeneratedBindings.cpp`, `GeneratedJS2Native.h`)
//   that is not part of the tracked tree.
//
// Both scans go through `git grep` so they see tracked files only (a
// `git stash` round-trip can leave stray files in the working directory) and
// finish in milliseconds under a debug build.

const root = path.resolve(import.meta.dir, "..", "..", "..");

// Same grammar as `markerRe` in src/codegen/generate-host-exports.ts: the
// marker is the whole line. Prose such as "from the `// HOST_EXPORT(Sym, c)`
// markers" in a doc comment does not match. Group 1 is the symbol, group 2
// the abi (`jsc` when absent).
const MARKER = /^\s*\/\/\s*HOST_EXPORT\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:,\s*(jsc|c|rust))?\s*\)\s*$/;

const GENERATED_PREFIXES = ["bindgen_", "js2native_"];

// The C++ side of the boundary. Vendored C libraries (the sqlite amalgamation,
// llhttp) never call back into Rust and are 10 MB of text, so they are excluded.
const CALLER_PATHSPECS = [
  ":(glob)src/**/*.cpp",
  ":(glob)src/**/*.cc",
  ":(glob)src/**/*.c",
  ":(glob)src/**/*.h",
  ":(glob)src/**/*.hpp",
  ":(glob)src/**/*.mm",
  ":(exclude)src/jsc/bindings/sqlite/",
  ":(exclude)src/jsc/bindings/node/http/llhttp/",
];

function gitGrep(args: string[]): string[] {
  const r = Bun.spawnSync({
    // The `-c` overrides pin the output format: a user's `grep.lineNumber`,
    // `grep.column`, or `color.grep` setting would otherwise prefix every
    // match and defeat the parsing below.
    cmd: [
      "git",
      "-C",
      root,
      "-c",
      "grep.lineNumber=false",
      "-c",
      "grep.column=false",
      "-c",
      "color.grep=never",
      "grep",
      ...args,
    ],
    stdout: "pipe",
    stderr: "pipe",
  });
  // Exit code 1 is "no match", anything above is a real failure.
  if (r.exitCode > 1) throw new Error(`git grep failed (${r.exitCode}): ${r.stderr.toString()}`);
  return r.stdout.toString().split("\n").filter(Boolean);
}

// symbol -> "file:line" of its marker
const exports = new Map<string, string>();
const rustAbi = new Set<string>();
const duplicates: string[] = [];
const markerLines = gitGrep(["-n", "-E", "^[[:space:]]*//[[:space:]]*HOST_EXPORT\\(", "--", ":(glob)src/**/*.rs"]);
for (const hit of markerLines) {
  // `<file>:<line>:<content>`; the content may itself contain `:`.
  const first = hit.indexOf(":");
  const second = hit.indexOf(":", first + 1);
  const where = hit.slice(0, second);
  const m = MARKER.exec(hit.slice(second + 1));
  if (!m) continue;
  if (exports.has(m[1])) duplicates.push(`${where}: HOST_EXPORT(${m[1]}) also at ${exports.get(m[1])}`);
  else exports.set(m[1], where);
  if (m[2] === "rust") rustAbi.add(m[1]);
}

const checked = [...exports.keys()].filter(
  symbol => !rustAbi.has(symbol) && !GENERATED_PREFIXES.some(prefix => symbol.startsWith(prefix)),
);

// One `git grep` for every symbol at once: `-w` gives whole-word matches (so
// `X__setTimeout` inside `X__setTimeoutInternal` does not count), `-o -h`
// prints each matched symbol on its own line and nothing else.
const named = new Set(
  checked.length === 0
    ? []
    : gitGrep(["-h", "-o", "-w", "-F", ...checked.flatMap(s => ["-e", s]), "--", ...CALLER_PATHSPECS]),
);

const orphans = checked
  .filter(symbol => !named.has(symbol))
  .map(symbol => `${exports.get(symbol)}: HOST_EXPORT(${symbol})`)
  .sort();

test("the marker grammar still recognizes the tree's host exports", () => {
  // If this goes empty, the marker syntax changed and MARKER above needs
  // updating in step with generate-host-exports.ts.
  expect(exports.size).toBeGreaterThan(50);
  expect(duplicates).toEqual([]);
});

test("the caller scan still sees the C++ side of the boundary", () => {
  // Guards against the pathspecs above over-excluding and turning the orphan
  // check into a vacuous pass.
  expect(named.size).toBeGreaterThan(50);
});

test("every HOST_EXPORT symbol is named by a C or C++ source", () => {
  if (orphans.length > 0) {
    throw new Error(
      `${orphans.length} HOST_EXPORT symbol(s) have no caller outside Rust:\n  ${orphans.join("\n  ")}\n` +
        `Delete the export and its Rust implementation, or add the C++/JS caller that was meant to use it.`,
    );
  }
});
