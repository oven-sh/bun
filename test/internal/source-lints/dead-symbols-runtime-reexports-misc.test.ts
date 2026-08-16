// Guards against reintroduction of symbols removed as dead code from
// bun_runtime (the `api.rs` / `webcore.rs` / `bake` re-export hubs and a few
// never-constructed enum variants and never-called trait items), plus
// leftovers in bun_core, bun_css, bun_install, bun_bundler, the FFI declaration
// crates and the node error-code table.
//
// Every Rust item here was reported unused by rustc itself: each crate was
// checked with its `pub` items temporarily demoted to `pub(crate)` (so the
// compiler's reachability analysis applied to them) on the linux, windows and
// darwin targets, and an item was only deleted when all three agreed. The
// removal was then validated with `cargo check` on every CI target triple and a
// full `bun bd` build (which regenerates the class / error-code / builtin-name
// codegen that consumes several of these files).
//
// This is a source-tree lint: it reads files from src/ and does not touch the
// built binary, so it belongs in test/internal/source-lints/ per the README.
//
// The Rust checks read the working tree. The deleted-file and JS/C++ content
// checks read the committed tree (HEAD) instead: `git stash` round-trips can
// temporarily restore files a branch deletes (see the same note in
// dead-code-escapes.test.ts), and those strays must not fail the lint.

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

function resurrected(checks: Array<[string, RegExp]>, read: (p: string) => string): string[] {
  const byFile = new Map<string, string>();
  return checks
    .filter(([file, re]) => {
      let text = byFile.get(file);
      if (text === undefined) byFile.set(file, (text = read(file)));
      return re.test(text);
    })
    .map(([file, re]) => `${file}: ${re.source}`);
}

test("orphaned files stay deleted", () => {
  const gone = [
    // `bun_runtime::GeneratedClassesList`: a flat alias namespace nothing read.
    // generate-classes.ts resolves each class to its Rust type by walking the
    // crate's own `pub mod` / `pub use` tree, not this list.
    "src/jsc/generated_classes_list.rs",
  ];
  const tree = headTree();
  expect(gone.filter(p => tree.has(p))).toEqual([]);
});

test("dead bun_runtime re-exports do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    ["src/runtime/lib.rs", /\bGeneratedClassesList\b/],
    ["src/bun.js.rs", /^pub use crate::(api|webcore);/m],
    // `api.rs` mirrored the old `bun.api.*` Zig namespace; these aliases had
    // no readers (the class codegen addresses the types by module path).
    [
      "src/runtime/api.rs",
      /\bas (Image|Shell|Timer|Archive|SecureContext|Subprocess|Glob|HTMLRewriter|JSTranspiler|MarkdownObject|NativePromiseContext|BlockList|NativeBrotli|NativeZlib|NativeZstd|Valkey|MySQL|Postgres|SocketHandlers|FFIObject|x509)\b/,
    ],
    [
      "src/runtime/api.rs",
      /\bpub use crate::(server::(NodeHTTPResponse|ServerConfig|ServerWebSocket)|socket::udp_socket::UDPSocket|ffi::FFI|napi|node|dns_jsc as dns);/,
    ],
    ["src/runtime/api.rs", /\b(PosixSpawnOptions|WaiterThread|CreatePtyError|OpenPtyFn)\b/],
    ["src/runtime/api.rs", /\bpub use spawn::posix_spawn;|\bbun_spawn as spawn;/],
    ["src/runtime/api/JSBundler.rs", /^pub use js_bundler::Config;|\bLoadValue, MiniImportRecord\b/m],
    ["src/runtime/api/BunObject.rs", /\bmi_free_ctx as deallocator\b/],
    ["src/runtime/api/bun/h2_frame_parser.rs", /\bas H2FrameParserConstructor\b/],
    ["src/runtime/webcore.rs", /\bpub use streams::\{|\bpub use form_data::|\bpub mod codegen\b/],
    ["src/runtime/webcore/streams.rs", /\bpub use super::\{StreamError, StreamResult\b/],
    ["src/runtime/webcore/Request.rs", /\bpub use js_gen::from_js(_direct)?;/],
    ["src/runtime/webcore/FormData.rs", /\bget_boundary\b/],
    [
      "src/runtime/bake/mod.rs",
      /\bpub use framework_router as FrameworkRouter;|\b(DynamicRouteMap|EncodedPattern|StaticRouteMap|EntryPointMap|TypeAndFlags)\b/,
    ],
    [
      "src/runtime/bake/dev_server/mod.rs",
      /\bpub use (assets::Assets|incremental_graph::IncrementalGraph|route_bundle::RouteBundle|source_map_store::SourceMapStore);/,
    ],
    ["src/runtime/server/mod.rs", /\b(BunInfo|PreparedRequestFor|ServerInitContext|ServePluginsState)\b/],
    ["src/runtime/lib.rs", /\b(add_completions|bunx_command|create_command|filter_run|multi_run)\b/],
    ["src/runtime/cli/mod.rs", /^\s*pub use super::Command;/m],
    ["src/runtime/cli/Arguments.rs", /\{load_config,/],
    ["src/runtime/allocators/mod.rs", /^pub use linux_mem_fd_allocator::LinuxMemFdAllocator;/m],
    ["src/runtime/shell/interpreter.rs", /^pub use crate::shell::builtin::Builtin;/m],
    ["src/runtime/node/zlib/NativeZstd.rs", /^pub use _impl::\{Context, NativeZstd\};/m],
  ];
  expect(resurrected(checks, src)).toEqual([]);
});

test("dead bun_runtime items do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    // `Writable` results nothing produced, and the `WritableFuture::Handler`
    // callback path no code ever armed.
    ["src/runtime/webcore/streams.rs", /\bWritable::(TemporaryAndDone|IntoArray|IntoArrayAndDone)\b/],
    ["src/runtime/webcore/streams.rs", /\bstruct WritableHandler\b|\bWritableHandlerFn\b|\bWritableFuture::Handler\b/],
    // never-constructed variants
    ["src/runtime/webcore.rs", /\bDrainResult::Empty\b|^\s+Empty,\s*$/m],
    ["src/runtime/webcore/ReadableStream.rs", /\bSource::Direct\b|^\s+Direct,\s*$/m],
    ["src/runtime/test_runner/pretty_format.rs", /\bTag::ArrayBuffer\b/],
    ["src/runtime/shell/Builtin.rs", /\bIoKind::Stdin\b/],
    ["src/runtime/node/node_fs_watcher.rs", /\bEvent::Close\b/],
    ["src/runtime/api/cron.rs", /\bCalendarError::OutOfMemory\b/],
    ["src/runtime/image/thumbhash.rs", /\bDecodeError::OutOfMemory\b/],
    // trait items with no callers
    ["src/runtime/server/mod.rs", /\bconst (SSL_ENABLED|DEBUG_MODE): bool\b|^\s+fn vm_mut\(/m],
    ["src/runtime/bake/dev_server/mod.rs", /\bfn upgrade</],
    ["src/runtime/bake/DevServer.rs", /\bfn upgrade</],
  ];
  expect(resurrected(checks, src)).toEqual([]);
});

