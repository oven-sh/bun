// Spawned by spawn-stdin-pipe-fd-leak.test.ts with BUN_FEATURE_FLAG_DISABLE_MEMFD=1
// so that a Buffer `stdin` goes through the parent-side pipe writer on Linux
// too (macOS and Windows always use it). Prints how many of those writers are
// still alive after every child is gone, per scenario.
import { subprocessInternals } from "bun:internal-for-testing";

const { staticPipeWriterLiveCount } = subprocessInternals;
const N = 2;
// Larger than any pipe/socket buffer, so the writer is still mid-write when
// the child acts on its stdin.
const input = Buffer.alloc(1 << 20, 0x61);

async function leakedBy(scenario: () => Promise<void>): Promise<number> {
  const baseline = staticPipeWriterLiveCount();
  await Promise.all(Array.from({ length: N }, scenario));
  // On POSIX every writer is gone by the time its child has exited; this only
  // waits where the final write completion is delivered a few loop turns later
  // (libuv on Windows). A leaked writer stays counted no matter how long we wait.
  for (let i = 0; i < 100 && staticPipeWriterLiveCount() > baseline; i++) await Bun.sleep(10);
  return staticPipeWriterLiveCount() - baseline;
}

// The child closes its stdin without reading it, says so, and then stays alive
// until we kill it, so the parent's next write fails (EPIPE) while the child
// is still running: only the writer's own error path can clean it up, the
// child-exit path comes too late to do it.
async function writeFails() {
  const proc = Bun.spawn({
    cmd: [
      process.execPath,
      "-e",
      `const fs = require("fs"); fs.closeSync(0); fs.writeSync(1, "closed"); setInterval(() => {}, 1000);`,
    ],
    stdin: input,
    stdout: "pipe",
    stderr: "inherit",
  });
  const { value } = await proc.stdout.getReader().read();
  if (new TextDecoder().decode(value) !== "closed") throw new Error("child did not report closing its stdin");
  proc.kill();
  await proc.exited;
}

// The child reads stdin to EOF, so the writer finishes by draining.
async function writeDrains() {
  const proc = Bun.spawn({
    cmd: [process.execPath, "-e", `await Bun.stdin.bytes();`],
    stdin: input,
    stdout: "ignore",
    stderr: "inherit",
  });
  if ((await proc.exited) !== 0) throw new Error("draining child failed");
}

console.log(
  JSON.stringify({
    leakedWhenWriteFails: await leakedBy(writeFails),
    leakedWhenWriteDrains: await leakedBy(writeDrains),
  }),
);
