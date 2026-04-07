import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Regression test for use-after-free in BroadcastChannel global map.
// Previously, the global map stored raw BroadcastChannel* pointers. If a Worker
// created a BroadcastChannel and then terminated, a message dispatched from the
// main thread could race with the Worker's destructor and dereference a dangling
// pointer. Now the map stores ThreadSafeWeakPtr<BroadcastChannel>, so the lookup
// returns null if the channel was destroyed.
test("BroadcastChannel: no UAF when posting to channel after worker terminates", async () => {
  const script = /* js */ `
    const workerCode = \`
      const bc = new BroadcastChannel("worker-gc-test");
      bc.onmessage = (e) => {
        // Keep a listener so the channel is registered.
      };
      postMessage("ready");
    \`;

    const mainChannel = new BroadcastChannel("worker-gc-test");
    let receivedCount = 0;
    mainChannel.onmessage = () => {
      receivedCount++;
    };

    const workers = [];
    const readyPromises = [];

    // Spawn multiple workers that each create a BroadcastChannel.
    for (let i = 0; i < 10; i++) {
      const worker = new Worker(
        URL.createObjectURL(new Blob([workerCode], { type: "application/javascript" }))
      );
      const { promise, resolve } = Promise.withResolvers();
      worker.onmessage = () => resolve();
      workers.push(worker);
      readyPromises.push(promise);
    }

    await Promise.all(readyPromises);

    // Terminate all workers. Their BroadcastChannel destructors will run on the
    // worker threads, potentially racing with message dispatch on the main thread.
    for (const worker of workers) {
      worker.terminate();
    }

    // Post messages while workers are being torn down. Previously, the main
    // thread's dispatchMessageTo could look up a raw pointer to a channel that
    // was being destroyed on a worker thread.
    for (let i = 0; i < 100; i++) {
      mainChannel.postMessage("hello " + i);
    }

    // Give the event loop time to process any pending dispatches.
    await new Promise(resolve => setTimeout(resolve, 100));

    // Force GC to clean up any lingering references.
    Bun.gc(true);

    // Post more messages after GC.
    for (let i = 0; i < 100; i++) {
      mainChannel.postMessage("after-gc " + i);
    }

    await new Promise(resolve => setTimeout(resolve, 50));

    mainChannel.close();
    console.log("OK");
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("OK");
  expect(exitCode).toBe(0);
});

test("BroadcastChannel: repeated worker create/terminate stress", async () => {
  const script = /* js */ `
    const workerCode = \`
      const bc = new BroadcastChannel("stress-test");
      bc.onmessage = () => {};
      postMessage("ready");
    \`;
    const blobUrl = URL.createObjectURL(new Blob([workerCode], { type: "application/javascript" }));

    const mainChannel = new BroadcastChannel("stress-test");
    mainChannel.onmessage = () => {};

    // Rapidly create and terminate workers while posting messages.
    for (let round = 0; round < 5; round++) {
      const workers = [];
      const readyPromises = [];

      for (let i = 0; i < 5; i++) {
        const worker = new Worker(blobUrl);
        const { promise, resolve } = Promise.withResolvers();
        worker.onmessage = () => resolve();
        workers.push(worker);
        readyPromises.push(promise);
      }

      await Promise.all(readyPromises);

      // Post while terminating.
      for (const worker of workers) {
        mainChannel.postMessage("msg");
        worker.terminate();
        mainChannel.postMessage("msg");
      }

      Bun.gc(true);
    }

    mainChannel.close();
    console.log("OK");
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("OK");
  expect(exitCode).toBe(0);
});
