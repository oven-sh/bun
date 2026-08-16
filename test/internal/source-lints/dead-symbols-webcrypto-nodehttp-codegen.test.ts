// Guards against reintroduction of symbols removed as dead code from the
// WebCrypto bindings, the node:http internal binding (NodeHTTP.cpp and the
// Rust it reached), the class code generator, the build scripts, and a few
// Rust crates. Each entry was verified to have zero references across src/,
// scripts/, test/ and freshly regenerated build/debug/codegen/ output before
// deletion; the removal was validated by `cargo check` on every CI target
// triple plus a full `bun bd` build, and the generator changes by diffing the
// generated output against a snapshot taken before the change.
//
// This is a source-tree lint: it reads files and does not touch the built
// binary, so it belongs in test/internal/source-lints/ per the README.
//
// The Rust checks read the working tree. The C++/JS/script checks read the
// committed tree (HEAD): `git stash` round-trips can temporarily restore files
// a branch deletes (see the same note in dead-code-escapes.test.ts), and those
// strays must not fail the lint. CI runs against the committed tree.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");

function src(p: string): string {
  return readFileSync(path.join(repoRoot, p), "utf8");
}

function headFile(p: string): string {
  const r = Bun.spawnSync({
    cmd: ["git", "-C", repoRoot, "show", `HEAD:${p}`],
    stdout: "pipe",
    stderr: "pipe",
  });
  if (r.exitCode !== 0) {
    throw new Error(`git show HEAD:${p} failed: ${r.stderr.toString()}`);
  }
  return r.stdout.toString();
}

function headHas(p: string): boolean {
  return (
    Bun.spawnSync({
      cmd: ["git", "-C", repoRoot, "cat-file", "-e", `HEAD:${p}`],
      stdout: "ignore",
      stderr: "ignore",
    }).exitCode === 0
  );
}

function resurrected(checks: Array<[string, RegExp]>, read: (p: string) => string): string[] {
  return checks.filter(([file, re]) => re.test(read(file))).map(([file, re]) => `${file}: ${re.source}`);
}

test("files that only held dead code stay deleted", () => {
  const deleted = [
    // RSAES-PKCS1-v1_5 was unreachable behind an always-true deprecation check.
    "src/jsc/bindings/webcrypto/CryptoAlgorithmRSAES_PKCS1_v1_5OpenSSL.cpp",
    // Only converted the RsaKeyGenParams dictionary for that dead generateKey path.
    "src/jsc/bindings/webcrypto/JSRsaKeyGenParams.cpp",
    "src/jsc/bindings/webcrypto/JSRsaKeyGenParams.h",
    // Entirely commented out; produced an empty header nothing included.
    "src/runtime/bake/bake.bind.ts",
  ];
  expect(deleted.filter(headHas)).toEqual([]);
});

test("dead WebCrypto code does not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    // Stubs that returned true unconditionally, and the code they gated.
    ["src/jsc/bindings/webcrypto/SubtleCrypto.cpp", /isRSAESPKCSWebCryptoDeprecated|isSafeCurvesEnabled/],
    ["src/jsc/bindings/webcrypto/SubtleCrypto.cpp", /JSRsaKeyGenParams\.h/],
    ["src/jsc/bindings/webcrypto/SubtleCrypto.h", /addAuthenticatedEncryptionWarningIfNecessary/],
    ["src/jsc/bindings/webcrypto/CryptoAlgorithmRSAES_PKCS1_v1_5.h", /platformEncrypt|platformDecrypt|exportKey/],
    // ECDSA DER output and the RSA padding overrides: nothing ever set them
    // once the old KeyObject.cpp went away.
    ["src/jsc/bindings/webcrypto/CryptoAlgorithmEcdsaParams.h", /CryptoAlgorithmECDSAEncoding|\bencoding\b/],
    ["src/jsc/bindings/webcrypto/CryptoAlgorithmRsaPssParams.h", /\bpadding\b/],
    ["src/jsc/bindings/webcrypto/CryptoAlgorithmRsaOaepParams.h", /\bpadding\b/],
    ["src/jsc/bindings/webcrypto/CryptoAlgorithmRSA_OAEP.h", /platform(Encrypt|Decrypt)WithHash/],
    // No crossThreadCopy instantiation exists for this params type.
    ["src/jsc/bindings/webcrypto/CryptoAlgorithmMlDsaParams.h", /isolatedCopy/],
    ["src/jsc/bindings/webcrypto/CryptoAlgorithm.h", /VoidCallback/],
    // Every JsonWebKey conversion goes through the generic 3-argument path.
    ["src/jsc/bindings/webcrypto/JSJsonWebKey.h", /ignoreExtAndKeyOps/],
  ];
  expect(resurrected(checks, headFile)).toEqual([]);
});

