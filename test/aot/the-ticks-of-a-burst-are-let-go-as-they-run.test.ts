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

test.failing(
  "the ticks of a burst are let go as they run: under `bun build --compile --aot` all of them are still held when half have run, 80 of 80 bytes a tick, where `bun <file>` holds 52 of 104",
  async () => {
    const bytesATick = await burst();
    // Only this is owed: a run that does not come that far ends well, which is red.
    if (bytesATick.ran !== 200_000) return;
    expect(bytesATick.whenHalfRan).toBeLessThan(bytesATick.waiting * 0.6);
  },
);
