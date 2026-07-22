var longPath = Buffer.alloc(1021, "Z").toString();
const isDebugBuildOfBun = globalThis?.Bun?.revision?.includes("debug");
// ASAN's quarantine retains freed allocations (default 256 MB) and shadow
// memory raises the absolute RSS floor; widen the cap to avoid false positives.
// Probe the runtime (same as harness.ts) because a local `bun bd` debug build
// is ASAN-instrumented but named `bun-debug`, not `bun-asan`.
const isASAN = (() => {
  try {
    return require("bun:internal-for-testing").isASANEnabled();
  } catch {}
  return process.execPath.includes("bun-asan");
})();
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
