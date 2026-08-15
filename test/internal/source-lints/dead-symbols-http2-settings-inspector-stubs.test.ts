// Guards against reintroduction of symbols removed as dead code from the
// node:http2 settings plumbing (JS, Rust and C++ sides), the inspector
// HTTPServer agent, a few declaration-only C++ leftovers, two uSockets TLS
// helpers, a handful of never-called Rust items, and the builtin-name tables.
// Each entry was verified to have zero references across src/, packages/,
// scripts/, test/ and freshly regenerated build/debug/codegen/ output before
// deletion (the Rust items additionally by a cross-crate reachability analysis
// on six target triples), and the removal was validated by `cargo check` on
// every CI target triple plus a full `bun bd` build.
//
// This is a source-tree lint: it reads files from src/ and packages/ and does
// not touch the built binary, so it belongs in test/internal/source-lints/ per
// the README.

import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");

function src(p: string): string {
  return readFileSync(path.join(repoRoot, p), "utf8");
}

function resurrected(checks: Array<[string, RegExp]>): string[] {
  return checks.filter(([file, re]) => re.test(src(file))).map(([file, re]) => `${file}: ${re.source}`);
}

test("the unused node:http2 settings plumbing does not reappear", () => {
  const http2 = src("src/js/node/http2.ts");

  // The native assertSettings binding: http2.ts has had its own JS
  // assertSettings() since #28074, so the binding, the Rust host function
  // behind it and the Zig-era C++ declarations of the settings helpers were
  // all unreachable.
  expect(http2).not.toMatch(/_nativeAssertSettings|jsAssertSettings/);
  expect(src("src/runtime/api/bun/h2_frame_parser.rs")).not.toMatch(/\bjs_assert_settings\b/);
  expect(src("src/jsc/bindings/ZigGlobalObject.cpp")).not.toMatch(/BUN__HTTP2/);

  // `const Socket = net.Socket` and the two ServerHttp2Session private fields
  // were never read.
  expect(http2).not.toMatch(/^const Socket = net\.Socket;$/m);
  expect(http2).not.toMatch(/^\s+#isServer\b/m);
  expect(http2.match(/^\s+#url: URL;$/gm) ?? []).toHaveLength(1); // ClientHttp2Session's, which is read

  // The `const { ... } = constants;` block used to bind every constant as a
  // local; 178 of the 240 bindings were unused (all call sites read
  // `constants.X`). Pin a sample spanning each family of the block.
  const end = http2.indexOf("} = constants;");
  expect(end).toBeGreaterThan(-1);
  const start = http2.lastIndexOf("const {", end);
  expect(start).toBeGreaterThan(-1);
  const bound = new Set(
    http2
      .slice(start, end)
      .split("\n")
      .slice(1)
      .map(line => line.trim().replace(/,$/, ""))
      .filter(Boolean),
  );
  const removed = [
    "NGHTTP2_ERR_FRAME_SIZE_ERROR",
    "NGHTTP2_PROTOCOL_ERROR",
    "NGHTTP2_REFUSED_STREAM",
    "NGHTTP2_FLAG_END_STREAM",
    "NGHTTP2_SETTINGS_HEADER_TABLE_SIZE",
    "DEFAULT_SETTINGS_MAX_FRAME_SIZE",
    "PADDING_STRATEGY_ALIGNED",
    "HTTP2_HEADER_ACCEPT",
    "HTTP2_HEADER_CONTENT_DISPOSITION",
    "HTTP2_METHOD_POST",
    "HTTP_STATUS_NOT_FOUND",
    "HTTP_STATUS_INTERNAL_SERVER_ERROR",
  ];
  expect(removed.filter(name => bound.has(name))).toEqual([]);
  // ...while the bindings that are actually used are still there.
  expect(bound.has("NGHTTP2_SESSION_SERVER")).toBe(true);
  expect(bound.has("HTTP2_HEADER_STATUS")).toBe(true);
  expect(bound.has("HTTP_STATUS_OK")).toBe(true);
});

test("dead C++ bindings do not reappear", () => {
  expect(
    resurrected([
      // Protocol command stubs the HTTPServer inspector domain never had
      // (the generated HTTPServerBackendDispatcherHandler only declares
      // enable/disable), so nothing could dispatch to them.
      ["src/jsc/bindings/InspectorHTTPServerAgent.h", /startListening|stopListening|getRequestBody|getResponseBody/],
      ["src/jsc/bindings/InspectorHTTPServerAgent.cpp", /startListening|stopListening|getRequestBody|getResponseBody/],
      // Declarations whose definitions no longer exist anywhere.
      ["src/jsc/bindings/BunObject.cpp", /Bun__DNSResolver__(new|cancel)\b/],
      ["src/jsc/bindings/JSBuffer.cpp", /jsBufferConstructorFunction_isBuffer\b/],
      ["src/jsc/bindings/node/crypto/CryptoUtil.h", /\bgetStringOption\b/],
      // Helper template and macro with zero uses.
      ["src/jsc/bindings/IDLTypes.h", /\bIsIDLEnumeration\b/],
      ["src/jsc/bindings/ZigGlobalObject.cpp", /\bglobalBuiltinFunction\b/],
    ]),
  ).toEqual([]);
});

test("dead uSockets TLS helpers do not reappear", () => {
  expect(
    resurrected([
      // Declared and defined since #29932, never called.
      ["packages/bun-usockets/src/internal/internal.h", /us_internal_ssl_sni_userdata|us_internal_ssl_handshake_abort/],
      ["packages/bun-usockets/src/crypto/openssl.c", /us_internal_ssl_sni_userdata|us_internal_ssl_handshake_abort/],
      // The Security.framework teardown hook had no caller; the loader's
      // failure paths are the only thing that ever frees a SecurityFramework.
      ["packages/bun-usockets/src/crypto/root_certs_platform.h", /us_cleanup_security_framework/],
      [
        "packages/bun-usockets/src/crypto/root_certs_darwin.cpp",
        /us_cleanup_security_framework|\bSecTrustSettingsResult;/,
      ],
    ]),
  ).toEqual([]);
});

test("dead Rust items do not reappear", () => {
  expect(
    resurrected([
      // validate_function_name only ever ran for function expressions, so the
      // FunctionKind parameter (and its never-constructed Stmt variant) went.
      ["src/js_parser/parser.rs", /\bFunctionKind\b/],
      ["src/js_parser/p.rs", /\bFunctionKind\b/],
      ["src/js_parser/parse/parse_fn.rs", /\bFunctionKind\b/],
      // Accessors nothing in the workspace called.
      ["src/ast/expr.rs", /\bfn is_e_string\b/],
      ["src/collections/array_hash_map.rs", /\bfn get_adapted\b/],
      ["src/install_types/resolver_hooks.rs", /\bpub fn eq\(/],
    ]),
  ).toEqual([]);
});

test("dead builtin-name table entries do not reappear", () => {
  const names = src("src/js/builtins/BunBuiltinNames.h");
  const dead = ["Loader", "byobRequest", "controller", "post", "resume", "started", "state", "textDecoder", "view"];
  expect(dead.filter(name => names.includes(`macro(${name})`))).toEqual([]);

  const dts = src("src/js/builtins.d.ts");
  expect(dead.filter(name => new RegExp(`^declare function \\$${name}\\(`, "m").test(dts))).toEqual([]);
  expect(dts).not.toMatch(/\$stream(Closed|Closing|Errored|Readable|Waiting|Writable)\b/);

  const replacements = src("src/codegen/replacements.ts");
  expect(replacements).not.toMatch(/\$stream(Closed|Closing|Errored|Readable|Waiting|Writable)\b/);
  expect(replacements).not.toMatch(/^\s*"Loader",$/m);
  expect(replacements.match(/^\s*"Buffer",$/gm)).toHaveLength(1);
});

test("orphaned files stay deleted", () => {
  // Superseded by the hawk setup in tools/hawk/ and hawk.toml; nothing
  // referenced it.
  expect(existsSync(path.join(repoRoot, "scripts/find-dead-exports.ts"))).toBe(false);
});
