var longPath = Buffer.alloc(1021, "Z").toString();
const isDebugBuildOfBun = globalThis?.Bun?.revision?.includes("debug");
import { pathToFileURL } from "url";
for (let i = 0; i < 1024 * (isDebugBuildOfBun ? 32 : 256); i++) {
  pathToFileURL(longPath);
}
Bun.gc(true);
const rss = (process.memoryUsage.rss() / 1024 / 1024) | 0;
console.log("RSS", rss, "MB");
if (rss > 250) {
  // On macOS, this was 860 MB.
  throw new Error("RSS is too high. Must be less than 250MB");
}
