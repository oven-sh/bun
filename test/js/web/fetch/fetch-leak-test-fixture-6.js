import { expect } from "bun:test";
let rssSample = 0;
const url = process.env.SERVER_URL;
const maxMemoryIncrease = parseInt(process.env.MAX_MEMORY_INCREASE || "0", 10);
for (let i = 0; i < 500; i++) {
  let response = await fetch(url);

  const reader = response.body.getReader();
  while (true) {
    const { done } = await reader.read();
    if (done) break;

    await Bun.sleep(1);
  }
  await Bun.sleep(1);
  const memoryUsage = process.memoryUsage().rss / 1024 / 1024;
  // memory should be stable after X iterations
  if (i == 250) rssSample = memoryUsage;
}
await Bun.sleep(1);
Bun.gc(true);
const memoryUsage = process.memoryUsage().rss / 1024 / 1024;
expect(rssSample).toBeGreaterThanOrEqual(memoryUsage - maxMemoryIncrease);
console.log("done");
