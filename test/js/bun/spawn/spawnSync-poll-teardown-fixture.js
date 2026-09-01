// A FileSink on a FIFO registers a writable poll with the main loop when it is
// created. Drop the sink, request a collection, and call Bun.spawnSync: the
// collection ends inside the call, while spawnSync's private loop is installed
// as the VM's loop, and the sink's finalizer tears its poll down. The teardown
// must leave the main loop, where the poll was registered, and not the private
// loop. Run with BUN_JSC_sweepSynchronously=1 so the sweep (and with it the
// finalizer) runs as soon as the collection ends.
import { constants, mkdtempSync, openSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const { getEventLoopStats } = require("bun:internal-for-testing");

const dir = mkdtempSync(join(tmpdir(), "spawnsync-poll-teardown-"));
const fifo = join(dir, "fifo");
if (Bun.spawnSync({ cmd: ["mkfifo", fifo] }).exitCode !== 0) throw new Error("mkfifo failed");
// A non-blocking reader so that the writer side can open the FIFO.
openSync(fifo, constants.O_RDONLY | constants.O_NONBLOCK);

function leakSink() {
  Bun.file(fifo).writer().write("x");
}
const args = { cmd: ["true"] };
const baseline = getEventLoopStats().numPolls;
for (let i = 0; i < 12; i++) {
  leakSink();
  Bun.gc(false);
  Bun.spawnSync(args);
  // Collect the sink now if the collection above did not already.
  Bun.gc(true);
  const { numPolls } = getEventLoopStats();
  if (numPolls !== baseline) {
    console.log("DRIFT " + JSON.stringify({ i, baseline, numPolls }));
    process.exit(1);
  }
}
// One stray decrement leaves the private loop's poll count at 0 once the next
// child's pidfd is registered, and that spawnSync never observes the exit.
// BUN_FEATURE_FLAG_DISABLE_SPAWNSYNC_FAST_PATH=1 makes this pipe-less call take
// the private-loop path, as every spawnSync under `bun test` does.
const result = Bun.spawnSync({ cmd: ["true"], stdout: "ignore", stderr: "ignore", stdin: "ignore" });
console.log(result.exitCode === 0 ? "OK" : "exit " + result.exitCode);
