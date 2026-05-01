import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// `computeHasPendingActivity` used to return `true` whenever `ipc_data` was
// non-null. Nothing ever set `ipc_data` back to `null`, so every
// `Bun.spawn({ ipc })` subprocess kept its JSRef in Strong mode for the
// lifetime of the VM — even after the child exited, the IPC socket closed,
// and `handleIPCClose` ran. That pinned the JSSubprocess plus its captured
// stdout/stderr buffers until process exit.
//
// With the fix, pending activity from IPC ends once the socket transitions
// to `.closed`, so the Subprocess becomes collectable after the child exits
// and all references are dropped.
test("Subprocess with ipc is collectable after the child exits", async () => {
  const script = /* js */ `
    let collected = 0;
    const registry = new FinalizationRegistry(() => {
      collected++;
    });

    const ITERS = 8;

    async function once() {
      const { promise, resolve } = Promise.withResolvers();
      const proc = Bun.spawn({
        cmd: [process.execPath, "-e", "process.send('hi')"],
        env: process.env,
        stdout: "ignore",
        stderr: "ignore",
        stdin: "ignore",
        ipc(message) {
          resolve(message);
        },
      });
      await promise;
      await proc.exited;
      registry.register(proc, undefined);
    }

    for (let i = 0; i < ITERS; i++) {
      await once();
    }

    // Give handleIPCClose time to run on the event loop, then collect.
    for (let i = 0; i < 60 && collected < ITERS; i++) {
      await Bun.sleep(25);
      Bun.gc(true);
    }

    console.log(JSON.stringify({ collected, iters: ITERS }));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const stderrLines = stderr
    .split("\n")
    .filter(l => l && !l.startsWith("WARNING: ASAN interferes"))
    .join("\n");
  expect(stderrLines).toBe("");
  const { collected, iters } = JSON.parse(stdout.trim());
  // Without the fix, zero Subprocess wrappers are collected because
  // `ipc_data != null` keeps the JSRef Strong forever.
  expect(collected).toBe(iters);
  expect(exitCode).toBe(0);
}, 60_000);
