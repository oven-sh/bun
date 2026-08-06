// Guards against reintroduction of symbols removed as dead code from
// bun_install, bun_event_loop, bun_dns, the MySQL wire-protocol structs, the
// C++ JSC bindings, the built-in JS internal modules, and the build flags.
// Each entry was verified to have zero references across src/, scripts/,
// test/, and freshly regenerated build/debug/codegen/ output before deletion,
// and the removal was validated by `cargo check` on all 10 CI target triples
// plus a full `bun bd` build.
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

test("dead Rust symbols (install, event_loop, dns, mysql protocol) do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    // bun_install::Error variants never constructed (bun_runtime has its own
    // same-named enum; these five were ported but nothing maps onto them).
    ["src/install/error.rs", /^\s*FileTooBig,$/m],
    ["src/install/error.rs", /^\s*ProcessFdQuotaExceeded,$/m],
    ["src/install/error.rs", /^\s*ReadOnlyFileSystem,$/m],
    ["src/install/error.rs", /^\s*FileSystem,$/m],
    ["src/install/error.rs", /^\s*FileBusy,$/m],

    // FromTextLockfileError::InvalidSemver was never constructed; its only
    // mention was a dead match arm in bun.lock.rs.
    ["src/install/resolution.rs", /\bInvalidSemver\b/],
    // MigratePnpmLockfileError variants never produced by the migration.
    ["src/install/pnpm.rs", /PnpmLockfileInvalidOverride|PnpmLockfileInvalidPatchedDependency/],
    // FailReason::InvalidShimDataSize: no size check produces it.
    ["src/install/windows-shim/bun_shim_impl.rs", /\bInvalidShimDataSize\b/],
    // TimerCallback: a timer owner type nothing ever constructed (its Tag
    // variant could never be dispatched).
    ["src/event_loop/EventLoopTimer.rs", /\bTimerCallback\b/],
    ["src/runtime/dispatch.rs", /\bTimerCallback\b/],
    // dns Family::Unix: no string map or numeric decode ever yields it.
    ["src/dns/lib.rs", /^\s*Unix,$/m],
    // MySQL wire fields that were decoded (or zero-initialized) but never
    // read; the byte consumption stays, the stores are gone.
    ["src/sql/mysql/protocol/OKPacket.rs", /session_state_changes|pub info:|pub warnings:/],
    ["src/sql/mysql/protocol/EOFPacket.rs", /warnings:/],
    ["src/sql/mysql/protocol/StmtPrepareOKPacket.rs", /pub warning_count:/],
    ["src/sql/mysql/protocol/LocalInfileRequest.rs", /pub filename:|filename: Data::Empty/],
  ];
  const resurrected = checks.filter(([file, re]) => re.test(src(file))).map(([file, re]) => `${file}: ${re.source}`);

  // Representation::Ssh: every ssh-flavored protocol maps to Sshurl. Scoped to
  // the Representation enum body because WellDefinedProtocol::Ssh (a live
  // variant in the same file) would trip a whole-file grep.
  const hosted = src("src/install/hosted_git_info.rs");
  const reprStart = hosted.indexOf("pub enum Representation");
  const reprEnd = hosted.indexOf("}", reprStart);
  expect(reprStart).toBeGreaterThan(-1);
  expect(reprEnd).toBeGreaterThan(reprStart);
  const reprBody = hosted.slice(reprStart, reprEnd);
  if (/^\s*Ssh,$/m.test(reprBody)) {
    resurrected.push("src/install/hosted_git_info.rs: Representation::Ssh");
  }
  expect(resurrected).toEqual([]);
});

test("dead C++ bindings do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    // Host-function wrappers whose $newCppFunction bindings were removed in an
    // earlier sweep; the V::validate* overloads they forwarded to stay live.
    ["src/jsc/bindings/NodeValidator.cpp", /jsFunction_validate(String|Function|Boolean)\b/],
    // jsFunctionRequireResolve + its only callee functionRequireResolve; the
    // live require.resolve path is built elsewhere.
    ["src/jsc/bindings/ImportMetaObject.cpp", /RequireResolve\b/],
    // extern "C" helpers with no Rust-side import in regenerated cpp.rs.
    ["src/jsc/bindings/BunString.cpp", /BunString__toWTFString/],
    // Never-instantiated struct (wrapAnsi.cpp's HyperlinkState is the live one).
    ["src/jsc/bindings/sliceAnsi.cpp", /struct HyperlinkInfo\b/],
    // Template with zero instantiations (the structure accessor pair is live).
    ["src/jsc/bindings/NodeFSStatFSBinding.cpp", /getStatFSPrototype\b/],
    // Declarations with no definition anywhere.
    ["src/jsc/bindings/BunObject.h", /functionBunPeek(Status)?\b/],
    ["src/jsc/bindings/JSBakeResponse.cpp", /JSC_DECLARE_HOST_FUNCTION\((call|construct)BakeResponse\)/],
    ["src/jsc/bindings/sqlite/JSSQLStatement.cpp", /jsSqlStatementGetHasMultipleStatements/],
    ["src/jsc/bindings/dh-primes.h", /bn_set_words/],
    // Stale commented-out blocks (2023-2024 era).
    ["src/jsc/bindings/BunProcess.cpp", /ErrorCaptureStackTrace\(warning/],
    ["src/jsc/bindings/webcore/JSAbortSignal.cpp", /DeletePropertyModeScope/],
    ["src/runtime/bake/BakeGlobalObject.cpp", /setOnEachMicrotaskTick/],
  ];
  const resurrected = checks
    .filter(([file, re]) => re.test(headFile(file)))
    .map(([file, re]) => `${file}: ${re.source}`);
  expect(resurrected).toEqual([]);
});

test("the WebKit weak error finalizer stays defined", () => {
  // Bun__errorInstance__finalize has zero in-tree callers but is
  // weak-referenced by JSC::ErrorInstance::finalizeUnconditionally in
  // vendor/WebKit; removing it breaks the darwin LTO link.
  expect(headFile("src/jsc/bindings/ErrorStackTrace.cpp")).toMatch(
    /extern "C" void Bun__errorInstance__finalize\(void\*/,
  );
});

test("dead built-in JS exports and build defines do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    // repl shim surface no requirer (repl.js, internal/repl/*) ever touched.
    ["src/js/internal/repl/node-shims.js", /kEmptyObject|addAbortListener|runScriptInThisContext|isWritable/],
    // Export entries no requirer destructures (the backing symbols that are
    // still used in-file stay; only the export-default lines are pinned).
    ["src/js/internal/fixed_queue.ts", /^\s*FixedCircularBuffer,$/m],
    ["src/js/internal/promisify.ts", /^\s*defineCustomPromisify,$/m],
    ["src/js/internal/sql/query.ts", /^\s*SQLQueryStatus,$/m],
    ["src/js/internal/trace_events.ts", /^\s*setTid,$/m],
    ["src/js/internal/inspector/cdp.ts", /^\s*EXECUTION_CONTEXT_ID,$/m],
    // Compile defines nothing reads (verified against src/, packages/, and
    // the pinned vendor/WebKit checkout; WebKit's bmalloc macro is the
    // lowercase STATICALLY_LINKED_WITH_bmalloc).
    ["scripts/build/flags.ts", /"IS_BUILD"|"WITH_BORINGSSL=1"|STATICALLY_LINKED_WITH_BMALLOC|PER_VM_ENTRY_SCOPE/],
  ];
  const resurrected = checks
    .filter(([file, re]) => re.test(headFile(file)))
    .map(([file, re]) => `${file}: ${re.source}`);
  expect(resurrected).toEqual([]);
});
