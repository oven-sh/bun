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
// A Response finalizer releases its native body, so an object freed by one
// collection shows up in the next one's heap stats. Collect, yield, collect.
Bun.gc(true);
await new Promise(r => setImmediate(r));
Bun.gc(true);
// Nothing holds the COUNT responses any more. Unfixed, every one of them
// stays alive.
const responses = heapStats().objectTypeCounts.Response ?? 0;
if (responses > 5) {
  throw new Error("Too many Response objects: " + responses);
}
