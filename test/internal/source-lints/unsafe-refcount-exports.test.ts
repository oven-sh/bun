import { expect, test } from "bun:test";
import { metaItemPaths, parseRust, type Fn, type RustFile } from "../../../scripts/rust-parser/index.ts";
import { rustSources } from "./rust-sources.ts";

// Rust-implemented refcount entry points exported to C++ (`#[unsafe(no_mangle)]`
// fns named `*__ref`, `*__deref`, `*__unref`, `*__release`) must be `unsafe fn`.
//
// Adjusting an intrusive count is only sound when the caller holds a count on
// an object that is actually refcounted, and no signature can prove that:
// releasing a count nobody owns frees the object out from under its owner, and
// bumping the count of a by-value instance turns its ordinary teardown into a
// free of a non-heap address. That obligation has to be an `unsafe` contract on
// the export itself, because the same symbol is callable from Rust (the
// `ExternalSharedDescriptor` impl, finalizers) as well as from the C++
// `RefDerefTraits` it exists for.
//
// Motivating instance: `Blob__ref` / `Blob__deref` in src/jsc/webcore_types.rs
// were safe `pub extern "C" fn`s over `&mut Blob`, re-exported from
// `bun_runtime::webcore`, so any safe code holding a `Blob` (stack local,
// `AnyBlob` payload) could release the count owned by the JS wrapper or an
// `ExternalShared<Blob>`. `Bun__VmHandle__release` in src/jsc/VmHandle.rs is the
// shape this lint requires.
//
// Scope: definitions only. `safe fn X__deref(..)` declarations of C++-implemented
// functions inside `unsafe extern "C" { .. }` blocks are a separate population,
// as are `*__destroy` shims over raw pointers. The suffix list is the
// enforcement boundary: a new refcount export under another name goes here too.
//
// Sibling guards: unsound-erased-box.test.ts, frozen-nonnull-reborrow.test.ts.

const REFCOUNT_SUFFIX = /__(?:ref|deref|unref|release)$/;

/**
 * Every `fn` definition carrying `#[unsafe(no_mangle)]`, with a `"C"` or
 * `"C-unwind"` ABI, whose name ends in a refcount suffix. Declarations inside
 * `extern "C" { .. }` blocks have no body (and the ABI sits on the block, not
 * the fn), so they never match. An offender is one without `unsafe`.
 */
function findRefcountExports(file: RustFile): Fn[] {
  return file
    .find("Fn")
    .filter(
      fn =>
        fn.body !== null &&
        (fn.abi === "C" || fn.abi === "C-unwind") &&
        REFCOUNT_SUFFIX.test(fn.name) &&
        fn.attrs.some(
          a => a.name === "unsafe" && a.meta.kind === "MetaList" && metaItemPaths(a.meta).includes("no_mangle"),
        ),
    );
}

const sources = rustSources();
const found: string[] = [];
const offenders: string[] = [];
for (const src of sources) {
  for (const fn of findRefcountExports(src.file)) {
    // The fn's span starts at its first qualifier (`pub`, `unsafe`, `extern`),
    // which rustfmt keeps on the same line as the name.
    const entry = `${src.file.location(fn)}: ${fn.name}`;
    found.push(entry);
    if (!fn.unsafe) offenders.push(entry);
  }
}

test("scans a non-empty set of tracked Rust sources", () => {
  // Guards against the corpus filters over-firing and leaving nothing to
  // scan, which would make the assertions below pass vacuously.
  expect(sources.length).toBeGreaterThan(0);
});

test("the query recognizes the shapes it claims to", () => {
  const exports = (snippet: string) =>
    findRefcountExports(parseRust(snippet)).map(fn => ({ name: fn.name, unsafe: fn.unsafe }));
  // The required shape.
  expect(exports('#[unsafe(no_mangle)]\npub unsafe extern "C" fn Foo__ref(this: *mut Foo) {}')).toEqual([
    { name: "Foo__ref", unsafe: true },
  ]);
  // Other attributes, doc comments, restricted visibility, and the unwinding ABI do not hide the export.
  expect(
    exports(
      '/// Docs.\n#[unsafe(no_mangle)]\n#[inline(never)]\n/// More docs.\npub(crate) unsafe extern "C-unwind" fn Foo__unref(this: *mut Foo) {}',
    ),
  ).toEqual([{ name: "Foo__unref", unsafe: true }]);
  // The offending shape: a safe export.
  expect(exports('#[unsafe(no_mangle)]\npub extern "C" fn Foo__deref(this: &mut Foo) {}')).toEqual([
    { name: "Foo__deref", unsafe: false },
  ]);
  expect(exports('#[unsafe(no_mangle)]\nextern "C" fn Foo__release(this: *mut Foo) {}')).toEqual([
    { name: "Foo__release", unsafe: false },
  ]);
  // Out of scope: declarations of C++-implemented functions, `*__destroy`
  // shims, non-exported fns, and prose.
  expect(
    exports('unsafe extern "C" {\n    safe fn Bar__ref(this: *mut Bar);\n    fn Bar__deref(this: *mut Bar);\n}'),
  ).toEqual([]);
  expect(exports('#[unsafe(no_mangle)]\npub extern "C" fn Foo__destroy(this: *mut Foo) {}')).toEqual([]);
  expect(exports('pub extern "C" fn Foo__ref(this: *mut Foo) {}')).toEqual([]);
  expect(exports('// #[unsafe(no_mangle)] pub extern "C" fn Foo__ref(this: *mut Foo) {}\nfn f() {}')).toEqual([]);
});

test("the pattern still recognizes the tree's refcount exports", () => {
  // If this goes empty, the exports were renamed or restructured and the
  // suffix list / query above needs updating, not the assertion below.
  expect(found).not.toBeEmpty();
});

test('exported refcount entry points are declared `unsafe extern "C" fn`', () => {
  expect(offenders).toEqual([]);
});
