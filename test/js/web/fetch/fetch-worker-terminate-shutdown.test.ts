import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// FetchTasklet held a raw `*VirtualMachine` and read it from the HTTP thread
// (callback / derefFromThread / onWriteRequestDataDrain). When a Worker is
// terminated mid-fetch, the worker's VirtualMachine — allocated in a per-
// worker MimallocArena — is freed while those callbacks are still in flight,
// so `task.javascript_vm.isShuttingDown()` and
// `task.javascript_vm.eventLoop().enqueueTaskConcurrent()` were UAF.
// derefFromThread additionally ran full clearData() (including non-atomic
// AbortSignal::deref and jsc.Strong cleanup) on the HTTP thread.
test("Worker.terminate() while fetch with AbortSignal is in flight does not crash", async () => {
  using dir = tempDir("fetch-worker-terminate", {
    "worker.js": `
      const url = process.argv[2];
      const ctrl = new AbortController();
      // Kick off a fetch that will be in flight when the parent terminates us.
      fetch(url, { signal: ctrl.signal }).then(
        async (res) => { for await (const _ of res.body) {} },
        () => {},
      );
      // Tell the parent we've sent the request so it can terminate us.
      postMessage("fetching");
    `,
    "main.js": `
      const ITER = 20;
      const server = Bun.serve({
        port: 0,
        async fetch() {
          // Stream a slow body so the HTTP thread is mid-response when the
          // worker is terminated.
          return new Response(
            new ReadableStream({
              type: "direct",
              async pull(ctrl) {
                ctrl.write("x");
                await Bun.sleep(60_000);
                ctrl.close();
              },
            }),
          );
        },
      });
      const url = server.url.href;
      let started = 0;
      for (let i = 0; i < ITER; i++) {
        const w = new Worker("./worker.js", { argv: [url] });
        const { promise, resolve } = Promise.withResolvers();
        w.onmessage = resolve;
        w.onerror = (e) => { console.error("worker error", e.message); process.exit(1); };
        await promise;
        started++;
        await w.terminate();
      }
      console.log("PASS", started);
      server.stop(true);
      process.exit(0);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toBe("PASS 20\n");
  expect(exitCode).toBe(0);
});
