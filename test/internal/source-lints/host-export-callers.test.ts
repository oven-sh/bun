import { expect, test } from "bun:test";
import path from "path";

// Every hand-written C-ABI export in the Rust sources must be named by
// something other than its own definition.
//
// An export is one of:
// - a `// HOST_EXPORT(Symbol[, abi])` marker, which
//   `src/codegen/generate-host-exports.ts` turns into a `#[unsafe(no_mangle)]`
//   thunk in `generated_host_exports.rs`;
// - a `#[unsafe(no_mangle)]` fn or static;
// - a `#[unsafe(export_name = "Symbol")]` item;
// - a `#[host_fn(export = "Symbol")]` or `#[uws_callback(export = "Symbol")]`
//   shim.
//
// Each one is a linker root: rustc's `dead_code` lint and the cross-crate hawk
// analysis both treat it as reachable, so an export whose C++ caller was
// deleted keeps its Rust implementation alive forever without a single
// warning. `Bun__WebSocketClient__writeBlob`, `Bun__internal_drainTimers`,
// `Zig__GlobalObject__reportUncaughtException`, `BlobArrayBuffer_deallocator`
// and the `Bun__ConsoleObject__profile` family all sat in that state: export
// emitted, impl compiled, nothing on the other side of the boundary naming
// them.
//
// The check is textual: the symbol must appear as a whole word, outside a
// comment, somewhere that is not its own marker, attribute or signature. C,
// C++, Objective-C++ and headers under `src/`, the uWebSockets and uSockets
// sources, the builtin and codegen TypeScript, the exported-symbol lists, and
// other Rust code (an `extern "C" {}` block in another crate is a real
// link-time consumer) all count. A declaration-only mention counts too; the
// linker is the strict judge of liveness, this lint only catches the export
// nobody names at all.
//
// Exempt, with the reason each one is named somewhere this scan cannot see:
// - `rust`-abi markers. Their thunk is `extern "Rust"` and its consumers are
//   `extern "Rust" {}` blocks in other Rust crates (cycle-breaking hooks).
// - Symbols the bindgen generators synthesize. `bindgen_*` names are built by
//   `src/codegen/bindgen-lib-internal.ts` from `.bind.ts` inputs and
//   `js2native_*` names by `src/codegen/generate-js2native.ts`; their callers
//   live in generated C++ (`GeneratedBindings.cpp`, `GeneratedJS2Native.h`)
//   that is not part of the tracked tree.
// - Symbols Bun's WebKit fork imports (`Source/WTF/wtf/bun/RunLoopBun.cpp` and
//   JavaScriptCore). WebKit is a prebuilt dependency, not a tracked tree.
// - BoringSSL's `OPENSSL_memory_*` / `OPENSSL_system_*` allocator hooks,
//   resolved by the vendored BoringSSL at link time.
// - `__wrap_*`: targets of the `-Wl,--wrap=` flags in `scripts/build/`.
// - `__asan_default_options` / `__lsan_default_suppressions`: read by the
//   sanitizer runtime.
// - `SmokeFree__call`: a `#[cfg(test)]` compile-time smoke test of the
//   `host_fn` proc-macro.
//
// Both scans go through `git grep` so they see tracked files only (a
// `git stash` round-trip can leave stray files in the working directory) and
// finish in under a second under a debug build.

const root = path.resolve(import.meta.dir, "..", "..", "..");

// Same grammar as `markerRe` in src/codegen/generate-host-exports.ts: the
// marker is the whole line. Prose such as "from the `// HOST_EXPORT(Sym, c)`
// markers" in a doc comment does not match. Group 1 is the symbol, group 2
// the abi (`jsc` when absent).
const MARKER = /^\s*\/\/\s*HOST_EXPORT\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:,\s*(jsc|c|rust))?\s*\)\s*$/;
const ATTR_NO_MANGLE = /^\s*#\[(?:unsafe\()?no_mangle\)?\]\s*$/;
const ATTR_EXPORT_NAME = /^\s*#\[(?:unsafe\()?export_name\s*=\s*"([A-Za-z_][A-Za-z0-9_]*)"\)?\]/;
const ATTR_EXPORT_ARG = /^\s*#\[[A-Za-z_:]+\((?:[^)]*,\s*)?export\s*=\s*"([A-Za-z_][A-Za-z0-9_]*)"/;
// The item header a `#[no_mangle]` attribute block ends in. Group 1 is the
// name; a `$name` inside a `macro_rules!` body is skipped below.
const ITEM =
  /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:(?:unsafe|safe|const|async)\s+)*(?:extern\s+"[^"]*"\s+)?(?:fn|static(?:\s+mut)?)\s+([A-Za-z_$][A-Za-z0-9_]*)/;
