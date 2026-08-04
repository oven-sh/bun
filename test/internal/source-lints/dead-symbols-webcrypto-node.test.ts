// Guards against reintroduction of symbols removed as dead code from
// webcrypto C++ bindings, sqlite bindings, and assorted Rust crates. Each
// entry was verified to have zero callers across src/ and build/debug/codegen/
// before deletion; this test fails if any reappear.
//
// Source-tree lint: reads files from src/ and does not touch the built binary.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");

function src(p: string): string {
  return readFileSync(path.join(repoRoot, p), "utf8");
}

test("webcrypto dead functions do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    // platformSignWithAlgorithm / platformVerifyWithAlgorithm overloads: never called,
    // the base platformSign/platformVerify (which read the hash off the key) are the
    // only path SubtleCrypto uses.
    ["src/jsc/bindings/webcrypto/CryptoAlgorithmHMAC.h", /platformSignWithAlgorithm|platformVerifyWithAlgorithm/],
    [
      "src/jsc/bindings/webcrypto/CryptoAlgorithmHMACOpenSSL.cpp",
      /platformSignWithAlgorithm|platformVerifyWithAlgorithm/,
    ],
    [
      "src/jsc/bindings/webcrypto/CryptoAlgorithmRSASSA_PKCS1_v1_5.h",
      /platformSignWithAlgorithm|platformVerifyWithAlgorithm|platformSignNoAlgorithm|platformVerifyRecover/,
    ],
    [
      "src/jsc/bindings/webcrypto/CryptoAlgorithmRSASSA_PKCS1_v1_5OpenSSL.cpp",
      /platformSignWithAlgorithm|platformVerifyWithAlgorithm|platformSignNoAlgorithm|platformVerifyRecover/,
    ],
    ["src/jsc/bindings/webcrypto/CryptoAlgorithmRSA_PSS.h", /platformSignWithAlgorithm|platformVerifyWithAlgorithm/],
    [
      "src/jsc/bindings/webcrypto/CryptoAlgorithmRSA_PSSOpenSSL.cpp",
      /platformSignWithAlgorithm|platformVerifyWithAlgorithm/,
    ],
    // CryptoKeyHMAC::generateFromBytes: never called, generate() is the only entry.
    ["src/jsc/bindings/webcrypto/CryptoKeyHMAC.h", /generateFromBytes/],
    ["src/jsc/bindings/webcrypto/CryptoKeyHMAC.cpp", /generateFromBytes/],
    // CryptoKeyOKP helpers with no callers (the EC flavour of namedCurveString is live).
    // importJwkInternal existed only to share the body with importPublicJwk.
    [
      "src/jsc/bindings/webcrypto/CryptoKeyOKP.h",
      /importPublicJwk|importJwkInternal|isEd25519PrivateKey|exportKeySizeInBits\b|namedCurveString/,
    ],
    ["src/jsc/bindings/webcrypto/CryptoKeyOKP.cpp", /importPublicJwk|importJwkInternal|::namedCurveString/],
    // CryptoKeyEC::keySizeInBytes: every caller computes (keySizeInBits()+7)/8 locally.
    ["src/jsc/bindings/webcrypto/CryptoKeyEC.h", /size_t keySizeInBytes\(/],
    // #if 0 CommonCrypto and #if USE(GCRYPT) blocks.
    ["src/jsc/bindings/webcrypto/CryptoKeyEC.h", /CCECCryptorRef|USE\(GCRYPT\)/],
    ["src/jsc/bindings/webcrypto/CryptoKeyRSA.h", /CCRSACryptorRef|USE\(GCRYPT\)|class PromiseWrapper;/],
    // convertDictionary<> for output-only KeyAlgorithm dicts: only convertDictionaryToJS
    // is reachable (via toJS<IDLDictionary<>>); nothing parses these from JS.
    ["src/jsc/bindings/webcrypto/JSCryptoKeyPair.cpp", /template<> CryptoKeyPair convertDictionary</],
    ["src/jsc/bindings/webcrypto/JSCryptoKeyPair.h", /template<> CryptoKeyPair convertDictionary</],
    ["src/jsc/bindings/webcrypto/JSCryptoAesKeyAlgorithm.cpp", /template<> CryptoAesKeyAlgorithm convertDictionary</],
    ["src/jsc/bindings/webcrypto/JSCryptoAesKeyAlgorithm.h", /template<> CryptoAesKeyAlgorithm convertDictionary</],
    ["src/jsc/bindings/webcrypto/JSCryptoEcKeyAlgorithm.cpp", /template<> CryptoEcKeyAlgorithm convertDictionary</],
    ["src/jsc/bindings/webcrypto/JSCryptoEcKeyAlgorithm.h", /template<> CryptoEcKeyAlgorithm convertDictionary</],
    ["src/jsc/bindings/webcrypto/JSCryptoHmacKeyAlgorithm.cpp", /template<> CryptoHmacKeyAlgorithm convertDictionary</],
    ["src/jsc/bindings/webcrypto/JSCryptoHmacKeyAlgorithm.h", /template<> CryptoHmacKeyAlgorithm convertDictionary</],
    ["src/jsc/bindings/webcrypto/JSCryptoRsaKeyAlgorithm.cpp", /template<> CryptoRsaKeyAlgorithm convertDictionary</],
    ["src/jsc/bindings/webcrypto/JSCryptoRsaKeyAlgorithm.h", /template<> CryptoRsaKeyAlgorithm convertDictionary</],
    [
      "src/jsc/bindings/webcrypto/JSCryptoRsaHashedKeyAlgorithm.cpp",
      /template<> CryptoRsaHashedKeyAlgorithm convertDictionary</,
    ],
    [
      "src/jsc/bindings/webcrypto/JSCryptoRsaHashedKeyAlgorithm.h",
      /template<> CryptoRsaHashedKeyAlgorithm convertDictionary</,
    ],
    ["src/jsc/bindings/webcrypto/JSCryptoKeyAlgorithm.cpp", /template<> CryptoKeyAlgorithm convertDictionary</],
    ["src/jsc/bindings/webcrypto/JSCryptoKeyAlgorithm.h", /template<> CryptoKeyAlgorithm convertDictionary</],
    // parseEnumeration<CryptoKey::Type>: only toJS<IDLEnumeration<CryptoKey::Type>> is
    // reached; no convert<> path instantiates the parse direction.
    [
      "src/jsc/bindings/webcrypto/JSCryptoKey.cpp",
      /parseEnumeration<CryptoKey::Type>|expectedEnumerationValues<CryptoKey::Type>/,
    ],
    [
      "src/jsc/bindings/webcrypto/JSCryptoKey.h",
      /parseEnumeration<CryptoKey::Type>|expectedEnumerationValues<CryptoKey::Type>/,
    ],
    // KeyFormat is input-only; nothing serializes it back to JS.
    ["src/jsc/bindings/webcrypto/JSSubtleCrypto.cpp", /convertEnumerationToString\(SubtleCrypto::KeyFormat/],
    [
      "src/jsc/bindings/webcrypto/JSSubtleCrypto.h",
      /convertEnumerationToString\(SubtleCrypto::KeyFormat|convertEnumerationToJS\(JSC::JSGlobalObject&, SubtleCrypto::KeyFormat/,
    ],
    // Misc single-line dead decls.
    ["src/jsc/bindings/webcrypto/CryptoDigest.h", /String toHexString\(\);/],
    ["src/jsc/bindings/webcrypto/SubtleCrypto.h", /static SubtleCrypto\* createPtr/],
    [
      "src/jsc/bindings/webcrypto/CommonCryptoDERUtilities.h",
      /bytesNeededForEncodedLength|IntegerMark|unsigned char Version\[\]/,
    ],
    ["src/jsc/bindings/webcrypto/CommonCryptoDERUtilities.cpp", /bytesNeededForEncodedLength/],
  ];
  const resurrected = checks.filter(([file, re]) => re.test(src(file))).map(([file, re]) => `${file}: ${re.source}`);
  expect(resurrected).toEqual([]);
});

test("sqlite dead declarations do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    // Orphan forward declaration with no definition since 2022.
    [
      "src/jsc/bindings/sqlite/JSSQLStatement.cpp",
      /JSC_DECLARE_HOST_FUNCTION\(jsSQLStatementExecuteStatementFunction\);/,
    ],
    // Typedef + inline ptr with no #define alias, no dlsym load, no callers.
    ["src/jsc/bindings/sqlite/lazy_sqlite3.h", /lazy_sqlite3_column_bytes16/],
  ];
  const resurrected = checks.filter(([file, re]) => re.test(src(file))).map(([file, re]) => `${file}: ${re.source}`);
  expect(resurrected).toEqual([]);
});

