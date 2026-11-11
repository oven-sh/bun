// A compiled program keeps its waiting ticks in a ring (src/js/ahead-of-time/internal/process/tick_ring.ts): a tick with one argument is one object, and no list.
// What `bun run` evaluates keeps an object and a list for each in a queue of Node's kind, at about 104 bytes a tick.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { built, spawned } from "./harness/commands";
import { test } from "./supported";

async function runBurst() {
  using folder = tempDir("the-ticks-of-a-burst", {
    "burst.cjs": `
      const { heapStats } = require("bun:jsc");
      const size = () => (Bun.gc(true), heapStats().heapSize);
      const count = 200_000;
      let ran = 0, whenHalfRan = 0;
      function tick() { if (++ran === count / 2) whenHalfRan = size(); }
      process.nextTick(async () => {
        const before = size();
        for (let i = 0; i < count; i++) process.nextTick(tick, i);
        const waiting = size();
        await new Promise(resolve => process.nextTick(resolve));
        const after = size();
        console.log(JSON.stringify({ ran, waiting: (waiting - before) / count, whenHalfRan: (whenHalfRan - before) / count, after: (after - before) / count }));
      });
    `,
  });
  const executable = join(String(folder), "burst" + (isWindows ? ".exe" : ""));
  built(
    await spawned(
      [bunExe(), "build", "--compile", "--aot", "./burst.cjs", "--outfile", executable],
      String(folder),
      bunEnv,
    ),
  );
  const { stdout, stderr, exitCode } = await spawned([executable], String(folder), bunEnv);
  expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  return JSON.parse(stdout) as { ran: number; waiting: number; whenHalfRan: number; after: number };
}
let ran: ReturnType<typeof runBurst> | undefined;
const burst = () => (ran ??= runBurst());

test("a waiting tick with one argument takes the bytes of one object, and a burst leaves nothing behind", async () => {
  const bytesATick = await burst();
  expect(bytesATick.ran).toBe(200_000);
  expect(bytesATick.waiting).toBeLessThan(95);
  expect(bytesATick.after).toBeLessThan(5);
});

test("the ticks of a burst are let go as they run: when half have run, about half of the bytes are held", async () => {
  const bytesATick = await burst();
  expect(bytesATick.ran).toBe(200_000);
  expect(bytesATick.whenHalfRan).toBeLessThan(bytesATick.waiting * 0.6);
});

// What lets the nodes go is a tick of the ring's own. It may not ride along with a chain, one tick asking for the next, and walk over the free nodes each time it runs: that was 67 times slower.
test("a chain of ticks behind a burst takes about as long as a chain alone", async () => {
  using folder = tempDir("the-ticks-of-a-burst", {
    "chain.cjs": `
      const chain = turns => new Promise(resolve => {
        let ran = 0;
        const start = performance.now();
        process.nextTick(function step() { if (++ran < turns) process.nextTick(step); else resolve(performance.now() - start); });
      });
      (async () => {
        await chain(100_000);
        const alone = await chain(100_000);
        for (let i = 0; i < 6_000; i++) process.nextTick(() => {});
        const behind = await chain(100_000);
        console.log(JSON.stringify({ alone, behind }));
      })();
    `,
  });
  const executable = join(String(folder), "chain" + (isWindows ? ".exe" : ""));
  built(
    await spawned(
      [bunExe(), "build", "--compile", "--aot", "./chain.cjs", "--outfile", executable],
      String(folder),
      bunEnv,
    ),
  );
  const { stdout, stderr, exitCode } = await spawned([executable], String(folder), bunEnv);
  expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  const { alone, behind } = JSON.parse(stdout) as { alone: number; behind: number };
  expect(behind).toBeLessThan(alone * 8 + 50);
});