const IDENT = /[A-Za-z_][A-Za-z0-9_]*/g;

const EXEMPT = new Set([
  // Imported by Bun's WebKit fork.
  "Bun__thisThreadHasVM",
  "Bun__analyzeTranspiledModule",
  "Bun__errorInstance__finalize",
  "Bun__reportUnhandledError",
  "WTFTimer__create",
  "WTFTimer__update",
  "WTFTimer__deinit",
  "WTFTimer__cancel",
  "WTFTimer__isActive",
  "WTFTimer__secondsUntilTimer",
  // BoringSSL allocator hooks.
  "OPENSSL_memory_alloc",
  "OPENSSL_memory_free",
  "OPENSSL_memory_get_size",
  "OPENSSL_system_malloc",
  "OPENSSL_system_realloc",
  "OPENSSL_system_free",
  // Sanitizer runtime hooks.
  "__asan_default_options",
  "__lsan_default_suppressions",
  // `#[cfg(test)]` smoke test of the `host_fn` proc-macro.
  "SmokeFree__call",
]);
const EXEMPT_PREFIXES = ["bindgen_", "js2native_", "__wrap_"];

// The Rust sources that can define an export. The Windows bunx shim is a
// separate executable with its own entry points.
const RUST_PATHSPECS = [":(glob)src/**/*.rs", ":(exclude)src/install/windows-shim/"];

// Everything that can name an export. Vendored C libraries (the sqlite
// amalgamation, llhttp) never call back into Rust and are 10 MB of text, so
// they are excluded.
const CALLER_PATHSPECS = [
  ":(glob)src/**/*.cpp",
  ":(glob)src/**/*.cc",
  ":(glob)src/**/*.c",
  ":(glob)src/**/*.h",
  ":(glob)src/**/*.hpp",
  ":(glob)src/**/*.mm",
  ":(glob)src/**/*.ts",
  ":(glob)src/**/*.js",
  ":(glob)src/symbols.*",
  ":(glob)src/*.lds",
  ":(glob)packages/bun-uws/**",
  ":(glob)packages/bun-usockets/**",
  ...RUST_PATHSPECS,
  ":(exclude)src/jsc/bindings/sqlite/",
  ":(exclude)src/jsc/bindings/node/http/llhttp/",
];

function gitGrep(args: string[]): { exitCode: number; lines: string[]; stderr: string } {
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
  return { exitCode: r.exitCode, lines: r.stdout.toString().split("\n").filter(Boolean), stderr: r.stderr.toString() };
}

function gitGrepOrThrow(args: string[]): string[] {
  const r = gitGrep(args);
  // Exit code 1 is "no match", anything above is a real failure.
  if (r.exitCode > 1) throw new Error(`git grep failed (${r.exitCode}): ${r.stderr}`);
  return r.lines;
}

// `<file>:<line>:<content>`; the content may itself contain `:`.
function splitHit(hit: string): { where: string; content: string } {
  const first = hit.indexOf(":");
  const second = hit.indexOf(":", first + 1);
  return { where: hit.slice(0, second), content: hit.slice(second + 1) };
}

// Line comments and the conventional `*`-prefixed body of a block comment. A
// block-comment body line without the `*` is not recognized here; in the
// caller scan that only makes a mention count, never a failure. The
// definition scan below tracks block-comment state itself.
function isComment(line: string): boolean {
  const t = line.trimStart();
  return t.startsWith("//") || t.startsWith("/*") || t.startsWith("*");
}

// Blank out every `/* ... */` range so a commented-out attribute cannot
// register an export. Line numbers are preserved.
function stripBlockComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, block => block.replace(/[^\n]/g, " "));
}

// symbol -> the "<file>:<line>" locations that define it: the marker or
// attribute line, plus the signature line for `#[no_mangle]`. A cfg variant
// can define the same symbol twice; the first location is the one reported.
const exports = new Map<string, string[]>();
const rustAbi = new Set<string>();
const duplicateMarkers: string[] = [];
let markers = 0;

