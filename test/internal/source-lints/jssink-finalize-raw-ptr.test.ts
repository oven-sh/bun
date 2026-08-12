import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// The JSSink finalize chain (`${Sink}__finalize` thunk in generate-jssink.ts ->
// `JSSink::js_finalize` -> `JsSinkType::finalize` -> the inherent method that
// performs the free) must carry the sink as `*mut`, never as a reference.
//
// `__finalize` is what a JS wrapper / controller cell calls when it gives up
// its claim on the native sink, and for some sinks that claim is the
// allocation itself: `ArrayBufferSink` frees its Box there, `FileSink` drops
// the wrapper's intrusive ref (the last one on a normal sweep), and
// `FetchRequestBodySink` drops a tasklet ref whose `deinit` frees the sink.
// A reference argument is protected for the duration of the call it is passed
// to (rustc also marks it `dereferenceable` for the whole call), so freeing the
// pointee from inside that call is UB under Stacked and Tree Borrows even
// though the body's own reborrow carries write provenance. Every frame between
// the C++ caller and the free therefore has to take the raw pointer, the same
// shape as `HTTPServerWritable::abort(this: *mut Self)` and the FileSink
// PipeWriter callbacks; each impl decides for itself whether to reborrow.
//
// Sibling guards: fn-long-mut-reborrow.test.ts, frozen-nonnull-reborrow.test.ts,
// unsafe-refcount-exports.test.ts.

const root = path.resolve(import.meta.dir, "..", "..", "..");
const rustSources = globAllSources().rust.filter(p => p.endsWith(".rs"));

// Only scan files tracked in HEAD (a `git stash` round-trip can leave stray
// `.rs` files in the working tree; CI runs on a clean checkout). Same guard as
// dead-code-escapes.test.ts.
const tracked: Set<string> | null = (() => {
  const r = Bun.spawnSync({
    cmd: ["git", "-C", root, "ls-tree", "-r", "--name-only", "-z", "HEAD"],
    stdout: "pipe",
    stderr: "ignore",
  });
  if (!r.success) return null;
  return new Set(r.stdout.toString().split("\0").filter(Boolean));
})();

// `[ \t]*`, not `\s*`: `\s` crosses newlines and would swallow blank lines,
// shifting the reported line numbers.
const stripLineComments = (content: string) => content.replace(/^[ \t]*\/\/.*$/gm, "");

const lineOf = (content: string, index: number) => content.slice(0, index).split("\n").length;

// Body of the `{ ... }` block whose opening brace is at `open`, or null when
// the braces do not balance.
function blockBody(content: string, open: number): string | null {
  let depth = 0;
  for (let i = open; i < content.length; i++) {
    const c = content[i];
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return content.slice(open + 1, i);
  }
  return null;
}

// `impl<...> [path::]JsSinkType for Type<...> {`, possibly rustfmt-wrapped.
const IMPL_HEADER = /\bimpl\b(?:<[^>]*>)?\s+(?:[\w:]+::)?JsSinkType\s+for\s+(\w+)(?:<[^>]*>)?\s*\{/g;
// Any spelling of a `finalize` item header inside an impl body, and the one
// spelling that is allowed.
const FINALIZE_HEADER = /\b(?:unsafe\s+)?fn\s+finalize\s*\([^)]*\)/;
const RAW_PTR_IMPL = /^unsafe\s+fn\s+finalize\s*\(\s*\w+\s*:\s*\*mut\s+Self\s*\)/;

const impls: string[] = [];
const offenders: string[] = [];
let scanned = 0;
for (const abs of rustSources) {
  const source = path.relative(root, abs).replaceAll(path.sep, "/");
  // `src/cli` is a symlink into `src/runtime/cli`; count each file once under
  // its canonical path.
  if (path.relative(root, realpathSync(abs)).replaceAll(path.sep, "/") !== source) continue;
  if (tracked !== null && !tracked.has(source)) continue;
  scanned++;
  const stripped = stripLineComments(await file(abs).text());
  for (const header of stripped.matchAll(IMPL_HEADER)) {
    const open = header.index + header[0].length - 1;
    const where = `${source}:${lineOf(stripped, header.index)}: impl JsSinkType for ${header[1]}`;
    impls.push(where);
    const body = blockBody(stripped, open);
    if (body === null) {
      offenders.push(`${where}: unbalanced braces`);
      continue;
    }
    const fin = FINALIZE_HEADER.exec(body);
    // An impl without its own `finalize` is the trait declaration's problem
    // (checked below); only an impl that spells one wrongly is reported here.
    if (fin === null) continue;
    if (!RAW_PTR_IMPL.test(fin[0])) {
      offenders.push(`${where}: ${fin[0].replace(/\s+/g, " ")} (line ${lineOf(stripped, open + 1 + fin.index)})`);
    }
  }
}

