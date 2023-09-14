import { heapStats } from "bun:jsc";

const { SERVER } = process.env;

if (typeof SERVER === "undefined" || !SERVER?.length) {
  throw new Error("SERVER environment variable is not set");
}

const COUNT = parseInt(process.env.COUNT || "200", 10);
await (async function runAll() {
  var fetches = new Array(COUNT);
  let i = 0;
  while (i < Math.max(COUNT - 32, 0)) {
    for (let j = 0; j < 32; j++) {
      fetches.push(fetch(SERVER));
    }
    await Promise.all(fetches);
    fetches.length = 0;
    i += 32;
  }

  while (i++ < COUNT) {
    fetches.push(fetch(SERVER));
  }

  await Promise.all(fetches);
  fetches.length = 0;
  fetches = [];
})();
await Bun.sleep(10);
Bun.gc(true);
if ((heapStats().objectTypeCounts.Response ?? 0) > 1 + ((COUNT / 2) | 0)) {
  throw new Error("Too many Response objects: " + heapStats().objectTypeCounts.Response);
}
