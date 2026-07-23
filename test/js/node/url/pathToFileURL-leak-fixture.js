var longPath = Buffer.alloc(1021, "Z").toString();
const isDebugBuildOfBun = globalThis?.Bun?.version?.includes("debug");
// ASAN's quarantine retains freed allocations (default 256 MB) and shadow
// memory raises the absolute RSS floor; widen the cap to avoid false positives.
const isASAN = process.execPath.includes("bun-asan");
import { pathToFileURL } from "url";
for (let i = 0; i < 1024 * (isDebugBuildOfBun ? 2 : 256); i++) {
  pathToFileURL(longPath);
}
Bun.gc(true);
const limitMB = isASAN || isDebugBuildOfBun ? 700 : 250;
const rss = (process.memoryUsage.rss() / 1024 / 1024) | 0;
console.log("RSS", rss, "MB");
if (rss > limitMB) {
  // On macOS, this was 860 MB.
  throw new Error("RSS is too high. Must be less than " + limitMB + "MB");
}
