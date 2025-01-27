import fs from "fs";
import { join } from "path";
import { tmpdirSync } from "harness";

const tmpdir = tmpdirSync();

for (let i = 0; i < 100_000; i++) {
  try {
    const signal = AbortSignal.abort();
    await fs.promises.readFile("blah", { signal });
  } catch (e) {}
  try {
    const signal = AbortSignal.abort();
    await fs.promises.writeFile("blah", "blah", { signal });
  } catch (e) {}

  // aborting later does not leak in writeFile
  const controller = new AbortController();
  const signal = controller.signal;
  const prom = fs.promises.writeFile(join(tmpdir, "blah"), "blah", { signal });
  process.nextTick(() => controller.abort());
  try {
    await prom;
  } catch (e) {}
}

Bun.gc(true);

const rss = (process.memoryUsage().rss / 1024 / 1024) | 0;
if (rss > 170) {
  throw new Error(`Memory leak detected: ${rss} MB, expected < 170 MB`);
}
