// Guards against reintroduction of `pub` items removed after a cross-crate
// reachability pass over the Rust workspace. Every entry below was unreachable
// from the shipped roots on all six analyzed targets (linux-gnu, linux-musl,
// android, freebsd, darwin, windows-msvc) with test targets included, had no
// textual references under src/, src/codegen/ or the regenerated
// build/debug/codegen/ output, and the removal was validated with
// `cargo check --workspace` on all ten CI triples plus a full `bun bd` build.
//
// This is a source-tree lint (it only reads src/), so it lives in
// test/internal/source-lints/ per the README there.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");

/**
 * `[file, item]` fails when `item` matches anywhere in the file.
 * `[file, block, item]` fails when `item` matches inside the first match of
 * `block` (used where a same-named item legitimately exists on another type in
 * the same file). A block that no longer exists at all counts as clean.
 */
type Check = [file: string, item: RegExp] | [file: string, block: RegExp, item: RegExp];

function resurrected(checks: Check[]): string[] {
  const out: string[] = [];
  for (const check of checks) {
    const source = readFileSync(path.join(repoRoot, check[0]), "utf8");
    if (check.length === 2) {
      if (check[1].test(source)) out.push(`${check[0]}: ${check[1].source}`);
      continue;
    }
    const block = check[1].exec(source);
    if (block && check[2].test(block[0])) out.push(`${check[0]}: ${check[1].source} :: ${check[2].source}`);
  }
  return out;
}

