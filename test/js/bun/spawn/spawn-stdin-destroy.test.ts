import { estimateShallowMemoryUsageOf } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, expectRssDeltaBelow, isLinux, isWindows } from "harness";
import path from "path";

test("stdin destroy after exit crash", async () => {
  let before;
  await (async () => {
    const child = Bun.spawn({
      cmd: [bunExe(), path.join(import.meta.dir, "bad-fixture.js")],
      env: bunEnv,
      stdout: "pipe",
      stdin: "pipe",
    });

    // The crash was in the first read of `child.stdin` after the exit.
    await child.exited;
    await child.stdin.write("dylan\n");
    await child.stdin.write("999\n");
    await child.stdin.flush();
    await child.stdin.end();

    async function read() {
      var out = "";
      for await (const chunk of child.stdout) {
        out += new TextDecoder().decode(chunk);
      }
      return out;
    }

    // This bug manifested as child.exited rejecting with an error code of "TODO"
    const [out, exited] = await Promise.all([read(), child.exited]);

    expect(out).toBe("");
    expect(exited).toBe(1);

    Bun.gc(true);
    await Bun.sleep(50);
  })();
  Bun.gc(true);
});

// The child never reads its stdin, so what a write does not get into the pipe
// stays in the queue of the sink. A queue that fits that payload exactly has to
// double for the next byte, and it copies the payload to do it.
describe("a write behind a large queued stdin write", () => {
  const LARGE = 8 * 1024 * 1024;

  const idleChild = () =>
    Bun.spawn({
      cmd: [bunExe(), "-e", "setInterval(() => {}, 1 << 30)"],
      stdin: "pipe",
      stdout: "ignore",
      stderr: "ignore",
      env: bunEnv,
    });

  // A queued write rejects when the test ends and the child is killed.
  const queue = (sink: Bun.FileSink, chunk: string | Uint8Array) =>
    void Promise.resolve(sink.write(chunk)).catch(() => {});

  // estimateShallowMemoryUsageOf(sink) is the sink plus the capacity of its
  // queue. A queue of twice the payload has copied it once already.
  const queuedOnce = (bytes: number) => bytes > LARGE / 2 && bytes < LARGE * 1.5;

  async function lastWrite(chunks: (string | Uint8Array)[]) {
    await using proc = idleChild();
    const last = chunks.pop()!;
    for (const chunk of chunks) queue(proc.stdin, chunk);
    const before = estimateShallowMemoryUsageOf(proc.stdin);
    queue(proc.stdin, last);
    const after = estimateShallowMemoryUsageOf(proc.stdin);
    return { queuedOnce: queuedOnce(before), grewBy: after - before };
  }

  // The Windows writer keeps the write that is in flight in a buffer of its
  // own, so the next write does not go behind it.
  test.skipIf(isWindows).each([
    ["bytes, then one byte", () => [new Uint8Array(LARGE), "x"]],
    ["bytes, then a page", () => [new Uint8Array(LARGE), new Uint8Array(4096)]],
    ["a UTF-16 string, then one byte", () => [Buffer.alloc(LARGE * 2, "a\0").toString("utf16le"), "x"]],
    ["a Latin-1 string, then one byte", () => [Buffer.alloc(LARGE - 1, "a").toString("latin1") + "\xe9", "x"]],
  ])("%s: the queue does not grow", async (_, chunks) => {
    expect(await lastWrite(chunks())).toEqual({ queuedOnce: true, grewBy: 0 });
  });

  test("one byte, bytes, then one byte: the queue does not grow", async () => {
    expect(await lastWrite(["a", new Uint8Array(LARGE), "x"])).toEqual({ queuedOnce: true, grewBy: 0 });
  });

  // The queue converts a Latin-1 string to UTF-8 in place. The last character
  // here takes one byte more than the string has.
  test("a Latin-1 string that ends in a non-ASCII character is queued once", async () => {
    await using proc = idleChild();
    queue(proc.stdin, Buffer.alloc(LARGE - 1, "a").toString("latin1") + "\xe9");
    expect(queuedOnce(estimateShallowMemoryUsageOf(proc.stdin))).toBe(true);
  });

  // The two writes again, as the peak of a process of its own. VmHWM is Linux only.
  test.skipIf(!isLinux)("one byte behind the payload does not hold the payload twice", async () => {
    const fixture = /* js */ `
      const fs = require("node:fs");
      const PAYLOAD = 32 * 1024 * 1024;
      const peakMiB = () => Number(/VmHWM:\\s+(\\d+)/.exec(fs.readFileSync("/proc/self/status", "utf8"))[1]) / 1024;
      const child = Bun.spawn({ cmd: ["sleep", "60"], stdin: "pipe", stdout: "ignore", stderr: "ignore" });
      const writes = [];
      try {
        // Zero pages are not resident, so the peak counts the copies only.
        const payload = new Uint8Array(PAYLOAD);
        const before = peakMiB();
        writes.push(child.stdin.write(payload), child.stdin.write("x"));
        console.log(JSON.stringify({ deltaMiB: peakMiB() - before }));
      } finally {
        child.kill();
        await Promise.allSettled(writes);
      }
    `;
    // One copy of 32 MiB. The second copy makes it 64.
    await expectRssDeltaBelow(["-e", fixture], { release: 45, debug: 51 });
  });
});
