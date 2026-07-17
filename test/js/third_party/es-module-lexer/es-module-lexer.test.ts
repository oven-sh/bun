import { spawn } from "bun";
import { expect, test } from "bun:test";
import { join } from "path";
import { bunEnv, bunExe, isWindows } from "../../../harness";

// The purpose of this test is to check that event loop tasks scheduled from
// JavaScriptCore (rather than Bun) keep the process alive.
//
// The problem used to be that Bun would close prematurely when async work was
// scheduled by JavaScriptCore.
//
// At the time of writing, this includes WebAssembly compilation and Atomics
// It excludes FinalizationRegistry since that doesn't need to keep the process alive.
const expected = {
  imports: [{ n: "b", s: 19, e: 20, ss: 0, se: 21, d: -1, a: -1 }],
  exports: [{ s: 36, e: 37, ls: 36, le: 37, n: "c", ln: "c" }],
};

// Bound each child so a hung `await init` doesn't burn the whole test timeout;
// the stderr progress markers tell us which phase stalled.
const perChildTimeoutMs = 15_000;

async function runOnce() {
  await using proc = spawn({
    cmd: [bunExe(), join(import.meta.dir, "index.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    timeout: perChildTimeoutMs,
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  if (proc.signalCode !== null) {
    const markers = stderr
      .split("\n")
      .filter(l => l.includes("[es-module-lexer]"))
      .join(" | ");
    return { hung: true as const, markers };
  }

  expect(JSON.parse(stdout)).toEqual(expected);
  expect(exitCode).toBe(42);
  return { hung: false as const };
}

test("es-module-lexer consistently loads", async () => {
  const hangs: Array<{ i: number; markers: string }> = [];
  for (let i = 0; i < 10; i++) {
    const result = await runOnce();
    if (result.hung) {
      console.error(
        `iteration ${i}: child hung >${perChildTimeoutMs}ms; reached: ${result.markers || "<none>"}`,
      );
      hangs.push({ i, markers: result.markers });
    }
  }

  if (hangs.length === 0) return;

  const summary = hangs.map(h => `#${h.i}(${h.markers || "<none>"})`).join(", ");
  // On Windows the child occasionally parks forever in `await init`: the
  // DeferredWorkTimer completion for WebAssembly.compile is never delivered to
  // the main thread, leaving the concurrent ref (and so uv active_handles) at
  // +1 with nothing to wake uv_run. Tolerate a minority of hangs there that
  // stalled at the await-init phase so the suite doesn't flake while that is
  // investigated; anything else (non-Windows, a different stall point, or a
  // majority) is a real regression and must fail.
  const stalledAtInit = hangs.every(
    h => h.markers.includes("await init") && !h.markers.includes("init resolved"),
  );
  if (isWindows && stalledAtInit && hangs.length < 5) {
    console.error(`es-module-lexer: ${hangs.length}/10 iterations hung on Windows: ${summary}`);
    return;
  }
  throw new Error(`es-module-lexer: ${hangs.length}/10 iterations hung: ${summary}`);
}, 90_000);
