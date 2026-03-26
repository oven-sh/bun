import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Regression test: fuzzed scripts that corrupt the Buffer global (e.g. Buffer++)
// should not crash the process. This pattern caused SIGSEGV in the Fuzzilli REPRL
// loop because the protocol code used the corrupted global Buffer reference.

test("Buffer++ followed by SharedArrayBuffer operations should not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `
      function f4() { return f4; }
      const v6 = Buffer(f4);
      try { v6.writeBigInt64LE(f4); } catch (e) {}
      Buffer++;
      new Response();
      try { const v15 = new SharedArrayBuffer(); Buffer.byteLength(v15); } catch(e) {}
      const v36 = new SharedArrayBuffer(6, { maxByteLength: 1024 });
      new SharedArrayBuffer();
      new Int8Array(v36);
      Bun.gc(true);
    `],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  // Should exit with an error (Buffer.byteLength on NaN), not a crash/signal
  expect(exitCode).not.toBe(null);
  // Exit code should not be a signal (signals are typically > 128)
  expect(exitCode).toBeLessThan(128);
});

test("saved Buffer reference survives global corruption via eval", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `
      const _Buffer = Buffer;
      // Simulate what fuzzed scripts do
      (0, eval)("Buffer++");
      // The saved reference should still work
      const buf = _Buffer.alloc(4);
      buf.writeUInt32LE(42, 0);
      console.log(buf.readUInt32LE(0));
    `],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stdout.trim()).toBe("42");
  expect(exitCode).toBe(0);
});
