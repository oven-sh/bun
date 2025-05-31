import { expect, test } from "bun:test";

async function spawn() {
  const proc = Bun.spawn(["cat", import.meta.path], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  await proc.exited;
}

async function spawn100() {
  return Promise.all(new Array(100).fill(0).map(v => spawn()));
}

test("does not leak", async () => {
  const before = process.memoryUsage().rss;
  console.log("before", (before / 1024 / 1024).toFixed(3), "MB");
  for (let index = 0; index < 200; index++) {
    await spawn100();
    Bun.gc(true);
  }
  const after = process.memoryUsage().rss;
  console.log("after", (after / 1024 / 1024).toFixed(3), "MB");
  expect(before + after).toBeLessThan(before * 3);
}, 0);
