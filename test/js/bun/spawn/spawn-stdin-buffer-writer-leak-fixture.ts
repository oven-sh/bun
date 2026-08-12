// Spawned by spawn-stdin-pipe-fd-leak.test.ts with BUN_FEATURE_FLAG_DISABLE_MEMFD=1
// so that a Buffer `stdin` goes through the parent-side pipe writer on Linux
// too (macOS and Windows always use it). Prints how many of those writers are
// still alive after every child is gone, per scenario.
import { subprocessInternals } from "bun:internal-for-testing";

const { staticPipeWriterLiveCount } = subprocessInternals;
const N = 2;
const isWindows = process.platform === "win32";
// Larger than any pipe/socket buffer, so the writer is still mid-write when
// the child acts on its stdin.
const input = Buffer.alloc(1 << 20, 0x61);

// Closes its stdin without reading it, says so on stdout, then stays alive
// until it is killed. (Windows has no sh; a bun child does the same there.)
const closeStdinAndWait = isWindows
  ? [
      process.execPath,
      "-e",
      `const fs = require("fs"); fs.closeSync(0); fs.writeSync(1, "closed"); setInterval(() => {}, 1000);`,
    ]
  : ["sh", "-c", "exec 0<&-; echo closed; exec sleep 30"];

// Reads its stdin to EOF and exits.
const drainStdin = isWindows
  ? [process.execPath, "-e", "await Bun.stdin.bytes();"]
  : ["sh", "-c", "exec cat >/dev/null"];

// Gives in-flight writer teardowns a bounded chance to finish. A writer that
// is freed gets freed within a few event loop turns; a leaked one is never
// freed, so on a leaking build this simply runs out and the count stays up.
async function waitForWritersToSettle(baseline: number) {
  for (let i = 0; i < 100 && staticPipeWriterLiveCount() > baseline; i++) await Bun.sleep(10);
}

async function leakedWhenWriteFails(): Promise<number> {
  const baseline = staticPipeWriterLiveCount();
  const children = Array.from({ length: N }, () =>
    Bun.spawn({ cmd: closeStdinAndWait, stdin: input, stdout: "pipe", stderr: "inherit" }),
  );
  for (const child of children) {
    const { value } = await child.stdout.getReader().read();
    if (!new TextDecoder().decode(value).startsWith("closed"))
      throw new Error("child did not report closing its stdin");
  }
  // Every child has closed its stdin and is still running, so the parent's
  // next write to each of them fails. That failure is what has to free the
  // writer; wait for it here so that the child-exit path below, which also
  // closes a writer that is still open, cannot be what cleans up.
  await waitForWritersToSettle(baseline);
  for (const child of children) child.kill();
  await Promise.all(children.map(child => child.exited));
  // Only needed where the failed write is reported asynchronously after the
  // close (libuv on Windows); on POSIX the count has already settled above.
  await waitForWritersToSettle(baseline);
  return staticPipeWriterLiveCount() - baseline;
}

async function leakedWhenWriteDrains(): Promise<number> {
  const baseline = staticPipeWriterLiveCount();
  const exits = await Promise.all(
    Array.from(
      { length: N },
      () => Bun.spawn({ cmd: drainStdin, stdin: input, stdout: "ignore", stderr: "inherit" }).exited,
    ),
  );
  if (exits.some(code => code !== 0)) throw new Error(`draining children exited with ${exits}`);
  await waitForWritersToSettle(baseline);
  return staticPipeWriterLiveCount() - baseline;
}

console.log(
  JSON.stringify({
    leakedWhenWriteFails: await leakedWhenWriteFails(),
    leakedWhenWriteDrains: await leakedWhenWriteDrains(),
  }),
);
