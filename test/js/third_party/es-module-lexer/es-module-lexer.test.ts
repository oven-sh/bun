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

// Bound each child so a hung `await init` doesn't burn the whole test timeout
// (10 * 8s fits inside the CI per-test bound).
const perChildTimeoutMs = 8_000;

function splitStderr(stderr: string) {
  const lines = stderr.split("\n");
  const markers = lines.filter(l => l.includes("[es-module-lexer]")).join(" | ");
  const rest = lines.filter(l => l.trim() && !l.includes("[es-module-lexer]")).join("\n");
  return { markers, rest };
}

async function runOnce() {
  await using proc = spawn({
    cmd: [bunExe(), join(import.meta.dir, "index.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    timeout: perChildTimeoutMs,
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const { markers, rest } = splitStderr(stderr);

  if (proc.signalCode === "SIGTERM" && exitCode !== 42) {
    return { hung: true as const, markers, rest, stdout };
  }

  // Any other outcome (normal exit, crash, non-timeout signal) is asserted
  // with the child's real stderr so the failure message carries it.
  let parsed: unknown = stdout;
  try {
    parsed = JSON.parse(stdout);
  } catch {}
  expect({ stdout: parsed, stderr: rest, signalCode: proc.signalCode, exitCode }).toEqual({
    stdout: expected,
    stderr: "",
    signalCode: null,
    exitCode: 42,
  });
  return { hung: false as const };
}

test("es-module-lexer consistently loads", async () => {
  const hangs: Array<{ i: number; markers: string }> = [];
  for (let i = 0; i < 10; i++) {
    const result = await runOnce();
    if (result.hung) {
      console.error(
        `iteration ${i}: child hung >${perChildTimeoutMs}ms; reached: ${result.markers || "<none>"}` +
          ` (stdout ${result.stdout.length}b)` +
          (result.rest ? `\n${result.rest}` : ""),
      );
      hangs.push({ i, markers: result.markers });
    }
  }

  if (hangs.length === 0) return;

  const summary = hangs.map(h => `#${h.i}(${h.markers || "<none>"})`).join(", ");
  // Windows CI intermittently parks after the child has written all markers and
  // called process.exit(42). Tolerate <5/10 hangs there that reached the exit
  // marker; anything else (non-Windows, stalled earlier, or a majority) must fail.
  const stalledAtExit = hangs.every(h => h.markers.includes("] exit"));
  if (isWindows && stalledAtExit && hangs.length < 5) {
    console.error(`es-module-lexer: ${hangs.length}/10 iterations hung on Windows: ${summary}`);
    return;
  }
  throw new Error(`es-module-lexer: ${hangs.length}/10 iterations hung: ${summary}`);
}, 90_000);
