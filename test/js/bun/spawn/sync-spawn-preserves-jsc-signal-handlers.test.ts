// JSC's signal-based VMTraps (the default when `JSC_usePollingTraps` is off)
// interrupts running DFG/FTL code by patching a halt instruction (`hlt` on
// x86, `dc zva, xzr` on arm64) over each invalidation point in the hot
// CodeBlock. The mutator hits it, the kernel delivers SIGSEGV, and WTF's
// `jscSignalHandler` looks the PC up in `DFG::pcCodeBlockMap`, jettisons the
// CodeBlock (which patches the halt back to a jump to the OSR-exit thunk),
// and returns `Handled`. The mutator then OSR-exits and reaches
// `VMTraps::handleTraps()` to service the pending stop-the-world /
// termination / watchdog request.
//
// That only works if `jscSignalHandler` is the installed SIGSEGV disposition.
// `WTF::SignalHandlers::finalize()` installs it on top of whatever was there
// at JSC init time (Bun's crash handler, or ASAN's) and chains unhandled
// faults back down. Anything that later overwrites the fault-signal
// dispositions with `oldact = NULL` breaks VMTraps: the next halt delivers
// SIGSEGV to the wrong handler, which either crashes (Bun's noreturn crash
// reporter) or, if the new handler returns, re-executes the halt forever.
//
// The CLI sync-spawn path (`bun run <pkg-script>`, `bun test --changed`
// spawning git, `bunx`, `bun create`, …) wraps the child wait in a
// signal-forwarding scope (`Bun__registerSignalsForForwarding` /
// `Bun__unregisterSignalsForForwarding`) so SIGINT/SIGTERM reach the child.
// The forwarding set deliberately excludes the CPU-fault signals, and the
// unregister step restores every signal it touched from a saved snapshot, so
// the fault handlers must be identical before and after. An earlier version
// additionally reinstalled Bun's crash handler on SIGSEGV/SIGBUS/SIGILL/SIGFPE
// at scope exit, clobbering `jscSignalHandler` — this test guards that
// regression.
//
// `bun test --changed` is the one cross-platform path where the sync spawn
// runs *inside a live JSC VM* (git runs after `VirtualMachine.init`) and JS
// continues afterward in the same process, so we use it as the vehicle: the
// inner test file records the fault-signal handlers once loaded, and the
// outer test compares them with a baseline captured in a fresh process that
// did no sync spawn at all.
//
// Note: debug ASAN builds never exhibited the regression because
// `crash_handler::reset_on_posix()` early-returns under ASAN; release builds
// did. The invariant asserted here (fault handlers identical with and
// without a preceding sync spawn) is correct for both, so this test guards
// the release behaviour even though `bun bd` alone cannot reproduce the
// original failure.

import { spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { bunEnv, bunExe, isPosix, tempDir, tmpdirSync } from "harness";

// Shared by the baseline process and the inner --changed test: print one
// `HANDLER <sig> <addr>` line per CPU-fault signal via the internal probe
// (which reads `sigaction(sig, NULL, &out)` in native code so the per-libc
// struct layout stays out of JS).
const probe = /* js */ `
  const { crash_handler } = require("bun:internal-for-testing");
  const h = crash_handler.getFaultSignalHandlers();
  for (const name of ["SIGSEGV", "SIGBUS", "SIGILL", "SIGFPE"]) {
    console.log("HANDLER", name, h[name]);
  }
`;

function parseHandlers(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = /^HANDLER (\S+) (\S+)$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}

// git isn't a syscall; keep its environment hermetic so the inner
// `bun test --changed` process's own git invocations don't pick up a
// developer's global excludes/hooks/signing config. GIT_CONFIG_GLOBAL must
// point at a real (empty) file — see test-changed.test.ts for the Windows
// `NUL` caveat.
const emptyGitConfig = join(tmpdirSync(), "empty.gitconfig");
writeFileSync(emptyGitConfig, "");
const env = {
  ...bunEnv,
  BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: emptyGitConfig,
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

function git(cwd: string, ...args: string[]) {
  const res = spawnSync({ cmd: ["git", ...args], cwd, env, stdout: "pipe", stderr: "pipe" });
  if (!res.success) throw new Error(`git ${args.join(" ")} failed in ${cwd}:\n${res.stderr.toString()}`);
}

describe.skipIf(!isPosix)("CLI sync-spawn preserves JSC's fault-signal handlers", () => {
  test("SIGSEGV/SIGBUS dispositions are identical with and without a preceding sync spawn", async () => {
    // Baseline: a fresh bun process that has initialised JSC but done no
    // CLI-level sync spawn. Whatever handlers it reports are exactly what
    // JSC's SignalHandlers::finalize() installed for SIGSEGV/SIGBUS — i.e.,
    // jscSignalHandler — plus whatever SIGILL/SIGFPE happened to be (Bun's
    // crash handler on release, ASAN's or SIG_DFL on debug; JSC does not
    // register for those two in Bun's configuration).
    const baseline = await (async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", probe],
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
      return parseHandlers(stdout);
    })();

    // SIGSEGV and SIGBUS both map to WTF's Signal::AccessFault and so share
    // the same jscSignalHandler sigaction. If either is SIG_DFL the JSC
    // signal layer never installed, which would make the rest of this test
    // meaningless.
    expect(baseline.SIGSEGV).toMatch(/^[0-9a-f]+$/);
    expect(baseline.SIGSEGV).not.toBe("0");
    expect(baseline.SIGBUS).toBe(baseline.SIGSEGV);

    // Now run the same probe as a `bun test --changed` test file. That path
    // initialises JSC, then sync-spawns `git rev-parse` / `git diff` /
    // `git ls-files` (each one a full SignalForwarding register/drop cycle)
    // to compute the changed-files set, *then* loads and runs the test file.
    // The handlers it observes are therefore post-sync-spawn.
    using dir = tempDir("sync-spawn-fault-handlers", {
      "package.json": JSON.stringify({ name: "p", type: "module" }),
      // Wrap the probe in a trivially-passing test so `bun test` exits 0;
      // the outer test reads the HANDLER lines from stdout.
      "probe.test.ts": `import { test } from "bun:test";\n${probe}\ntest("noop", () => {});\n`,
    });
    const cwd = String(dir);
    git(cwd, "init", "-q");
    git(cwd, "config", "commit.gpgsign", "false");
    git(cwd, "add", "-A");
    git(cwd, "commit", "-q", "-m", "initial");
    // One tracked change so --changed actually selects the probe and, more
    // importantly, actually runs the git subprocesses it needs to compute
    // the diff — those are the sync spawns under test.
    writeFileSync(join(cwd, "probe.test.ts"), `import { test } from "bun:test";\n${probe}\ntest("noop", () => {});\n// touched\n`);

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--changed", "probe.test.ts"],
      cwd,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // Surface the inner test's own failures/output before asserting on the
    // handler snapshot — an empty HANDLER set below is much harder to
    // diagnose than the original inner-test error.
    expect({ stderrHasFail: stderr.includes("(fail)"), exitCode }).toEqual({ stderrHasFail: false, exitCode: 0 });
    const afterSyncSpawn = parseHandlers(stdout);

    // ASLR randomises the absolute addresses between the two processes, but
    // the *shape* must match: whatever four handlers the baseline process
    // had, the post-sync-spawn process must have an identical set of four
    // relative to itself. Collapse each snapshot to equality classes
    // (SIGSEGV is always class 0) so `{SEGV:X,BUS:X,ILL:Y,FPE:Z}` and
    // `{SEGV:A,BUS:A,ILL:B,FPE:C}` both become `[0,0,1,2]`, while a
    // regression that moved SIGSEGV onto a different function than the
    // untouched SIGILL/SIGFPE produces a different partition.
    const shape = (h: Record<string, string>) => {
      const order = ["SIGSEGV", "SIGBUS", "SIGILL", "SIGFPE"];
      const seen = new Map<string, number>();
      return order.map(n => {
        const v = h[n] ?? "missing";
        if (!seen.has(v)) seen.set(v, seen.size);
        return seen.get(v);
      });
    };
    expect({
      SIGSEGV: afterSyncSpawn.SIGSEGV,
      SIGBUS: afterSyncSpawn.SIGBUS,
      shapeAfter: shape(afterSyncSpawn),
      shapeBaseline: shape(baseline),
    }).toEqual({
      SIGSEGV: expect.stringMatching(/^[0-9a-f]+$/),
      SIGBUS: afterSyncSpawn.SIGSEGV,
      shapeAfter: shape(baseline),
      shapeBaseline: shape(baseline),
    });
    expect(afterSyncSpawn.SIGSEGV).not.toBe("0");
  });
});
