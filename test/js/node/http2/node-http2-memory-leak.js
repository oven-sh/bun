import { heapStats } from "bun:jsc";
import http2 from "http2";
import path from "path";
function getHeapStats() {
  return heapStats().objectTypeCounts.H2FrameParser;
}

const nodeExecutable = Bun.which("node");
if (!nodeExecutable) {
  process.exit(99); // 99 no node executable
}
async function nodeEchoServer() {
  const subprocess = Bun.spawn([nodeExecutable, path.join(import.meta.dir, "node-echo-server.fixture.js")], {
    stdout: "pipe",
  });
  const reader = subprocess.stdout.getReader();
  const data = await reader.read();
  const decoder = new TextDecoder("utf-8");
  const address = JSON.parse(decoder.decode(data.value));
  const url = `https://${address.family === "IPv6" ? `[${address.address}]` : address.address}:${address.port}`;
  return { address, url, subprocess };
}
const BASELINE_THRESHOLD = 1.1;
// 100 iterations should be enough to detect a leak
const ITERATIONS = 100;
// lets send a big payload
const PAYLOAD = "a".repeat(1024 * 1024);

function assertBaselineWithAVG(baseline, avg) {
  const a = Math.max(baseline, avg);
  const b = Math.min(baseline, avg);
  if (a / b > BASELINE_THRESHOLD) {
    // leak detected
    process.exit(97);
  }
}

try {
  // spin up a node local echo server
  const info = await nodeEchoServer();
  const startCount = getHeapStats();
  let averageDiff = 0;

  const startRSS = process.memoryUsage.rss();
  let baseLine = null;
  for (let j = 0; j < ITERATIONS; j++) {
    const client = http2.connect(info.url, { rejectUnauthorized: false });
    const promises = [];
    // 10 multiplex POST connections per iteration
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
      req.write(PAYLOAD);
      req.end();
      promises.push(promise);
    }
    await Promise.all(promises);
    client.close();
    // collect garbage
    Bun.gc(true);
    const endRSS = process.memoryUsage.rss();
    baseLine = endRSS - startRSS;
    averageDiff += endRSS - startRSS;
  }

  averageDiff /= ITERATIONS;
  // we use the last leak as a baseline and compare with the average of all leaks
  // if is growing more than BASELINE_THRESHOLD we consider it a leak
  assertBaselineWithAVG(baseLine, averageDiff);
  // last GC to collect all H2FrameParser objects
  Bun.gc(true);
  const endCount = getHeapStats();
  info.subprocess.kill();
  // every created H2FrameParser should be destroyed
  process.exit(endCount - startCount);
} catch (err) {
  console.log(err);
  info.subprocess.kill();
  process.exit(98); // 98 exception
}
