// Guards against reintroduction of symbols removed as dead code from the
// shell interpreter, the bake dev server, the SQL wire-protocol enums, the
// package manager, the CLI, and the websocket client.
//
// Each entry was verified to have zero references across src/, scripts/,
// packages/, and freshly regenerated build/debug/codegen/ output before
// deletion, and the removal was validated by `cargo check` on all CI target
// triples plus a full `bun bd` build.
//
// This is a source-tree lint: it reads files from src/ and does not touch the
// built binary, so it belongs in test/internal/source-lints/ per the README.
//
// The Rust checks read the working tree. The C++/JS checks read the committed
// tree (HEAD) instead: `git stash` round-trips can temporarily restore files a
// branch deletes (see the same note in dead-code-escapes.test.ts), and those
// strays must not fail the lint. CI runs against the committed tree, so HEAD
// is what matters.

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

test("dead shell interpreter symbols do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    // WriterTag::{Pipeline,Subshell,If} were never constructed: every
    // ChildPtr::new call passes Builtin/Cmd/CondExpr, and subprocess capture
    // uses the Subproc tag. Their dispatch arms (and the two
    // on_io_writer_chunk handlers only reachable through them) were removed.
    ["src/runtime/shell/IOWriter.rs", /^\s*Pipeline,$/m],
    ["src/runtime/shell/IOWriter.rs", /^\s*Subshell,$/m],
    ["src/runtime/shell/states/Pipeline.rs", /fn on_io_writer_chunk/],
    ["src/runtime/shell/states/Subshell.rs", /fn on_io_writer_chunk/],
    // SubshellState::{Expanding,WaitWriteErr}: never assigned.
    ["src/runtime/shell/states/Subshell.rs", /\bExpanding\b/],
    ["src/runtime/shell/states/Subshell.rs", /\bWaitWriteErr\b/],
    // IfState::{WaitingWriteErr,Done}: never assigned (Done's arm was a
    // panic!("This code should not be reachable")).
    ["src/runtime/shell/states/If.rs", /\bWaitingWriteErr\b/],
    // CondExprState::Done / CatState::Done: completion goes through
    // interp.child_done / Builtin::done directly; the Done states were
    // never assigned.
    ["src/runtime/shell/states/CondExpr.rs", /^\s*Done,$/m],
    ["src/runtime/shell/builtin/cat.rs", /CatState::Done/],
    // Yield::Start: every spawner calls interp.start_node() directly.
    ["src/runtime/shell/Yield.rs", /\bStart\(NodeId\)/],
    // ParseFlagResult::ShowUsage: no FlagParser impl ever returned it.
    ["src/runtime/shell/interpreter.rs", /ParseFlagResult::ShowUsage/],
    // EntryKindHint::File: rm constructs only Idk and Dir.
    ["src/runtime/shell/builtin/rm.rs", /EntryKindHint::File/],
  ];
  const resurrected = checks.filter(([file, re]) => re.test(src(file))).map(([file, re]) => `${file}: ${re.source}`);
  expect(resurrected).toEqual([]);
});

test("dead bake dev server symbols do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    // route_bundle::State::EvaluationFailure was never constructed; the
    // whole chain behind its match arm (EnsureRouteCtx::on_failure impls,
    // the Framework.evaluate_failure field that was never Some, and
    // ErrorPageKind) was unreachable.
    ["src/runtime/bake/dev_server/route_bundle.rs", /\bEvaluationFailure\b/],
    ["src/runtime/bake/dev_server/route_bundle.rs", /\bevaluate_failure\b/],
    ["src/runtime/bake/DevServer.rs", /\bon_failure\b/],
    ["src/runtime/bake/DevServer.rs", /\bErrorPageKind\b/],
    // MessageId::{BrowserMessage,BrowserMessageClear,RequestHandlerError}:
    // wire-protocol bytes the server never sent and no client handled.
    ["src/runtime/bake/dev_server/mod.rs", /BrowserMessage\b/],
    ["src/runtime/bake/dev_server/mod.rs", /RequestHandlerError\b/],
  ];
  const resurrected = checks.filter(([file, re]) => re.test(src(file))).map(([file, re]) => `${file}: ${re.source}`);
  expect(resurrected).toEqual([]);
});

test("dead SQL wire-protocol enum variants do not reappear", () => {
  // CommandType keeps only the three commands bun actually sends
  // (COM_QUERY, COM_STMT_PREPARE, COM_STMT_EXECUTE); the other 28 were
  // never referenced, and the enum is only used as `as u8` in writers.
  const commandType = src("src/sql/mysql/protocol/CommandType.rs");
  expect(/COM_QUIT|COM_PING|COM_STMT_CLOSE|COM_INIT_DB/.test(commandType)).toBe(false);

  // StatusFlag keeps only SERVER_MORE_RESULTS_EXISTS (the one flag
  // StatusFlags::has is ever asked about); raw decode is unaffected
  // because StatusFlags stores the full u16.
  const statusFlags = src("src/sql/mysql/StatusFlags.rs");
  expect(/SERVER_STATUS_IN_TRANS\b|SERVER_SESSION_STATE_CHANGED/.test(statusFlags)).toBe(false);

  const checks: Array<[string, RegExp]> = [
    // Never-constructed error variants. Reverse name-parse (`EnumString`)
    // cannot produce them either: no other error enum in the sql crates
    // carries these names. (AnyPostgresError::Overflow stays: mysql's
    // constructed Overflow could reach it through the by-name
    // `From<crate::Error>` parse.)
    ["src/sql/mysql/protocol/AnyMySQLError.rs", /^\s*InvalidState,$/m],
    ["src/sql/postgres/AnyPostgresError.rs", /\bInvalidByteSequenceForEncoding\b/],
    ["src/sql/postgres/AnyPostgresError.rs", /^\s*InvalidTimeFormat,$/m],
  ];
  const resurrected = checks.filter(([file, re]) => re.test(src(file))).map(([file, re]) => `${file}: ${re.source}`);
  expect(resurrected).toEqual([]);
});

