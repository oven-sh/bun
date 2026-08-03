// Guards against reintroduction of symbols removed as dead code from
// src/platform/darwin.rs, webcrypto C++ (CryptoKeyAES/HMAC::create,
// JSSubtleCrypto::toWrapped, OpenSSL 3.0 unique_ptr aliases), sqlite
// (lazy_sqlite3 unused dlsym entries, schema_versions), NodeVM
// (sigintReceived), and bun_ast (PartTag/JSXElement/import_record
// unused variants, BindingNodeList, StoreAstAllocHeap::reset,
// JSPromise::reject_task). Each entry was verified to have zero callers
// across src/ and build/debug/codegen/ before deletion.
//
// This is a source-tree lint: it reads files from src/ and does not
// touch the built binary.

import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");

function src(p: string): string {
  return readFileSync(path.join(repoRoot, p), "utf8");
}

test("src/platform/darwin.rs is removed (duplicated bun_sys::darwin)", () => {
  expect(existsSync(path.join(repoRoot, "src/platform/darwin.rs"))).toBe(false);
  expect(src("src/platform/lib.rs")).not.toMatch(/pub mod darwin;/);
});

test("dead C++ symbols in webcrypto/sqlite/NodeVM do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    ["src/jsc/bindings/webcrypto/CryptoKeyHMAC.h", /static Ref<CryptoKeyHMAC> create\(/],
    ["src/jsc/bindings/webcrypto/CryptoKeyHMAC.cpp", /CryptoKeyHMAC::CryptoKeyHMAC\(const Vector<uint8_t>&/],
    ["src/jsc/bindings/webcrypto/CryptoKeyAES.h", /static Ref<CryptoKeyAES> create\(/],
    [
      "src/jsc/bindings/webcrypto/CryptoKeyAES.cpp",
      /CryptoKeyAES::CryptoKeyAES\(CryptoAlgorithmIdentifier algorithm, const Vector<uint8_t>&/,
    ],
    ["src/jsc/bindings/webcrypto/JSCryptoKey.h", /static JSCryptoKey\* fromJS\(/],
    ["src/jsc/bindings/webcrypto/JSSubtleCrypto.cpp", /JSSubtleCrypto::toWrapped\(/],
    ["src/jsc/bindings/webcrypto/OpenSSLCryptoUniquePtr.h", /\bOsslParamBldPtr\b|\bX509Ptr\b|\bBIOPtr\b/],
    ["src/jsc/bindings/ScriptExecutionContext.h", /\bwrapCryptoKey\b|\bunwrapCryptoKey\b/],
    ["src/jsc/bindings/sqlite/JSSQLStatement.cpp", /\bschema_versions\b/],
    [
      "src/jsc/bindings/sqlite/lazy_sqlite3.h",
      /lazy_sqlite3_column_int\b|lazy_sqlite3_memory_used\b|lazy_sqlite3_prepare16_v3\b/,
    ],
    ["src/jsc/bindings/NodeVM.cpp", /NodeVMGlobalObject::sigintReceived\(/],
    ["src/jsc/bindings/webcore/DOMIsoSubspaces.h", /m_subspaceForJSSQLStatementConstructor\b/],
  ];
  const resurrected = checks.filter(([file, re]) => re.test(src(file))).map(([file, re]) => `${file}: ${re.source}`);
  expect(resurrected).toEqual([]);
});

test("dead Rust symbols in ast/jsc do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    ["src/ast/nodes.rs", /\bBindingNodeList\b/],
    ["src/ast/nodes.rs", /\bJsxImport\b|\bCjsImports\b|PartTag[\s\S]{0,200}ReactFastRefresh,/],
    ["src/ast/lib.rs", /\bHasAnyDynamic\b/],
    ["src/ast/lib.rs", /impl StoreAstAllocHeap \{[\s\S]{0,200}pub fn reset\(/],
    ["src/ast/import_record.rs", /^\s*Tailwind,\s*$/m],
    ["src/jsc/JSPromise.rs", /pub fn reject_task\(/],
    ["src/jsc/JSRuntimeType.rs", /pub const UNDEFINED:/],
  ];
  const resurrected = checks.filter(([file, re]) => re.test(src(file))).map(([file, re]) => `${file}: ${re.source}`);
  expect(resurrected).toEqual([]);
});
