import { heapStats } from "bun:jsc";
import http2 from "http2";
function getHeapStats() {
  return heapStats().objectTypeCounts.H2FrameParser;
}
try {
  const startCount = getHeapStats();
  for (let j = 0; j < 3; j++) {
    const client = http2.connect("https://httpbin.org");
    const promises = [];
    // 10 multiplex POST connections
    for (let i = 0; i < 10; i++) {
      const { promise, resolve, reject } = Promise.withResolvers();
      const req = client.request({ ":path": "/post", ":method": "POST" });
      let got_response = false;
      req.on("response", () => {
        got_response = true;
      });

      req.setEncoding("utf8");
      req.on("end", () => {
        if (got_response) {
          resolve();
        } else {
          reject(new Error("no response"));
        }
      });
      req.write(JSON.stringify({ hello: "world" }));

      req.end();
      promises.push(promise);
    }
    await Promise.all(promises);
    client.close();
  }
  // collect garbage
  await Bun.gc(true);
  const endCount = getHeapStats();
  process.exit(endCount - startCount);
} catch (err) {
  console.log(err);
  process.exit(1);
}
