// https://github.com/oven-sh/bun/issues/7251
// console.log() writes directly to fd 1/2 in Bun (bypassing process.stdout), so a
// broken-pipe EPIPE was swallowed and `process.stdout.on('error', ...)` never fired,
// leaving a `setImmediate` loop running forever. Node.js routes console.log through
// process.stdout.write(), so the 'error' listener is called. Bun now forwards the
// write error from the native console writer onto process.stdout/stderr.

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

const script = (fn: "log" | "error", stream: "stdout" | "stderr") => `
  process.${stream}.on('error', (err) => {
    process.${stream === "stdout" ? "stderr" : "stdout"}.write('CODE:' + err.code + '\\n');
    process.exit(0);
  });
  function loop() {
    console.${fn}('bun');
    setImmediate(loop);
  }
  loop();
`;

// Spawn `bun -e <script>` with the chosen stdio piped, read a small prefix to let the
// child start writing, then close the pipe so subsequent writes EPIPE.
async function runWithBrokenPipe(code: string, which: "stdout" | "stderr") {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", code],
    env: bunEnv,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  // Read a little from the stream we're going to break so the child has started
  // writing, then close it so further writes fail with EPIPE.
  const target = which === "stdout" ? proc.stdout : proc.stderr;
  const other = which === "stdout" ? proc.stderr : proc.stdout;
  const reader = target.getReader();
  await reader.read();
  reader.releaseLock();
  await target.cancel();

  const [otherText, exitCode] = await Promise.all([other.text(), proc.exited]);
  return { otherText, exitCode };
}

describe.skipIf(isWindows)("issue #7251 — console.* EPIPE surfaces on process.stdout/stderr", () => {
  test("console.log → process.stdout 'error' listener fires with EPIPE", async () => {
    const { otherText, exitCode } = await runWithBrokenPipe(script("log", "stdout"), "stdout");
    expect(otherText).toContain("CODE:EPIPE");
    expect(exitCode).toBe(0);
  });

  test("console.error → process.stderr 'error' listener fires with EPIPE", async () => {
    const { otherText, exitCode } = await runWithBrokenPipe(script("error", "stderr"), "stderr");
    expect(otherText).toContain("CODE:EPIPE");
    expect(exitCode).toBe(0);
  });

  test("console.log with no 'error' listener does not throw when piped to a closed reader", async () => {
    // Node.js's console.log adds a once('error', noop) so the common `| head` case
    // without a listener completes quietly instead of throwing an uncaught exception.
    // A tight sync loop writing >64KB guarantees the pipe buffer fills and later
    // writes EPIPE; the process should still finish normally.
    const code = `
      const s = Buffer.alloc(1024, 120).toString();
      for (let i = 0; i < 2000; i++) console.log(s);
      process.stderr.write('DONE\\n');
    `;
    const { otherText, exitCode } = await runWithBrokenPipe(code, "stdout");
    expect(otherText).toContain("DONE");
    expect(exitCode).toBe(0);
  });
});
