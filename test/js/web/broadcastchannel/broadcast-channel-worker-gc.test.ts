import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows } from "harness";

// Debug/ASAN builds are much slower at spawning workers.
const timeout = isDebug || isASAN ? 60_000 : 10_000;

// ASAN builds unconditionally print a warning about JSC signal handlers on
// startup. Strip it so we can still assert the subprocess produced no other
// stderr output.
function filterStderr(stderr: string): string {
  return stderr
    .split(/\r?\n/)
    .filter(line => line && !line.startsWith("WARNING: ASAN interferes"))
    .join("\n");
}

// Regression test for use-after-free in BroadcastChannel global map.
// Previously, the global map stored raw BroadcastChannel* pointers. If a Worker
// created a BroadcastChannel and then terminated, a message dispatched from the
// main thread could race with the Worker's destructor and dereference a dangling
// pointer. Now the map stores ThreadSafeWeakPtr<BroadcastChannel>, so the lookup
// returns null if the channel was destroyed.
test(
  "BroadcastChannel: no UAF when posting to channel after worker terminates",
  async () => {
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

    expect(filterStderr(stderr)).toBe("");
    expect(stdout.trim()).toBe("OK");
    expect(exitCode).toBe(0);
  },
  timeout,
);

// Regression test for two additional races in BroadcastChannel:
//  (A) channelToContextIdentifier() HashMap was only locked on the worker-thread
//      reader, not on the main-thread writers (registerChannel/unregisterChannel/
//      dispatchMessageTo). A rehash on main concurrent with a worker-side get()
//      walks a freed bucket array → ASAN heap-use-after-free in WTF::HashTable.
//  (B) dispatchMessage() posted a task capturing raw `this` without a protecting
//      Ref. If the worker terminated and GC ran between posting and running the
//      task, the task dereferenced a freed BroadcastChannel.
//
// This test maximises contention: workers post messages (triggering the
// worker-thread map read in dispatchMessage) while the main thread is churning
// channel registrations (triggering HashMap rehashes) and terminating workers
// mid-dispatch (leaving queued tasks with dangling `this`).
test(
  "BroadcastChannel: concurrent register/dispatch/terminate does not race channelToContextIdentifier",
  async () => {
    const script = /* js */ `
    const workerCode = \`
      const bc = new BroadcastChannel("race-test");
      bc.onmessage = () => {};
      // Post from the worker so dispatchMessage() runs on OTHER worker threads,
      // reaching the worker-side channelToContextIdentifier().get() path.
      for (let i = 0; i < 20; i++) bc.postMessage(i);
      postMessage("ready");
    \`;
    const blobUrl = URL.createObjectURL(new Blob([workerCode], { type: "application/javascript" }));

    const mainChannel = new BroadcastChannel("race-test");
    mainChannel.onmessage = () => {};

    for (let round = 0; round < 4; round++) {
      const workers = [];
      const readyPromises = [];

      // Spawning N workers → N registerChannel() → N .add() calls on main.
      // Each worker also posts messages that fan out to all other workers,
      // each fan-out hop reads the map on a worker thread.
      for (let i = 0; i < 4; i++) {
        const worker = new Worker(blobUrl);
        const { promise, resolve } = Promise.withResolvers();
        worker.onmessage = () => resolve();
        workers.push(worker);
        readyPromises.push(promise);
      }

      // While workers are registering & cross-posting, also create and
      // immediately drop extra channels on main to force HashMap rehashes.
      const extraChannels = [];
      for (let i = 0; i < 16; i++) {
        extraChannels.push(new BroadcastChannel("race-test"));
      }
      for (const c of extraChannels) c.close();

      await Promise.all(readyPromises);

      // Terminate while dispatches are still in flight → queued postTaskTo
      // lambdas may outlive their BroadcastChannel.
      for (const worker of workers) {
        mainChannel.postMessage("x");
        worker.terminate();
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

    expect(filterStderr(stderr)).toBe("");
    expect(stdout.trim()).toBe("OK");
    expect(exitCode).toBe(0);
  },
  timeout,
);

// SEGV in TypeCastTraits<JSVMClientData>::isType reached from
// Zig::GlobalObject::visitChildrenImpl on a concurrent GC helper thread. The
// visit used `clientData(thisObject->vm())` (raw JSGlobalObject::m_vm deref)
// and `httpHeaderIdentifiers()` did an unsynchronized std::optional::emplace()
// that both the mutator and parallel marker threads could enter. Observed in
// production crash reports almost exclusively on Windows x64, strongly
// correlated with worker spawn+terminate.
//
// This stress maximises the race surface:
//   - extra ShadowRealm globals so multiple parallel marker helpers each visit
//     a distinct Zig::GlobalObject and all dereference vm.clientData
//   - continuous allocation so the concurrent collector is always active
//   - worker spawn/terminate churn for the reported correlation
//
// The race window is too narrow to trip deterministically on Linux even under
// ASAN + Malloc=1 + collectContinuously, so this test is a guard rather than
// a fail-before proof; it is the Windows CI lane that intermittently crashed
// with this signature on the unfixed build.
test(
  "GlobalObject::visitChildren does not dereference stale vm.clientData under parallel marking",
  async () => {
    const script = /* js */ `
    const workerCode = \`
      // Extra Zig::GlobalObject cells in this VM so parallel GC helper
      // threads each get one to visit and all call clientData(vm).
      const realms = [];
      for (let i = 0; i < 6; i++) { try { realms.push(new ShadowRealm()); } catch {} }

      const bc = new BroadcastChannel("clientdata-visit");
      bc.onmessage = () => {};

      // Keep the concurrent marker busy so visitChildrenImpl fires
      // repeatedly on helper threads while the mutator runs.
      const junk = [];
      for (let i = 0; i < 2000; i++) junk.push({ i, a: [i, i] });
      Bun.gc(true);
      postMessage("ready");
      for (let i = 0; i < 2000; i++) junk.push({ i });
    \`;
    const blobUrl = URL.createObjectURL(new Blob([workerCode], { type: "application/javascript" }));

    const mainChannel = new BroadcastChannel("clientdata-visit");
    mainChannel.onmessage = () => {};

    // Extra globals on the main VM too.
    const realms = [];
    for (let i = 0; i < 6; i++) { try { realms.push(new ShadowRealm()); } catch {} }

    for (let round = 0; round < 6; round++) {
      const workers = [];
      const ready = [];
      for (let i = 0; i < 4; i++) {
        const w = new Worker(blobUrl);
        const { promise, resolve, reject } = Promise.withResolvers();
        w.onmessage = () => resolve();
        w.onerror = (e) => reject(e.message ?? String(e));
        workers.push(w);
        ready.push(promise);
      }
      await Promise.all(ready);

      // Allocation pressure on main so its parallel markers are live while
      // worker VMs tear down.
      const junk = [];
      for (let i = 0; i < 3000; i++) junk.push({ a: i, b: [i] });

      for (const w of workers) {
        mainChannel.postMessage("x");
        w.terminate();
      }
      for (let i = 0; i < 3; i++) Bun.gc(true);
      junk.length = 0;
    }

    mainChannel.close();
    console.log("OK");
  `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: {
        ...bunEnv,
        BUN_JSC_numberOfGCMarkers: "8",
        // Route bmalloc/libpas to the system allocator so ASAN can see a UAF
        // on JSVMClientData instead of it being masked by the pool. Not set
        // on Windows: bmalloc's SystemHeap is unimplemented there and would
        // RELEASE_BASSERT, and Windows builds have no ASAN lane anyway.
        ...(isWindows ? {} : { Malloc: "1" }),
      },
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(filterStderr(stderr)).toBe("");
    expect(stdout.trim()).toBe("OK");
    expect(exitCode).toBe(0);
  },
  timeout,
);

test(
  "BroadcastChannel: repeated worker create/terminate stress",
  async () => {
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

    expect(filterStderr(stderr)).toBe("");
    expect(stdout.trim()).toBe("OK");
    expect(exitCode).toBe(0);
  },
  timeout,
);