function addExport(symbol: string, where: string[]) {
  if (symbol.startsWith("$")) return;
  exports.set(symbol, [...(exports.get(symbol) ?? []), ...where]);
}

const definingFiles = gitGrepOrThrow([
  "-l",
  "-E",
  'HOST_EXPORT\\(|no_mangle|export_name|export[[:space:]]*=[[:space:]]*"',
  "--",
  ...RUST_PATHSPECS,
]);
for (const file of definingFiles) {
  const lines = stripBlockComments(await Bun.file(path.join(root, file)).text()).split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const where = `${file}:${i + 1}`;
    const marker = MARKER.exec(line);
    if (marker) {
      markers++;
      if (exports.has(marker[1]))
        duplicateMarkers.push(`${where}: HOST_EXPORT(${marker[1]}) also at ${exports.get(marker[1])}`);
      addExport(marker[1], [where]);
      if (marker[2] === "rust") rustAbi.add(marker[1]);
      continue;
    }
    if (isComment(line)) continue;
    const attr = ATTR_EXPORT_NAME.exec(line) ?? ATTR_EXPORT_ARG.exec(line);
    if (attr) {
      addExport(attr[1], [where]);
      continue;
    }
    if (!ATTR_NO_MANGLE.test(line)) continue;
    // Skip the rest of the attribute block and doc comments, then read the
    // item header. A `fn` or `static` must follow; anything else is a macro
    // body or a form this lint does not understand, and is ignored.
    for (let j = i + 1; j < lines.length; j++) {
      const t = lines[j].trim();
      if (t === "" || t.startsWith("#[") || t.startsWith("//")) continue;
      const item = ITEM.exec(lines[j]);
      if (item) addExport(item[1], [where, `${file}:${j + 1}`]);
      break;
    }
  }
}

const checked = [...exports.keys()].filter(
  symbol => !rustAbi.has(symbol) && !EXEMPT.has(symbol) && !EXEMPT_PREFIXES.some(prefix => symbol.startsWith(prefix)),
);
const checkedSet = new Set(checked);

// One `git grep` for every symbol at once. A single PCRE alternation with
// `\b` anchors gives whole-word matches (so `X__setTimeout` inside
// `X__setTimeoutInternal` does not count) and runs an order of magnitude
// faster than one `-e` per symbol. When git was built without PCRE, fall back
// to the POSIX spelling of the same boundary.
function grepCallers(): string[] {
  if (checked.length === 0) return [];
  const alternation = checked.join("|");
  const pcre = gitGrep(["-n", "-P", `\\b(?:${alternation})\\b`, "--", ...CALLER_PATHSPECS]);
  if (pcre.exitCode <= 1) return pcre.lines;
  return gitGrepOrThrow(["-n", "-E", `(^|[^A-Za-z0-9_])(${alternation})($|[^A-Za-z0-9_])`, "--", ...CALLER_PATHSPECS]);
}

const named = new Set<string>();
for (const hit of grepCallers()) {
  const { where, content } = splitHit(hit);
  if (isComment(content)) continue;
  for (const token of content.match(IDENT) ?? []) {
    if (!checkedSet.has(token) || named.has(token)) continue;
    if (!exports.get(token)!.includes(where)) named.add(token);
  }
}

const orphans = checked
  .filter(symbol => !named.has(symbol))
  .map(symbol => `${exports.get(symbol)![0]}: ${symbol}`)
  .sort();

test("the marker and attribute grammar still recognizes the tree's exports", () => {
  // If either count goes low, the syntax changed and MARKER or the attribute
  // regexes above need updating (in step with generate-host-exports.ts for
  // the markers).
  expect(markers).toBeGreaterThan(50);
  expect(exports.size).toBeGreaterThan(300);
  expect(duplicateMarkers).toEqual([]);
});

test("the caller scan still sees the other side of the boundary", () => {
  // Guards against the pathspecs above over-excluding and turning the orphan
  // check into a vacuous pass.
  expect(named.size).toBeGreaterThan(300);
});

test("every export is named by something other than its own definition", () => {
  if (orphans.length > 0) {
    throw new Error(
      `${orphans.length} export(s) are named nowhere but their own definition:\n  ${orphans.join("\n  ")}\n` +
        `Delete the export and its Rust implementation, or add the C++/JS caller that was meant to use it.`,
    );
  }
});
