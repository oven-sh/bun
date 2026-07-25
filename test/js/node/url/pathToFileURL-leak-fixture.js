var longPath = Buffer.alloc(1021, "Z").toString();
const isDebugBuildOfBun = globalThis?.Bun?.revision?.includes("debug");
// ASAN's quarantine retains freed allocations (default 256 MB) and shadow
// memory raises the absolute RSS floor; widen the cap to avoid false positives.
// harness.ts sets BUN_TEST_IS_ASAN in bunEnv when the parent test process is
// ASAN-instrumented (covers both CI's `bun-asan` and local `bun bd` debug builds).
const isASAN = process.env.BUN_TEST_IS_ASAN === "1";
import { pathToFileURL } from "url";
for (let i = 0; i < 1024 * (isDebugBuildOfBun ? 32 : 256); i++) {
  pathToFileURL(longPath);
}
Bun.gc(true);
const limitMB = isASAN ? 700 : 250;
const rss = (process.memoryUsage.rss() / 1024 / 1024) | 0;
console.log("RSS", rss, "MB");
if (rss > limitMB) {
  // On macOS, this was 860 MB.
  throw new Error("RSS is too high. Must be less than " + limitMB + "MB");
}
