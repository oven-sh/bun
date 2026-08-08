// Guards against reintroduction of symbols removed as dead code from
// install, runtime/webcore, jsc, sha_hmac, and several leaf crates. Each
// entry was verified to have zero references across src/, src/codegen/,
// src/js/, and build/debug/codegen/ before deletion, and the full build
// links without the removed no_mangle exports.
//
// This is a source-tree lint: it reads files from src/ and does not touch
// the built binary, so it belongs in test/internal/source-lints/ per the
// README.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");

function src(p: string): string {
  return readFileSync(path.join(repoRoot, p), "utf8");
}

function resurrected(checks: Array<[string, RegExp]>): string[] {
  return checks.filter(([file, re]) => re.test(src(file))).map(([file, re]) => `${file}: ${re.source}`);
}

test("dead Rust symbols (install, webcore, jsc, leaf crates) do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    // install: CacheBehavior's LoadFromMemory variant was never constructed,
    // so the enum carried no information and was removed along with its
    // parameter. The memory-only path is by_name_hash_in_memory.
    ["src/install/PackageManifestMap.rs", /pub enum CacheBehavior\b/],

    // runtime/node: version statics with no readers. C++ reads
    // BUN_VERSION_USOCKETS / BUN_VERSION_UWS from the generated
    // bun_dependency_versions.h instead (since #22561).
    ["src/runtime/node/node_process.rs", /static Bun__versions_uws:/],
    ["src/runtime/node/node_process.rs", /static Bun__versions_usockets:/],

    // jsc: sentinel statics never read from C++, and the PARSER_ERROR const
    // whose only use they were.
    ["src/jsc/ErrorCode.rs", /static Zig_ErrorCodeParserError:/],
    ["src/jsc/ErrorCode.rs", /static Zig_ErrorCodeJSErrorObject:/],
    ["src/jsc/ErrorCode.rs", /const PARSER_ERROR: ErrorCodeInt/],

    // jsc: js_class_module! emitted a dangerously_set_ptr wrapper plus its
    // extern import in every instantiation; no instantiation called it.
    ["src/jsc/generated.rs", /__dangerouslySetPtr/],

    // webcore: StartTag variants never constructed; only the 8 sink tags are
    // used as START_TAG consts and const-generic args.
    ["src/runtime/webcore/streams.rs", /pub enum StartTag \{[^}]*OwnedAndDone/],
    // webcore: never produced by on_read_chunk.
    ["src/runtime/webcore/FileReader.rs", /AmountRead\(usize\)/],

    // sha_hmac: deprecated-API hashers with no callers (only SHA1 and SHA256
    // have consumers), plus unused evp types.
    ["src/sha_hmac/sha.rs", /SHA512_Init,\s*\n\s*boringssl_sys::SHA512_Update/],
    ["src/sha_hmac/sha.rs", /RIPEMD160_Init/],
    ["src/sha_hmac/sha.rs", /new_evp!\(MD5_SHA1/],
    ["src/sha_hmac/sha.rs", /new_evp!\(Blake2,/],

    // wyhash: hash_int's single caller instantiates u32.
    ["src/wyhash/lib.rs", /impl HashInt for u16\b/],
    ["src/wyhash/lib.rs", /impl HashInt for u64\b/],

    // clap: never-constructed variant and the From impl that was its only
    // would-be constructor.
    ["src/clap/error.rs", /WriteFailed/],

    // md: never constructed or matched.
    ["src/md/types.rs", /Setextheader/],

    // react_compiler: zero references.
    ["src/react_compiler/hir/environment_config.rs", /fn default_true\b/],
  ];
  expect(resurrected(checks)).toEqual([]);
});

test("dead C++ header declarations do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    // Declarations for the removed Rust statics above; nothing on the C++
    // side ever read them.
    ["src/jsc/bindings/headers-handwritten.h", /Bun__versions_uws/],
    ["src/jsc/bindings/headers-handwritten.h", /Bun__versions_usockets/],
    ["src/jsc/bindings/headers-handwritten.h", /Zig_ErrorCodeParserError/],
  ];
  expect(resurrected(checks)).toEqual([]);
});

test("unused re-export names do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    // Each name was unreferenced under the re-exported path; the underlying
    // items (where they still exist) are reached via their own modules.
    ["src/install/lib.rs", /pub use patch_install as patch;/],
    ["src/install/lib.rs", /CacheBehavior as ManifestLoad/],
    ["src/sql_jsc/jsc.rs", /pub use SSLConfig as SslConfig;/],
    ["src/sql_jsc/jsc.rs", /ExternColumnIdentifierValue/],
    ["src/api/lib.rs", /NpmRegistryMap/],
    ["src/bundler_jsc/PluginRunner.rs", /as FsPath/],
    ["src/bundler_jsc/lib.rs", /ErrorableString/],
    ["src/errno/linux_errno.rs", /mode_t as Mode/],
    ["src/errno/darwin_errno.rs", /mode_t as Mode/],
    ["src/errno/freebsd_errno.rs", /mode_t as Mode/],
    ["src/spawn/lib.rs", /posix_spawn as PosixSpawn/],
    ["src/runtime/api/bun/spawn.rs", /\bPosixSpawn\b/],
    ["src/runtime/ffi/mod.rs", /pub use abi_type::/],
    ["src/runtime/valkey_jsc/mod.rs", /pub use valkey::\{Options/],
  ];
  expect(resurrected(checks)).toEqual([]);
});

test("stale build-script entries do not reappear", () => {
  // Note: the fail-before gate stashes src/ only, so these script checks are
  // regression guards rather than part of the fail-before proof.
  const checks: Array<[string, RegExp]> = [
    // src/asan-config.c (the glob's last match) was deleted in #29655; the
    // pattern silently matched nothing.
    ["scripts/glob-sources.ts", /"src\/\*\.c"/],
    // Generated #define BUN_DEP_* block was write-only; BunProcess.cpp reads
    // only the BUN_VERSION_* constants.
    ["scripts/build/depVersionsHeader.ts", /BUN_DEP_/],
    // Computed, stored, never read.
    ["scripts/build/config.ts", /kqueue/],
  ];
  expect(resurrected(checks)).toEqual([]);
});