test("the node:http internal binding members nothing imports do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    // Binding members internal/http.ts destructured but never exported to a
    // consumer (the last JS users left with the http client rewrite).
    [
      "src/js/internal/http.ts",
      /assignHeadersFast|setRequestTimeout|headersTuple|webRequestOrResponseHasBodyValue|getCompleteWebRequestOrResponseBodyValueAsArrayBuffer/,
    ],
    ["src/js/internal/http.ts", /kDeprecatedReplySymbol|controllerSymbol|runSymbol|deferredSymbol|firstWriteSymbol/],
    ["src/js/internal/http.ts", /isAbortError|isNextIncomingMessageHTTPS|kEmptyObject/],
    // The host functions those members pointed at, and the helpers only they
    // called. assignHeadersFromUWebSocketsForCall is the live variant.
    [
      "src/jsc/bindings/NodeHTTP.cpp",
      /jsHTTPAssignHeaders|jsHTTPAssignEventCallback|jsHTTPSetTimeout|jsHTTPGetHeader|jsHTTPSetHeader/,
    ],
    ["src/jsc/bindings/NodeHTTP.cpp", /assignHeadersFromFetchHeaders|assignHeadersFromUWebSockets\b|RequestHeaderKind/],
    [
      "src/jsc/bindings/NodeHTTP.cpp",
      /Request__getUWSRequest|Request__setInternalEventCallback|Request__setTimeout|NodeHTTPResponse__setTimeout/,
    ],
    [
      "src/jsc/bindings/NodeHTTP.cpp",
      /jsFunctionRequestOrResponseHasBodyValue|jsFunctionGetCompleteRequestOrResponseBodyValueAsArrayBuffer/,
    ],
    ["src/jsc/bindings/NodeHTTP.h", /jsHTTP(AssignHeaders|GetHeader|SetHeader)/],
    // Smaller built-in JS leftovers.
    ["src/js/internal-for-testing.ts", /fsStreamInternals|isFdAdopted/],
    ["src/js/private.d.ts", /declare var Loader\b/],
    ["src/js/node/wasi.ts", /__importDefault/],
  ];
  expect(resurrected(checks, headFile)).toEqual([]);
});

test("the Rust side of the removed node:http binding does not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    [
      "src/runtime/webcore/Response.rs",
      /jsFunctionRequestOrResponseHasBodyValue|jsFunctionGetCompleteRequestOrResponseBodyValueAsArrayBuffer/,
    ],
    ["src/runtime/webcore/Request.rs", /Request__getUWSRequest|Request__setInternalEventCallback|Request__setTimeout/],
    // Request__setInternalEventCallback was the only writer of this callback,
    // so the per-request timeout/abort hook machinery it fed is gone too.
    ["src/runtime/webcore/Request.rs", /InternalJSEventCallback|internal_event_callback/],
    [
      "src/runtime/server/RequestContext.rs",
      /iec_trigger|iec_deinit|iec_has_callback|set_timeout_handler|HAS_TIMEOUT_HANDLER/,
    ],
    ["src/runtime/server/AnyRequestContext.rs", /enable_timeout_events/],
    ["src/runtime/server/NodeHTTPResponse.rs", /NodeHTTPResponse__setTimeout/],
    ["src/runtime/webcore/Body.rs", /is_definitely_empty/],
  ];
  expect(resurrected(checks, src)).toEqual([]);
});

