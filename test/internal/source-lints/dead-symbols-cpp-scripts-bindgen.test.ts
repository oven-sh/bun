// Guards against reintroduction of symbols removed as dead code from the C++
// bindings (ncrypto, webcore headers, ZigGlobalObject.h), the Rust bindgen
// glue, and orphaned repo scripts. Each entry was verified to have zero
// references across src/, scripts/, packages/, and regenerated
// build/debug/codegen/ output before deletion, and the removal was validated
// by a full `bun bd` build plus `cargo check` on all 10 CI target triples.
//
// This is a source-tree lint: it reads files from the repo and does not touch
// the built binary, so it belongs in test/internal/source-lints/ per the
// README.
//
// The Rust checks read the working tree. The deleted-file and C++ content
// checks read the committed tree (HEAD) instead: `git stash` round-trips can
// temporarily restore files a branch deletes (see the same note in
// dead-code-escapes.test.ts), and those strays must not fail the lint. CI
// runs against the committed tree, so HEAD is what matters.

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

function headTree(): Set<string> {
  const r = Bun.spawnSync({
    cmd: ["git", "-C", repoRoot, "ls-tree", "-r", "--name-only", "-z", "HEAD"],
    stdout: "pipe",
    stderr: "pipe",
  });
  if (r.exitCode !== 0) {
    throw new Error(`git ls-tree HEAD failed: ${r.stderr.toString()}`);
  }
  return new Set(r.stdout.toString().split("\0").filter(Boolean));
}

test("orphaned scripts and dead C++ headers stay deleted", () => {
  const gone = [
    // scripts whose only invoker (.github/workflows/labeled.yml.disabled) was
    // deleted in #36778, or that were superseded by wired equivalents
    "scripts/label-issue.ts",
    "scripts/read-issue.ts",
    "scripts/handle-crash-patterns.ts",
    "scripts/is-outdated.ts",
    "scripts/associate-issue-with-sentry.ts",
    "scripts/nav2readme.ts", // imported docs/nav, deleted in #24201; could not even run
    "scripts/buildkite-slow-tests.js",
    "scripts/check-node.sh",
    "scripts/check-node-all.sh",
    // DOMJIT IDL helper templates with zero instantiations anywhere
    "src/jsc/bindings/webcore/DOMJITIDLTypeFilter.h",
    "src/jsc/bindings/webcore/DOMJITIDLType.h",
    "src/jsc/bindings/webcore/DOMJITIDLConvert.h",
    "src/jsc/bindings/webcore/DOMJITHelpers.h",
    "src/jsc/bindings/webcore/DOMJITHelpers.cpp",
    // empty stubs kept for an earlier PR's verification mechanics
    "src/jsc/bindings/webcore/MessagePortChannel.h",
    "src/jsc/bindings/webcore/MessagePortChannel.cpp",
    "src/jsc/bindings/webcore/MessagePortChannelProvider.h",
    "src/jsc/bindings/webcore/MessagePortChannelProvider.cpp",
    "src/jsc/bindings/webcore/MessagePortChannelProviderImpl.h",
    "src/jsc/bindings/webcore/MessagePortChannelProviderImpl.cpp",
    "src/jsc/bindings/webcore/MessagePortChannelRegistry.h",
    "src/jsc/bindings/webcore/MessagePortChannelRegistry.cpp",
    "src/jsc/bindings/webcore/MessagePortIdentifier.h",
    "src/jsc/bindings/webcore/BroadcastChannelRegistry.h",
    "src/jsc/bindings/webcore/JSDOMConvertSerializedScriptValue.h",
    "src/jsc/bindings/webcore/JSDOMBuiltinConstructorBase.h",
    "src/jsc/bindings/webcore/JSDOMBuiltinConstructorBase.cpp",
  ];
  const tree = headTree();
  const resurrected = gone.filter(p => tree.has(p));
  expect(resurrected).toEqual([]);
});