test("node_error_binding module is not compiled", () => {
  // Both generated functions (ERR_INVALID_HANDLE_TYPE, ERR_CHILD_CLOSED_BEFORE_REPLY)
  // had zero callers; the JS-side $ERR_INVALID_HANDLE_TYPE() is served by the
  // C++ ErrorCode table, not this Rust module. Asserted via the mod declaration
  // rather than file presence: a stray .rs file with no `mod` entry isn't compiled.
  expect(src("src/runtime/node.rs")).not.toMatch(/pub mod node_error_binding;/);
});

test("Rust dead Default impls and helpers do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    // PBKDF2 is only ever built via a struct literal; no Default caller.
    ["src/runtime/crypto/PBKDF2.rs", /impl Default for PBKDF2\b/],
    // StaticCryptoHasher::constructor builds the struct directly.
    ["src/runtime/crypto/CryptoHasher.rs", /impl<H: StaticHasher> Default for StaticCryptoHasher<H>/],
    // RefCountedStr is only constructed via init(), never Default.
    ["src/runtime/shell/RefCountedStr.rs", /impl Default for RefCountedStr\b/],
    // UserInfoOptions only arrives as *const from C++; never Rust-constructed.
    ["src/runtime/node/node_os.rs", /impl Default for UserInfoOptions\b/],
  ];
  const resurrected = checks.filter(([file, re]) => re.test(src(file))).map(([file, re]) => `${file}: ${re.source}`);
  expect(resurrected).toEqual([]);
});
