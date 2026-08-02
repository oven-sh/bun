// Guards against reintroduction of symbols removed as dead code from
// node/crypto C++ bindings, js_parser, js_printer, bundler, sql, server, and a
// handful of orphan headers. Each entry was verified to have zero callers
// across src/ and build/debug/codegen/ before deletion. This test fails if any
// reappear.
//
// This is a source-tree lint: it reads files from src/ and does not touch the
// built binary, so it belongs in test/internal/source-lints/ per the README.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");

function src(p: string): string {
  return readFileSync(path.join(repoRoot, p), "utf8");
}

test("orphan headers and unused C++ crypto constructors do not reappear", () => {
  // These files had zero #include references (or, for the constructor pair,
  // defined a class never instantiated because JSPrivateKeyObject /
  // JSPublicKeyObject use JSKeyObjectConstructor instead). They are now
  // empty stubs, so assert on distinctive content rather than existence.
  const checks: Array<[string, RegExp]> = [
    ["src/jsc/headergen/sizegen.cpp", /\bJSArrayBufferViewInlines\.h\b/],
    ["src/runtime/ffi/ffi-stdatomic.h", /\b_STDATOMIC_H\b/],
    ["src/jsc/bindings/node/crypto/JSPrivateKeyObjectConstructor.h", /\bclass JSPrivateKeyObjectConstructor\b/],
    ["src/jsc/bindings/node/crypto/JSPrivateKeyObjectConstructor.cpp", /\bcallPrivateKeyObject\b/],
    ["src/jsc/bindings/node/crypto/JSPublicKeyObjectConstructor.h", /\bclass JSPublicKeyObjectConstructor\b/],
    ["src/jsc/bindings/node/crypto/JSPublicKeyObjectConstructor.cpp", /\bcallPublicKeyObject\b/],
  ];
  const resurrected = checks.filter(([file, re]) => re.test(src(file))).map(([file, re]) => `${file}: ${re.source}`);
  expect(resurrected).toEqual([]);
});

test("dead C++ node binding helpers do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    ["src/jsc/bindings/node/crypto/JSVerify.cpp", /\bkeyFromPublicString\b/],
    ["src/jsc/bindings/node/crypto/JSVerify.h", /\bgetKeyObjectHandleFromJwk\b/],
    ["src/jsc/bindings/node/crypto/JSCipher.h", /\benum class UpdateResult\b/],
    ["src/jsc/bindings/node/http/NodeHTTPParser.h", /\blessThan\b/],
    ["src/jsc/bindings/node/http/NodeHTTPParser.cpp", /\bHTTPParser::lessThan\b/],
    ["src/jsc/bindings/node/JSNodeHTTPServerSocket.cpp", /\buws_res_get_remote_address_info\b/],
  ];
  const resurrected = checks.filter(([file, re]) => re.test(src(file))).map(([file, re]) => `${file}: ${re.source}`);
  expect(resurrected).toEqual([]);
});

test("dead Rust bundler/parser/printer items do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    // bundler: write-only Linker.resolver field + always-false cache guard
    ["src/bundler/linker.rs", /pub resolver:\s*\*mut Resolver/],
    ["src/bundler/linker.rs", /\bhashed_filenames\b/],
    ["src/bundler/linker.rs", /\bIS_CACHE_ENABLED\b/],
    ["src/bundler/Graph.rs", /\bIS_PLUGIN_FILE\b/],
    ["src/bundler/ParseTask.rs", /\bReadFile\b/],
    // js_parser: never-constructed StrictModeFeature variants + write-only
    // FnOnlyDataVisit fields
    ["src/js_parser/parser.rs", /\bWithStatement\b/],
    ["src/js_parser/parser.rs", /\bLegacyOctalLiteral\b/],
    ["src/js_parser/parser.rs", /\bis_inside_async_arrow_fn\b/],
    ["src/js_parser/parser.rs", /\bshould_replace_this_with_class_name_ref\b/],
    ["src/js_parser/parser.rs", /\bclass_name_ref:\s*Option</],
    ["src/bundler/options.rs", /\bfn css_import_behavior\b/],
    // js_printer: write-only Options fields + never-true BufferWriter flag
    ["src/js_printer/lib.rs", /\bcss_import_behavior\b/],
    ["src/js_printer/lib.rs", /pub transform_only: bool/],
    ["src/js_printer/lib.rs", /\bappend_null_byte\b/],
    // sql/mysql: never-constructed protocol enum variants
    ["src/sql/mysql/protocol/CommandType.rs", /\bCOM_QUIT\b/],
    ["src/sql/mysql/protocol/CommandType.rs", /\bCOM_PING\b/],
    ["src/sql/mysql/StatusFlags.rs", /\bSERVER_STATUS_IN_TRANS\b/],
    // server: never-called AnyRoute::ref_ + write-only WebSocket opened bit
    ["src/runtime/server/mod.rs", /fn ref_\(&self\)\s*{\s*match/],
    ["src/runtime/server/ServerWebSocket.rs", /\bOPENED_BIT\b/],
    ["src/runtime/server/ServerWebSocket.rs", /\bset_opened\b/],
    // misc
    ["src/analytics/lib.rs", /\bFeaturesFormatter\b/],
    ["src/runtime/api/bun/h2/wire.rs", /pub const MAX_STREAM_ID\b/],
  ];
  const resurrected = checks.filter(([file, re]) => re.test(src(file))).map(([file, re]) => `${file}: ${re.source}`);
  expect(resurrected).toEqual([]);
});
