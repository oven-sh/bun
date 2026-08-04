var longPath = Buffer.alloc(1021, "Z").toString();
const isDebugBuildOfBun = globalThis?.Bun?.revision?.includes("debug");
// ASAN's quarantine retains freed allocations (default 256 MB) and shadow
// memory raises the absolute RSS floor; widen the cap to avoid false positives.
const isASAN = process.execPath.includes("bun-asan");
const rss =
  process.platform === "darwin" && typeof Bun.unsafe.memoryFootprint === "function"
    ? Bun.unsafe.memoryFootprint
    : process.memoryUsage.rss;
import { pathToFileURL } from "url";
for (let i = 0; i < 1024 * (isDebugBuildOfBun ? 32 : 256); i++) {
  pathToFileURL(longPath);
}
Bun.gc(true);
const limitMB = isASAN ? 700 : 250;
const rssMB = (rss() / 1024 / 1024) | 0;
console.log("RSS", rssMB, "MB");
if (rssMB > limitMB) {
  // On macOS, this was 860 MB.
  throw new Error("RSS is too high. Must be less than " + limitMB + "MB");
}