test("dead symbols in the other crates do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    ["src/bun_core/string/immutable.rs", /\bpub fn rsplit_once</],
    ["src/bun_core/string/immutable.rs", /^pub use unicode_draft::CodePointZero;/m],
    ["src/bun_core/string/immutable/unicode.rs", /\bconst (ZERO_VALUE|MAX): Self\b/],
    ["src/jsc/lib.rs", /^pub use self::zig_error_type::ZigErrorType;/m],
    ["src/css/css_parser.rs", /\bas CustomMedia;/],
    ["src/css/generics.rs", /^pub use css_eql_partialeq;/m],
    ["src/css/rules/container.rs", /\bContainerNameFns\b/],
    ["src/css/selectors/selector.rs", /\b_PrintErr\b|\b_Printer\b/],
    ["src/install/PackageManager.rs", /\b(do_patch_commit|prepare_patch|GitResolver)\b/],
    [
      "src/install/lib.rs",
      /^pub use (_folder_resolver::FolderResolution|postinstall_optimizer::PostinstallOptimizer);/m,
    ],
    ["src/install/patch_install.rs", /^pub use crate::lockfile::PatchedDep;/m],
    [
      "src/bundler/LinkerContext.rs",
      /\bas (OutputFileListBuilder|StaticRouteVisitor);|^pub use crate::linker_context::do_step5;/m,
    ],
    ["src/bundler/bundle_v2.rs", /^\s+pub use crate::(AdditionalFile|IndexStringMap::IndexStringMap);/m],
    ["src/bundler/lib.rs", /^\s+pub use super::output_file::BakeExtra;/m],
    ["src/collections/lib.rs", /^pub use array_list::ArrayListAlignedIn;/m],
    ["src/sql_jsc/mysql.rs", /^pub use my_sql_request_queue::MySQLRequestQueue;/m],
    ["src/windows_sys/externs.rs", /\bfn SetFileTime\b/],
    ["src/lsquic_sys/lib.rs", /\bfn lsquic_conn_n_pending_streams\b/],
  ];
  expect(resurrected(checks, src)).toEqual([]);
});

test("dead error codes do not reappear", () => {
  const codes = [
    "ERR_BUFFER_CONTEXT_NOT_AVAILABLE",
    "ERR_CRYPTO_INITIALIZATION_FAILED",
    "ERR_CRYPTO_INVALID_COUNTER",
    "ERR_CRYPTO_INVALID_TAG_LENGTH",
    "ERR_CRYPTO_JOB_INIT_FAILED",
    "ERR_CRYPTO_SCRYPT_INVALID_PARAMETER",
    "ERR_EXECUTION_ENVIRONMENT_NOT_AVAILABLE",
    "ERR_INVALID_ADDRESS",
    "ERR_INVALID_PACKAGE_CONFIG",
    "ERR_MESSAGE_TARGET_CONTEXT_UNAVAILABLE",
    "ERR_MISSING_PLATFORM_FOR_WORKER",
    "ERR_NON_CONTEXT_AWARE_DISABLED",
    "ERR_REQUIRE_ASYNC_MODULE",
    "ERR_TLS_PSK_SET_IDENTITY_HINT_FAILED",
    "ERR_WASI_NOT_STARTED",
    "ERR_WORKER_INIT_FAILED",
    "ERR_SECRETS_NOT_AVAILABLE",
  ];
  // A code is only worth an entry once something throws it (`$ERR_X(` in
  // src/js, `ErrorCode::ERR_X` in C++, `ErrorCode::X` in Rust); none of these
  // had a producer.
  const checks: Array<[string, RegExp]> = codes.map(code => [
    "src/jsc/bindings/ErrorCode.ts",
    new RegExp(`\\["${code}"`),
  ]);
  expect(resurrected(checks, headFile)).toEqual([]);
});
