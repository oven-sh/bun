import { expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug } from "harness";

// Terminating a node:worker_threads Worker while its startup preloads are
// running can land the NeedTermination trap inside
// JSModuleLoader::hostLoadImportedModule's resolve() call. JSC used to treat
// the resulting TerminationException like an ordinary resolution error: it
// cached it in m_resolutionFailures, returned early from
// rejectWithCaughtException (TRY_CLEAR_EXCEPTION won't clear a termination),
// and entered continueDynamicImport with the termination still pending on the
// VM, where scope.assertNoException() aborts under
// ENABLE(EXCEPTION_SCOPE_VERIFICATION) (debug/ASAN builds).
//
// The window is the tail end of worker startup, so the child calibrates on a
// warm worker's time-to-'online' and sweeps terminate() through a band just
// below it. Explicit builtin preloads widen the cumulative resolve() window so
// the sweep lands in it regardless of host speed.
test(
  "terminate() during worker preload does not abort in the module loader",
  async () => {
    const script = /* js */ `
      const { Worker } = require("node:worker_threads");
      const preload = [
        "node:events", "node:path", "node:util", "node:url", "node:buffer",
        "node:stream", "node:os", "node:fs", "node:crypto", "node:assert",
        "node:querystring", "node:string_decoder", "node:timers", "node:zlib",
      ];
      async function timeToOnline() {
        const t0 = Bun.nanoseconds();
        const w = new Worker("", { eval: true, preload });
        await new Promise(r => w.once("online", r));
        const dt = Bun.nanoseconds() - t0;
        await w.terminate();
        return dt;
      }
      (async () => {
        await timeToOnline(); // cold; discard
        const T = Math.min(await timeToOnline(), await timeToOnline());
        for (let f = 0.55; f <= 1.05; f += 0.02) {
          const w = new Worker("", { eval: true, preload });
          const spinUntil = Bun.nanoseconds() + T * f;
          while (Bun.nanoseconds() < spinUntil) {}
          await w.terminate();
        }
        console.log("ok");
      })().catch(e => { console.error(e); process.exit(1); });
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("ok");
    expect(exitCode).toBe(0);
  },
  isDebug ? 240_000 : 30_000,
);
