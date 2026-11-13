import { expect } from "bun:test";
const rss = process.memoryUsage.rss;
const url = process.env.SERVER_URL;
const maxMemoryIncrease = parseInt(process.env.MAX_MEMORY_INCREASE || "0", 10);
// One sample varies by some MiB, so the least of the last ones is held against the most of those 250 responses before.
let early = 0;
let late = Infinity;
function sample(responses) {
  // Otherwise the memory follows the collector's schedule.
  Bun.gc(true);
  const memoryUsage = rss() / 1024 / 1024;
  if (responses <= 250) early = Math.max(early, memoryUsage);
  if (responses >= 500) late = Math.min(late, memoryUsage);
}
for (let i = 0; i < 600; i++) {
  let response = await fetch(url);

  const reader = response.body.getReader();
  while (true) {
    const { done } = await reader.read();
    if (done) break;

    await Bun.sleep(1);
  }
  await Bun.sleep(1);
  if (i % 25 == 0) sample(i);
}
await Bun.sleep(1);
sample(600);
// memory should be stable after X iterations
expect(early).toBeGreaterThanOrEqual(late - maxMemoryIncrease);
console.log("done");