test("dead Rust items reported by the cross-crate analysis do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    // CssModuleReference variants never constructed (only Dependency is), and
    // the comparison helper nothing called.
    ["src/css/css_modules.rs", /^\s*Local \{|^\s*Global \{|pub fn eql/m],
    // bun_paths has the live copies of these prefixes.
    ["src/sys/windows/mod.rs", /NT_UNC_OBJECT_PREFIX/],
    // The Windows send/recv wrappers pass literal 0.
    ["src/sys/lib.rs", /windows_impl[\s\S]*?pub const MSG_DONTWAIT/],
    ["src/cares_sys/c_ares.rs", /pub fn name\(/],
    // libuv_sys leftovers: bun drives the loop through the uSockets wrapper,
    // so these Loop methods, aliases and accessors had no callers on Windows.
    [
      "src/libuv_sys/libuv.rs",
      /pub fn (ref_|unref|unref_count|run|tick_with_timeout|wakeup|write_raw|get_pid|atime|ctime)\(/,
    ],
    ["src/libuv_sys/libuv.rs", /pub type (CHAR|Tcp|Tty|Poll|uv_timer_t|Async)\b/],
    ["src/libuv_sys/libuv.rs", /fn uv_async_send|fn uv_process_get_pid|ReturnCodeI64 \{[\s\S]{0,40}pub const fn init/],
  ];
  expect(resurrected(checks, src)).toEqual([]);
});

test("class generator features no .classes.ts file uses do not reappear", () => {
  const classDefinitions = headFile("src/codegen/class-definitions.ts");
  const generateClasses = headFile("src/codegen/generate-classes.ts");
  const found: string[] = [];
  for (const re of [
    /^\s*own\??:/m,
    /^\s*callbacks\??:/m,
    /^\s*supportsObjectCreate\??:/m,
    /^\s*custom\??:/m,
    /CustomField/,
  ]) {
    if (re.test(classDefinitions)) found.push(`class-definitions.ts: ${re.source}`);
  }
  for (const re of [
    /generateHashTableComment|generateOwnProperties|renderCallbacksHeader|renderCallbacksCppImpl/,
    /supportsObjectCreate|zigOnly|extraIncludes|ONLY_ZIG|BUN_SILENT/,
    /ZigGeneratedClasses\.lut/,
    /"accessor" in /,
  ]) {
    if (re.test(generateClasses)) found.push(`generate-classes.ts: ${re.source}`);
  }
  if (/ZigGeneratedClasses\.lut/.test(headFile("scripts/build/codegen.ts"))) {
    found.push("scripts/build/codegen.ts: ZigGeneratedClasses.lut");
  }
  // Builtin directives no file in src/js/builtins uses.
  if (/\$nakedConstructor|\$sloppy|\$intrinsic\b/.test(headFile("src/codegen/bundle-functions.ts"))) {
    found.push("bundle-functions.ts: $nakedConstructor | $sloppy | $intrinsic");
  }
  expect(found).toEqual([]);
});

test("dead build-script helpers and build configuration do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    [
      "scripts/utils.mjs",
      /function (downloadTarget|getTargetDownloadUrl|parseTarget|getBuildArtifacts|getBuildkiteArtifacts|getBuildkiteBuildNumber|getChangedFiles|isDocumentation|getPullRequestRepository|getRepositoryOwner|escapeYaml|escapeGitHubAction|parseNumber|getUser)\b/,
    ],
    ["scripts/runner.node.mjs", /listArtifactsFromBuildKite|function escapeGitHubAction\b/],
    // webcrypto has no subdirectories and usockets/internal holds only headers.
    ["scripts/glob-sources.ts", /webcrypto\/\*\/\*\.cpp|bun-usockets\/src\/internal\/\*\.c/],
    // No source file, vendored or not, reads this define (usockets keys off
    // LIBUS_USE_OPENSSL).
    ["scripts/build/flags.ts", /LIBUS_USE_BORINGSSL/],
    // Resolved Config fields nothing read (the PartialConfig inputs of the same
    // name are live and stay).
    ["scripts/build/config.ts", /^\s*(androidNdk|androidApiLevel|freebsdVersion): (string|number) \| undefined;/m],
  ];
  expect(resurrected(checks, headFile)).toEqual([]);
});
