import { expect, test } from "bun:test";
import { parseRustFragment, type RustFile } from "../../../scripts/rust-parser/index.ts";
import { repoRoot, rustSources } from "./rust-sources.ts";

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
// The markers come from the comments of the parsed Rust sources (tracked files
// only). The C++ scan goes through `git grep` so it sees tracked files only (a
// `git stash` round-trip can leave stray files in the working directory) and
// finishes in milliseconds under a debug build.

// Same grammar as `markerRe` in src/codegen/generate-host-exports.ts, applied
// to the text of a `//` comment (which starts at the `//`): the marker is the
// whole comment. Prose such as "from the `// HOST_EXPORT(Sym, c)` markers" in a
// doc comment does not match. Group 1 is the symbol, group 2 the abi (`jsc`
// when absent).
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
      repoRoot,
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

interface Marker {
  symbol: string;
  abi: string;
  /** `file:line` of the marker. */
  where: string;
}

/** The `// HOST_EXPORT(Symbol[, abi])` markers of a file, in source order. */
function findMarkers(file: RustFile): Marker[] {
  const out: Marker[] = [];
  for (const comment of file.comments) {
    if (comment.style !== "line") continue;
    const m = MARKER.exec(comment.text);
    if (!m) continue;
    // generate-host-exports.ts matches whole lines, so a marker written after
    // code on the same line is not a marker there either.
    const lineStart = file.source.lastIndexOf("\n", comment.start - 1) + 1;
    if (file.source.slice(lineStart, comment.start).trim() !== "") continue;
    out.push({ symbol: m[1], abi: m[2] ?? "jsc", where: file.location(comment) });
  }
  return out;
}

// symbol -> "file:line" of its marker
const exports = new Map<string, string>();
const rustAbi = new Set<string>();
const duplicates: string[] = [];
for (const src of rustSources()) {
  for (const { symbol, abi, where } of findMarkers(src.file)) {
    if (exports.has(symbol)) duplicates.push(`${where}: HOST_EXPORT(${symbol}) also at ${exports.get(symbol)}`);
    else exports.set(symbol, where);
    if (abi === "rust") rustAbi.add(symbol);
  }
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

test("the marker grammar recognizes whole-line markers only", () => {
  const markers = (snippet: string) => findMarkers(parseRustFragment(snippet)).map(m => `${m.symbol},${m.abi}`);
  expect(markers("// HOST_EXPORT(Bun__foo)\nfn foo() {}")).toEqual(["Bun__foo,jsc"]);
  expect(markers("    // HOST_EXPORT( Bun__foo , c )\r\n")).toEqual(["Bun__foo,c"]);
  expect(markers("//HOST_EXPORT(Bun__foo,rust)")).toEqual(["Bun__foo,rust"]);
  expect(markers("// HOST_EXPORT(Bun__a)\n// HOST_EXPORT(Bun__b)")).toEqual(["Bun__a,jsc", "Bun__b,jsc"]);
  // Prose, doc and block comments, an unknown abi, and a marker after code
  // on the same line are not markers, for this lint or for the generator.
  expect(markers("// from the `// HOST_EXPORT(Sym, c)` markers")).toEqual([]);
  expect(markers("/// HOST_EXPORT(Bun__foo)")).toEqual([]);
  expect(markers("/* HOST_EXPORT(Bun__foo) */")).toEqual([]);
  expect(markers("// HOST_EXPORT(Bun__foo, zig)")).toEqual([]);
  expect(markers("let x = 1; // HOST_EXPORT(Bun__foo)")).toEqual([]);
});

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