test("dead install/cli symbols do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    // Subcommand::Scan was never constructed: `bun pm scan` dispatches
    // under Subcommand::Pm (see runtime/cli/package_manager_command.rs).
    ["src/install/PackageManager.rs", /^\s*Scan,$/m],
    // (PackageInstall Step variants are checked below, scoped to the enum
    // body so the live Method::Copyfile in the same file can't trip this.)
    // The slow-lifecycle-script log was write-only (empty entry struct,
    // list never read) and its feeding timer was always None.
    ["src/install/PackageManager/PackageManagerLifecycle.rs", /LifecycleScriptTimeLog/],
    ["src/install/lifecycle_script_runner.rs", /MIN_MILLISECONDS_TO_LOG/],
    // PackageInstall.file_count was written but never read; the copy()
    // results' error paths are all that matter.
    ["src/install/PackageInstall.rs", /\bfile_count\b/],
    // PackError::MissingPackageJSON was never constructed (the live
    // MissingPackageJSON variants on bun_install::Error, bun_runtime::Error,
    // and publish's FromTarballError are different enums).
    ["src/runtime/cli/pack_command.rs", /MissingPackageJSON/],
    ["src/runtime/cli/publish_command.rs", /PackError::MissingPackageJSON/],
    // ExampleTag::Unknown had zero references (not even a match arm).
    ["src/runtime/cli/create_command.rs", /^\s*Unknown,$/m],
  ];
  const resurrected = checks.filter(([file, re]) => re.test(src(file))).map(([file, re]) => `${file}: ${re.source}`);
  expect(resurrected).toEqual([]);

  // Step::{Copyfile,Linking,Patching} were never constructed. Scoped to the
  // Step enum body: the same file has a live Method::Copyfile variant.
  const packageInstall = src("src/install/PackageInstall.rs");
  const stepStart = packageInstall.indexOf("pub enum Step");
  const stepEnd = packageInstall.indexOf("}", stepStart);
  expect(stepStart).toBeGreaterThan(-1);
  expect(stepEnd).toBeGreaterThan(stepStart);
  const stepBody = packageInstall.slice(stepStart, stepEnd);
  expect(/\bCopyfile\b|\bLinking\b|\bPatching\b/.test(stepBody)).toBe(false);
});

test("dead websocket/timer/subprocess/watcher/css symbols do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    // Websocket ErrorCode variants never constructed. Discriminants are
    // explicit, so the remaining values still match the C++
    // WebSocketErrorCode table.
    [
      "src/http_jsc/websocket_client.rs",
      /HeadersTooLarge|CompressionFailed = 24|ExpectedControlFrame|ProxyConnectionRefused/,
    ],
    // WTFTimer__runIfImminent: an extern "C" export nothing in C++,
    // vendor/WebKit, or codegen referenced (the imminent-GC path runs via
    // __bun_run_wtf_timer -> EventLoop::run_imminent_gc_timer).
    ["src/runtime/timer/WTFTimer.rs", /WTFTimer__runIfImminent/],
    // Subprocess Readable/Writable stubs with no callers (stream teardown
    // goes through Subprocess::on_close_io and UpstreamSource).
    ["src/runtime/api/bun/subprocess/Readable.rs", /fn on_close|fn on_ready/],
    ["src/runtime/api/bun/subprocess/Writable.rs", /fn on_ready/],
    // fs-watcher EventType::Abort was never sent; C++ keeps its abort case
    // (EventNames.cpp is a by-value string table).
    ["src/runtime/node/node_fs_watcher.rs", /^\s*Abort = 3,$/m],
    // css crate_error::Error::CSSPrintError was never constructed (the
    // live CSSPrintError spellings are the separate PrintErr enum).
    ["src/css/crate_error.rs", /CSSPrintError/],
    // Inherent parse_with_options helpers on GenericSelectorList /
    // GenericSelector: parsing goes through SelectorList::parse /
    // parse_relative with an explicit SelectorParser.
    ["src/css/selectors/parser.rs", /fn parse_with_options/],
  ];
  const resurrected = checks.filter(([file, re]) => re.test(src(file))).map(([file, re]) => `${file}: ${re.source}`);
  expect(resurrected).toEqual([]);
});

test("dead C++/JS symbols do not reappear (committed tree)", () => {
  // KeyObject::getKeyObjectFromHandle: declaration + definition pair with
  // zero callers.
  expect(headFile("src/jsc/bindings/node/crypto/KeyObject.cpp")).not.toMatch(/getKeyObjectFromHandle/);
  expect(headFile("src/jsc/bindings/node/crypto/KeyObject.h")).not.toMatch(/getKeyObjectFromHandle/);

  // REPL internalBinding('util') shim: only ALL_PROPERTIES and
  // SKIP_SYMBOLS are destructured by internal/repl/completion.js, and
  // getOwnNonIndexProperties reads ONLY_ENUMERABLE/SKIP_STRINGS.
  expect(headFile("src/js/internal/repl/node-shims.js")).not.toMatch(/ONLY_WRITABLE|ONLY_CONFIGURABLE/);

  // Vendored-minimatch debug property on makeRe regexes; only _src is read.
  expect(headFile("src/js/internal/fs/glob.ts")).not.toMatch(/_glob:/);
});
