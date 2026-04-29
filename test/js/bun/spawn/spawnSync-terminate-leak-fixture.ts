// Fixture for spawnSync-terminate-leak.test.ts
//
// Each Worker posts "starting" and then blocks in Bun.spawnSync() on a child
// that sleeps for a couple of seconds. While spawnSync is blocking we
// terminate the Worker from the main thread; when the child finally exits,
// spawnMaybeSync observes the pending termination exception (either at the
// explicit hasException() check after the wait loop or at the first JS
// allocation while building the result) and returns early.
//
// Prior to the fix that early return skipped subprocess.finalize(), leaking
// the Subprocess (ref_count stuck at 1) along with its buffered stdout and
// stderr. The test asserts that every spawnSync is matched by a Subprocess
// finalize + deinit in the BUN_DEBUG_Subprocess log.

import { Worker } from "node:worker_threads";

const ITERATIONS = Number(process.env.ITERATIONS || 2);
const SLEEP_SECS = process.env.SLEEP_SECS || "2";

const workerSource = `
  const { parentPort } = require("node:worker_threads");
  parentPort.postMessage("starting");
  Bun.spawnSync({
    cmd: ["sleep", ${JSON.stringify(SLEEP_SECS)}],
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  // Unreachable once terminate() wins the race; if spawnSync somehow
  // completes before terminate() lands we just did not exercise the path
  // for this iteration, which the outer test tolerates.
  parentPort.postMessage("done");
`;

async function once(): Promise<void> {
  const worker = new Worker(workerSource, { eval: true });
  const started = Promise.withResolvers<void>();
  const exited = Promise.withResolvers<void>();
  worker.on("message", msg => {
    if (msg === "starting") started.resolve();
  });
  worker.on("error", () => started.resolve());
  worker.on("exit", () => exited.resolve());
  // Wait until the Worker is inside spawnSync so terminate()'s request is
  // pending while spawnSync is building its result.
  await started.promise;
  await worker.terminate();
  // terminate() resolves as soon as the exit notification is queued; the
  // Worker thread is still blocked in native code until the child exits.
  // Wait for the exit event so the Subprocess log lines for this iteration
  // have been emitted before we move on / the process exits.
  await exited.promise;
}

for (let i = 0; i < ITERATIONS; i++) {
  await once();
}

process.stdout.write(`spawned=${ITERATIONS}\n`);
