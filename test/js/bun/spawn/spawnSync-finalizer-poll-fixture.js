// A finalizer that runs while Bun.spawnSync() is on the stack must release its
// poll on the main loop, not on the private loop spawnSync installs for the
// call. The garbage here is what every file of a `bun test --isolate` worker
// leaves behind: the previous global's process.stdout/stderr sinks, which are
// FileSinks on a dup() of a piped stdio fd. Each holds one poll on the main
// loop until its finalizer runs.
//
// Run with stderr as a pipe. With BUN_JSC_useConcurrentGC=0 and
// BUN_JSC_sweepSynchronously=1, the collection that the spawnSync result
// buffers start sweeps, and so finalizes, right there inside the call; without
// them only some of the finalizers land inside a call.
const { getEventLoopStats } = require("bun:internal-for-testing");
const { heapStats } = require("bun:jsc");
const { spawnSync } = require("node:child_process");

const settle = () => new Promise(resolve => setImmediate(resolve));
const liveSinks = () => heapStats().objectTypeCounts.FileSink ?? 0;
const { BUN_JSC_useConcurrentGC, BUN_JSC_sweepSynchronously, ...childEnv } = process.env;

Bun.gc(true);
await settle();
const basePolls = getEventLoopStats().numPolls;
const baseSinks = liveSinks();

const sinks = 40;
for (let i = 0; i < sinks; i++) Bun.file(2).writer();
const heldPolls = getEventLoopStats().numPolls - basePolls;
if (heldPolls !== sinks) {
  console.log("PRECONDITION " + JSON.stringify({ basePolls, heldPolls, sinks }));
  process.exit(1);
}

// 2 MB of stdout per call: turning it into the result Buffer is the allocation
// that starts a collection inside spawnSync.
for (let i = 0; i < sinks; i++) {
  const result = spawnSync("/bin/sh", ["-c", "head -c 2000000 /dev/zero"], {
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 1 << 24,
    env: childEnv,
  });
  if (result.error || result.status !== 0 || result.stdout.length !== 2000000) {
    console.log("SPAWN " + JSON.stringify({ i, status: result.status, error: String(result.error) }));
    process.exit(1);
  }
}

Bun.gc(true);
await settle();
Bun.gc(true);
await settle();
const polls = getEventLoopStats().numPolls;
const sinksLeft = liveSinks() - baseSinks;
// Every sink is finalized by now. A poll count still above the baseline means
// finalizers released their polls on some other loop.
if (sinksLeft > 0 || polls !== basePolls) {
  console.log("DRIFT " + JSON.stringify({ basePolls, polls, sinksLeft }));
  process.exit(1);
}
console.log("OK");