// The frames above the impls, and the inherent methods below them that perform
// the free (`pub` distinguishes those from the trait impls in the same files,
// which never carry a visibility). Each entry is a file and the signature it
// must contain; a rename here is a reason to update the entry, not to delete it.
const FRAMES: Array<{ file: string; signature: RegExp; what: string }> = [
  {
    file: "src/runtime/webcore/Sink.rs",
    signature: /\bunsafe\s+fn\s+finalize\s*\(\s*this\s*:\s*\*mut\s+Self\s*\)\s*;/,
    what: "JsSinkType::finalize declaration",
  },
  {
    file: "src/runtime/webcore/Sink.rs",
    signature: /\bunsafe\s+fn\s+js_finalize\s*\(\s*this\s*:\s*\*mut\s+T\s*\)/,
    what: "JSSink::js_finalize",
  },
  {
    file: "src/codegen/generate-jssink.ts",
    signature: /\bunsafe\s+extern\s+"C"\s+fn\s+\$\{name\}__finalize\s*\(\s*this\s*:\s*\*mut\s+\$\{name\}\s*\)/,
    what: "generated `${name}__finalize` thunk",
  },
  {
    file: "src/runtime/webcore/ArrayBufferSink.rs",
    signature: /\bpub(?:\([^)]*\))?\s+unsafe\s+fn\s+destroy\s*\(\s*this\s*:\s*\*mut\s+(?:Self|ArrayBufferSink)\s*\)/,
    what: "ArrayBufferSink::destroy",
  },
  {
    file: "src/runtime/webcore/FileSink.rs",
    signature: /\bpub(?:\([^)]*\))?\s+unsafe\s+fn\s+finalize\s*\(\s*this\s*:\s*\*mut\s+(?:Self|FileSink)\s*\)/,
    what: "FileSink::finalize",
  },
  {
    file: "src/runtime/webcore/fetch/FetchRequestBodySink.rs",
    signature:
      /\bpub(?:\([^)]*\))?\s+unsafe\s+fn\s+finalize\s*\(\s*this\s*:\s*\*mut\s+(?:Self|FetchRequestBodySink)\s*\)/,
    what: "FetchRequestBodySink::finalize",
  },
];

const missingFrames: string[] = [];
for (const { file: rel, signature, what } of FRAMES) {
  const content = stripLineComments(await file(path.join(root, rel)).text());
  if (!signature.test(content)) missingFrames.push(`${rel}: ${what} does not take the sink as \`*mut\``);
}

test("scans a non-empty set of tracked Rust sources and finds the sink impls", () => {
  // Guards against the tracked/realpath filters over-firing, and against the
  // impl regex silently matching nothing, either of which would make the
  // assertions below pass vacuously.
  expect(scanned).toBeGreaterThan(0);
  expect(impls).not.toBeEmpty();
});

test("the impl pattern recognizes the shapes it claims to", () => {
  const conforming = ["unsafe fn finalize(this: *mut Self)", "unsafe fn finalize(_this: *mut Self)"];
  const banned = [
    "fn finalize(&mut self)",
    "fn finalize(&self)",
    "fn finalize(self: &mut Self)",
    "unsafe fn finalize(this: &mut Self)",
    "unsafe fn finalize(this: NonNull<Self>)",
    // Not `unsafe`: the contract (the pointer may be freed) must be on the signature.
    "fn finalize(this: *mut Self)",
  ];
  expect(conforming.filter(s => !RAW_PTR_IMPL.test(s))).toEqual([]);
  expect(banned.filter(s => RAW_PTR_IMPL.test(s))).toEqual([]);

  const headers = [
    "impl crate::webcore::sink::JsSinkType for FileSink {",
    // rustfmt wraps the const-generic HTTPServerWritable impl over three lines.
    "impl<const SSL: bool, const HTTP3: bool> crate::webcore::sink::JsSinkType\n    for HTTPServerWritable<SSL, HTTP3>\n{",
    // Not impls of the trait.
    "impl<T: JsSinkType> JSSink<T> {",
    "impl JsSinkAbi for FileSink {",
  ].join("\n");
  expect([...headers.matchAll(IMPL_HEADER)].map(m => m[1])).toEqual(["FileSink", "HTTPServerWritable"]);

  // The inherent-frame entries must see through a conforming trait impl in
  // the same file, or they would pass whenever the impl does.
  const fileSink = FRAMES.find(f => f.what === "FileSink::finalize")!.signature;
  expect(fileSink.test("pub(crate) unsafe fn finalize(this: *mut FileSink) {")).toBe(true);
  expect(fileSink.test("    unsafe fn finalize(this: *mut Self) {\n        unsafe { Self::finalize(this) }")).toBe(
    false,
  );
  expect(fileSink.test("pub fn finalize(&mut self) {")).toBe(false);
});

test("every JsSinkType impl takes the sink to finalize as `*mut Self`", () => {
  expect(offenders).toEqual([]);
});

test("the thunk, js_finalize, the trait declaration and the freeing inherent methods all take `*mut`", () => {
  expect(missingFrames).toEqual([]);
});