test("dead bun_core / bun_alloc / bun_ast / bun_ptr items do not reappear", () => {
  expect(
    resurrected([
      ["src/bun_core/bounded_array.rs", /\bpub fn get\(&self, i: usize\)/],
      ["src/bun_core/external_shared.rs", /\bfn as_ptr\b/],
      ["src/bun_core/lib.rs", /\bfn from_raw\(p: \*const \[T\]\)/],
      ["src/bun_core/lib.rs", /\bpub fn concat<'b>\(buf: &'b mut \[u8\]/],
      ["src/bun_core/string/mod.rs", /\bfn from_utf8\(utf8: &\[u8\]\) -> SliceWithUnderlyingString\b/],
      ["src/bun_core/string/write.rs", /\bpub type Result\b/],
      ["src/bun_core/util.rs", /^impl<T: Copy> Unaligned<T> \{[^]*?\n\}/m, /\bpub const fn new\b/],
      ["src/bun_core/util.rs", /\bfn get_mut\(&mut self\) -> &mut T\b/],
      ["src/bun_core/util.rs", /\bfn is_some\(self\)/],
      ["src/bun_core/util.rs", /\bfn is_none\(self\)/],
      ["src/bun_core/util.rs", /\bfn get\(self\) -> Option<GenericIndex<I, M>>/],
      ["src/bun_core/util.rs", /\bfn new\(sec: i64, nsec: i64\)/],
      ["src/bun_alloc/lib.rs", /^impl AllocError \{/m],
      ["src/bun_alloc/lib.rs", /^pub fn usable_size\b/m],
      [
        "src/bun_alloc/lib.rs",
        /^impl<ValueType, const COUNT: usize> BSSList<ValueType, COUNT> \{[^]*?\n\}/m,
        /\bpub fn init\(\)/,
      ],
      ["src/ast/symbol.rs", /\bfn init\(source_count: usize\) -> Map\b/],
      ["src/ptr/lib.rs", /\bfn shared\(self\) -> BackRef<T, Shared>/],
      ["src/ptr/lib.rs", /^impl<T> DetachablePtr<T> \{[^]*?\n\}/m, /\bpub fn as_ptr\b/],
    ]),
  ).toEqual([]);
});

test("dead bun_css items do not reappear", () => {
  expect(
    resurrected([
      // Inherent eql / to_css / parse forwarders whose callers all go through
      // the CssEql / ToCss / Parse trait impls.
      ["src/css/css_parser.rs", /^impl DefaultAtRule \{/m],
      ["src/css/css_parser.rs", /\bfn eql\(lhs: &Token, rhs: &Token\)/],
      ["src/css/css_parser.rs", /\bfn eql\(lhs: &Num, rhs: &Num\)/],
      ["src/css/generics.rs", /\bfn implement_eql\b/],
      ["src/css/generics.rs", /^pub fn parse<T: Parse>/m],
      ["src/css/properties/custom.rs", /\bfn parse_with_options\b/],
      ["src/css/selectors/parser.rs", /\bfn to_css\(&self, _dest: &mut Printer\)/],
      ["src/css/selectors/parser.rs", /\bfn to_css\(self, _dest: &mut Printer\)/],
      ["src/css/values/calc.rs", /\bfn eql\b/],
      ["src/css/values/calc.rs", /\bfn eql_calc_list\b/],
      ["src/css/values/css_string.rs", /\bfn parse\(input: &mut css::Parser\) -> Result<CssString>/],
      ["src/css/values/angle.rs", /\bpub\(crate\) fn eql\b/],
      ["src/css/values/time.rs", /\bpub fn eql\b/],
    ]),
  ).toEqual([]);
});

test("dead bun_jsc items do not reappear", () => {
  expect(
    resurrected([
      ["src/jsc/AbortSignal.rs", /^impl AbortReason \{/m],
      ["src/jsc/ConsoleObject.rs", /^    impl TagPayload \{[^]*?\n    \}/m, /\bpub fn get\b/],
      ["src/jsc/ErrorCode.rs", /\bfn new\(global: &'a G, code: ErrorCode, args: Arguments<'a>\)/],
      ["src/jsc/JSCell.rs", /\bfn to_js\b/],
      ["src/jsc/JSGlobalObject.rs", /\bpub fn to_js<T: Into<JSValue>>/],
      ["src/jsc/JSGlobalObject.rs", /\bpub fn ref_\b/],
      ["src/jsc/JSGlobalObject.rs", /\bpub fn ctx\b/],
      ["src/jsc/JSValue.rs", /\bpub fn cast<T>\(ptr: \*const T\) -> JSValue\b/],
      ["src/jsc/Task.rs", /\bpub fn new<T: Taskable>/],
      ["src/jsc/TopExceptionScope.rs", /\bpub fn new\b/],
      ["src/jsc/array_buffer.rs", /\bpub fn to_js\(&mut self, global: &JSGlobalObject\)/],
      ["src/jsc/job.rs", /\bfn on_js_thread\b/],
      ["src/jsc/job.rs", /\bfn off_thread\b/],
      ["src/jsc/lib.rs", /\bBUILTIN_NAME_MAP\b/],
      ["src/jsc/uuid.rs", /\bconst ZERO\b/],
    ]),
  ).toEqual([]);
});

test("dead FFI-crate items do not reappear", () => {
  expect(
    resurrected([
      ["src/boringssl_sys/boringssl.rs", /\bX509_V_OK\b/],
      ["src/boringssl_sys/boringssl.rs", /\bSSL_SESS_CACHE_CLIENT\b/],
      ["src/boringssl_sys/boringssl.rs", /^impl GeneralNames \{[^]*?\n\}/m, /\bfn is_empty\b/],
      ["src/cares_sys/c_ares.rs", /^impl AddrInfo_hints \{/m],
      ["src/sys/lib.rs", /\bUTIME_OMIT\b/],
      ["src/sys/lib.rs", /\bfn handle\(&self\) -> \*mut c_void\b/],
      ["src/tcc_sys/tcc.rs", /\bSymbolCallback\b/],
      ["src/uws_sys/Loop.rs", /^impl PosixLoop \{[^]*?\n\}/m, /\bpub fn wake\b/],
      ["src/uws_sys/Loop.rs", /^impl PosixLoop \{[^]*?\n\}/m, /\bpub fn run\b/],
      ["src/uws_sys/Response.rs", /\bpub fn init<T>\(response: T\) -> AnyResponse\b/],
      ["src/uws_sys/SocketGroup.rs", /\bfn is_empty\b/],
      ["src/uws_sys/lib.rs", /\bconst Close: Opcode\b/],
      ["src/uws_sys/lib.rs", /\bpub type WindowsLoop\b/],
      ["src/uws_sys/socket.rs", /\bpub type SocketTcp\b/],
      ["src/uws_sys/socket.rs", /\bpub type SocketTls\b/],
      ["src/uws_sys/socket.rs", /\bpub fn group\b/],
      ["src/windows_sys/externs.rs", /\bWaitForSingleObject_raw\b/],
      ["src/windows_sys/externs.rs", /\bpub unsafe fn WaitForSingleObject\b/],
      ["src/windows_sys/externs.rs", /\bpub const fn raw\(self\) -> u32\b/],
      ["src/zlib_sys/shared.rs", /\bz_alloc_fn\b|\bz_free_fn\b/],
      ["src/zlib_sys/shared.rs", /\bpub type Byte\b/],
    ]),
  ).toEqual([]);
});
