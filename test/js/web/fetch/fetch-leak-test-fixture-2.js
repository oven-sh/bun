import { heapStats } from "bun:jsc";

const { SERVER } = process.env;

if (typeof SERVER === "undefined" || !SERVER?.length) {
  throw new Error("SERVER environment variable is not set");
}

const COUNT = parseInt(process.env.COUNT || "20", 10);
var oks = 0;
await (async function runAll() {
  for (let j = 0; j < COUNT; j++) {
    oks += (await fetch(SERVER)).ok;
  }
})();

if (oks !== COUNT) {
  throw new Error("Not all requests succeeded");
}

await Bun.sleep(10);
Bun.gc(true);

if ((heapStats().objectTypeCounts.Response ?? 0) > 2) {
  throw new Error("Too many Response objects: " + heapStats().objectTypeCounts.Response);
}
