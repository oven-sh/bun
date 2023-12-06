import { heapStats } from "bun:jsc";

const { SERVER } = process.env;

if (typeof SERVER === "undefined" || !SERVER?.length) {
  throw new Error("SERVER environment variable is not set");
}

const COUNT = parseInt(process.env.COUNT || "50", 10);
var oks = 0;
var textLength = 0;
Bun.gc(true);
const baseline = await (async function runAll() {
  const resp = await fetch(SERVER);
  textLength = Number(resp.headers.get("Content-Length"));
  if (!textLength) {
    throw new Error("Content-Length header is not set");
  }
  const clone = resp.clone().clone();
  const clone2 = resp.clone();
  (await clone.arrayBuffer()).byteLength;
  (await resp.arrayBuffer()).byteLength;
  (await Bun.readableStreamToArrayBuffer(clone2.body)).byteLength;
  return process.memoryUsage.rss();
})();

Bun.gc(true);

for (let j = 0; j < COUNT; j++) {
  await (async function runAll() {
    const res = await fetch(SERVER);
    const clone = res.clone().clone();
    const clone2 = res.clone();
    oks +=
      !!(await clone.arrayBuffer())?.byteLength && !!(await Bun.readableStreamToArrayBuffer(clone2.body))?.byteLength;
    await res.arrayBuffer();
  })();
}

if (oks !== COUNT) {
  throw new Error("Not all requests succeeded");
}

await Bun.sleep(10);
Bun.gc(true);
const delta = process.memoryUsage.rss() - baseline;
if ((heapStats().objectTypeCounts.Response ?? 0) > 5) {
  throw new Error("Too many Response objects: " + heapStats().objectTypeCounts.Response);
}

const bodiesLeakedPerRequest = delta / textLength;

const threshold = textLength > 1024 * 1024 * 2 ? 10 : 1000;

console.log({ delta, count: COUNT, bodySize: textLength, bodiesLeakedPerRequest, threshold });

if (bodiesLeakedPerRequest > threshold) {
  console.log("\n--fail--\n");
  process.exit(1);
} else {
  console.log("\n--pass--\n");
}
