import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// The Zig WebWorker struct is freed on the worker thread once the worker
// exits. These tests hammer ref()/unref()/terminate() from the parent
// thread while the worker thread is tearing down, which used to read the
// freed struct (ASAN use-after-poison in WebWorker__setRef /
// WebWorker__notifyNeedTermination).

async function run(src: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "", stderr: expect.any(String), exitCode: 0 });
}

test.concurrent("Worker: ref/unref after terminate does not use-after-free", async () => {
  await run(`
    const w = new Worker("data:text/javascript,", {});
    w.terminate();
    for (let i = 0; i < 100000; i++) {
      w.unref();
      w.ref();
    }
    w.terminate();
    w.unref();
  `);
});

test.concurrent("Worker: ref/unref racing natural exit does not use-after-free", async () => {
  await run(`
    const w = new Worker("data:text/javascript,", {});
    const end = Date.now() + 2000;
    while (Date.now() < end) {
      w.unref();
      w.ref();
    }
    w.unref();
  `);
});

test.concurrent("Worker: terminate racing natural exit does not use-after-free", async () => {
  await run(`
    const w = new Worker("data:text/javascript,", {});
    const end = Date.now() + 2000;
    while (Date.now() < end) {
      w.terminate();
    }
  `);
});