test("dead ncrypto methods do not reappear", () => {
  // ncrypto.h declarations whose definitions had zero callers (Node's ncrypto
  // port carries API surface bun never calls). The AES CBC factories are
  // live; only CTR/GCM/KW were dead.
  const header = headFile("src/jsc/bindings/ncrypto.h");
  const checks: RegExp[] = [
    /\bbytesToKey\b/,
    /\bisCtrMode\b/,
    /\bAES_128_CTR\b/,
    /\bAES_256_GCM\b/,
    /\bAES_192_KW\b/,
    /\bsetFipsEnabled\b/,
    /\btestFipsEnabled\b/,
    /\benumUsages\b/,
    /\bgetValidFromTime\b/,
    /\bgetValidToTime\b/,
    /\bsetRsaImplicitRejection\b/,
    /\bprivateCheck\b/,
    /\bpublicCheck\b/,
    /\binitForDerive\b/,
    /\binitForEncrypt\b/,
    /\bderPublicKey\b/,
    /\bencodePadded\b/,
    /\bNewPrime\b/,
    /\bNewSub\b/,
    /\bNewLShift\b/,
    /\bNewFile\b/,
    /\bNewSecMem\b/,
    /\bSecureAlloc\b/,
    /\bGetSecureHeapUsed\b/,
    /\bTryInitSecureHeap\b/,
    /\bhashDigest\b/,
    /\bpeek_back\b/,
    /\bGetGroupName\b/,
    // the named Digest factories; only Digest::FromName has callers
    /Digest& MD5\(\)/,
    /Digest& SHA256\(\)/,
  ];
  const resurrected = checks.filter(re => re.test(header)).map(re => re.source);
  expect(resurrected).toEqual([]);
});

test("dead C++ binding helpers do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    ["src/jsc/bindings/BunString.h", /\bisCrossThreadShareable\b/],
    ["src/jsc/bindings/NodeValidator.h", /\bvalidateArrayBufferView\b/],
    ["src/jsc/bindings/webcore/JSDOMConvertBase.h", /\bconvertResult\b/],
    ["src/jsc/bindings/webcore/JSDOMConvertSequences.h", /\breserveEstimated\b/],
    ["src/jsc/bindings/webcore/EventNames.h", /\bisGamepadEventType\b/],
    ["src/jsc/bindings/webcore/ExceptionDetails.h", /\bEnumTraits\b/],
    ["src/jsc/bindings/webcore/ResourceTiming.h", /\boverrideInitiatorType\b/],
    ["src/jsc/bindings/webcore/WebSocket.h", /\bhasNativeCallbacks\b/],
    ["src/jsc/bindings/webcore/PerformanceObserverCallback.h", /\bhasCallback\b/],
    // accessors with zero callers; the generated JSSink.cpp uses only the
    // *SinkStructure() variants, never *SinkPrototype()
    ["src/jsc/bindings/ZigGlobalObject.h", /\bFileSinkPrototype\b/],
    ["src/jsc/bindings/ZigGlobalObject.h", /\bHTTPResponseSinkPrototype\b/],
    ["src/jsc/bindings/ZigGlobalObject.h", /\bclearDOMGuardedObjects\b/],
    ["src/jsc/bindings/ZigGlobalObject.h", /\bworldIsNormal\(\)/],
    ["src/jsc/bindings/ZigGlobalObject.h", /\bbunStdin\(\)/],
    ["src/jsc/bindings/ZigGlobalObject.h", /\bglobalProxyStructure\(\)/],
    ["src/io/io_darwin.cpp", /\bio_darwin_close_machport\b/],
  ];
  const resurrected = checks
    .filter(([file, re]) => re.test(headFile(file)))
    .map(([file, re]) => `${file}: ${re.source}`);
  expect(resurrected).toEqual([]);
});

test("dead Rust symbols do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    // bindgen optional-repr machinery: no codegen emitter ever names it
    ["src/jsc/bindgen.rs", /\bBindgenOptionalRepr\b/],
    ["src/jsc/bindgen.rs", /\bBindgenOptionalCustom\b/],
    ["src/jsc/bindgen.rs", /\bBindgenExternalShared\b/],
    // Optional::adopt — only consumer was the bindgen machinery above
    // (Strong::adopt, taking a bare NonNull, is live)
    ["src/jsc/Strong.rs", /fn adopt\(handle: Option<NonNull<Impl>>\)/],
    // not force-linked by WebKit's RunLoopBun.cpp (only the six live
    // WTFTimer__* hooks are)
    ["src/runtime/timer/WTFTimer.rs", /\bWTFTimer__runIfImminent\b/],
    // binding construction goes through `Binding::alloc`
    ["src/ast/binding.rs", /\btrait BindingInit\b/],
    // unused flat re-exports; consumers spell bun_jsc:: paths directly
    ["src/runtime/webcore.rs", /pub use bun_jsc::js_error_code::DOMExceptionCode;/],
    ["src/runtime/webcore.rs", /pub use bun_jsc::web_worker;/],
  ];
  const resurrected = checks.filter(([file, re]) => re.test(src(file))).map(([file, re]) => `${file}: ${re.source}`);
  expect(resurrected).toEqual([]);
});
