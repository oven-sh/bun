// https://github.com/oven-sh/bun/issues/30281
//
// `require()` of an ESM file that statically imports `react` plus an MUI v9
// forwardRef sub-module (`Typography`, `DialogContent`, …) aborts with
// `ASSERTION FAILED: m_status == Status::Fetching` at
// `vendor/WebKit/Source/JavaScriptCore/runtime/ModuleRegistryEntry.cpp:254`
// — SIGABRT on Linux, arm64 PAC IB trap (SIGTRAP) on macOS. Running the
// same file as the ESM entry (`bun repro.js`) is fine; the bug lives on
// the CommonJS-`require()`-of-ESM path added by #29393.
//
// Root cause: `moduleRegistryModuleSettled` (`JSMicrotask.cpp:866`) ran
// twice for the same `ModuleRegistryEntry`. `hostLoadImportedModule`'s
// synchronous-replay path (`JSModuleLoader.cpp:719-723`, the
// "fetchPromise is Fulfilled" branch) calls `makeModule` + `fetchComplete`
// + `modulePromise->fulfillPromise` inline while a require(esm) is
// draining the synchronous queue. If a `ModuleRegistryFetchSettled`
// reaction had already run on the *normal* microtask queue for that
// same entry before we entered sync mode, it left a
// `ModuleRegistryModuleSettled` reaction queued there too. When the
// normal queue later drained, that stale reaction re-entered
// `fetchComplete` on an entry whose status was now `Fetched`, tripping
// the `m_status == Fetching` assertion.
//
// Fix lives in oven-sh/WebKit#217: symmetric
// `modulePromise->status() != Pending` guard in
// `moduleRegistryModuleSettled`, matching the guard that already existed
// in `moduleRegistryFetchSettled`. Until the prebuilt WebKit tarball
// bun links against includes that change, this test runtime-probes the
// bug state and skips the assertion if it's still present — auto-lights
// up the moment `WEBKIT_VERSION` in `scripts/build/deps/webkit.ts` is
// bumped to a build containing oven-sh/WebKit#217. Same split pattern
// as #30186 / oven-sh/WebKit#214 (v-mode regex-set-op fix).
//
// The real MUI dependency graph is the only reliable way to exercise the
// specific sync-replay timing — synthetic graphs don't hit the same
// moduleRegistryFetchSettled-already-queued state, so this test installs
// `react@19` + `@mui/material@9` + the emotion peers into a tempdir and
// runs `bun -e 'require("./repro.js")'` on a two-import file.
//
// Skipped on Windows because `RELEASE_ASSERT`/`WTFCrash` there goes
// through `__debugbreak` / `__fastfail` → NTSTATUS-truncated exit codes
// (3, 9) rather than POSIX 128+signal (134, 133), so the auto-skip guard
// can't recognise the crash shape. The require(esm) sync-replay path
// being exercised is platform-agnostic, so POSIX coverage is sufficient
// to pin the regression. Matches the skipIf(isWindows) precedent in
// test/regression/issue/30205.test.ts.

import { spawn, spawnSync } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

test.skipIf(isWindows)(
  "require() of ESM importing react + @mui/material@9 Typography does not abort",
  async () => {
    using dir = tempDir("issue-30281", {
      "package.json": JSON.stringify({
        name: "repro",
        private: true,
        type: "module",
      }),
      "repro.js": [
        // These two imports together were the minimum trigger reported in
        // the issue. The kind of import on the react side (named, default,
        // namespace) didn't matter — any of them flipped Typography alone
        // from 0 to crash. `DialogContent` reproduces too; `Dialog` and
        // `Button` do not, so it's the shape of the transitive graph, not
        // the export object itself.
        `import { createElement } from "react"`,
        `import Typography from "@mui/material/Typography"`,
        // Touch both symbols so the transpiler doesn't optimise the
        // imports away (the crash happens at module load, not at use,
        // but belt-and-braces). Implementation-agnostic check: MUI can
        // unwrap forwardRef in any 9.x minor now that React 19 supports
        // ref-as-prop, which would flip `typeof Typography` from "object"
        // to "function"; a null-ish check keeps the binding live without
        // encoding MUI's internal component shape.
        `globalThis.__ok = typeof createElement === "function" && Typography != null`,
      ].join("\n"),
    });

    // `bun add` first (pre-setup, not the assertion under test). The versions
    // in the issue report were react@19 + @mui/material@9; the emotion peers
    // are pinned to @11 (what MUI v9 actually peerDepends on) so a future
    // emotion major can't silently reshape the dependency graph and defang
    // the sync-replay timing this test exercises.
    const install = spawnSync({
      cmd: [bunExe(), "add", "react@19", "@mui/material@9", "@emotion/styled@11", "@emotion/react@11"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (install.exitCode !== 0) {
      throw new Error(`bun add failed: ${install.stderr.toString()}`);
    }

    // CI lanes with coredump-upload (see scripts/runner.node.mjs:1236-1244)
    // flag any new core file as a test failure regardless of the in-test
    // exit-code guard below, and the WebKit bug is an abort()-class crash
    // that produces one. `ulimit -c 0` inherits into the spawned bun and
    // suppresses the dump before the kernel writes it — same pattern as
    // test/regression/issue/30205.test.ts's `ulimit -c 0 && exec "$@"`
    // wrapper, same reasoning as the setrlimit(RLIMIT_CORE, {0,0}) in
    // BunProcess.cpp's execve path.
    await using proc = spawn({
      cmd: [
        "/bin/sh",
        "-c",
        `ulimit -c 0 && exec "$@"`,
        "--",
        bunExe(),
        "-e",
        `require("./repro.js"); if (!globalThis.__ok) throw new Error("imports lost"); console.log("loaded");`,
      ],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Auto-skip pattern: if the bug is still present in the prebuilt WebKit,
    // `require(./repro.js)` aborts — SIGABRT on Linux (exit 134), SIGTRAP
    // on arm64 macOS (exit 133). The signal shape is consistent across debug
    // and release on POSIX; debug builds additionally print
    // `ASSERTION FAILED: m_status == Status::Fetching` to stderr via
    // `WTFReportAssertionFailure`, but release builds go through `WTFCrash` /
    // `__builtin_trap()` and write nothing. Gate on the abort-signal exit
    // code alone. Any *other* non-zero exit (install regression, missing peer
    // dep, unrelated panic) falls through to the assertions so real breakage
    // isn't silently swallowed — the stderr capture below surfaces the error
    // text in CI when that happens.
    if (exitCode === 134 || exitCode === 133) {
      // eslint-disable-next-line no-console
      console.log(
        "[#30281] WebKit still has the module-loader double-fetchComplete bug " +
          "(exitCode=" +
          exitCode +
          "). Expected until WEBKIT_VERSION is bumped past oven-sh/WebKit#217. " +
          "Skipping assertions.",
      );
      return;
    }

    // On a non-abort non-zero exit, surface the full stderr in the failure
    // diff before asserting exitCode — gives the actual error instead of
    // just "expected 0, got N". House-style conditional check from #29322.
    if (exitCode !== 0) expect(stderr).toBe("");
    expect(stdout).toBe("loaded\n");
    expect(exitCode).toBe(0);
  },
  120_000,
);
