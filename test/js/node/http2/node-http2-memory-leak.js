import { heapStats } from "bun:jsc";
import http2 from "http2";
import path from "path";
function getHeapStats() {
  return heapStats().objectTypeCounts;
}

const nodeExecutable = Bun.which("node");
if (!nodeExecutable) {
  console.log("No node executable found");
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
// X iterations should be enough to detect a leak
const ITERATIONS = 50;
// lets send a bigish payload
const PAYLOAD = Buffer.from("a".repeat(128 * 1024));

const info = await nodeEchoServer();

async function runRequests(iterations) {
  for (let j = 0; j < iterations; j++) {
    let client = http2.connect(info.url, { rejectUnauthorized: false });
    let promises = [];
    // 100 multiplex POST connections per iteration
    for (let i = 0; i < 100; i++) {
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
    client = null;
    promises = null;
    Bun.gc(true);
  }
}

try {
  const startStats = getHeapStats();

  // warm up
  await runRequests(ITERATIONS);
  await Bun.sleep(10);
  Bun.gc(true);
  // take a baseline
  const baseline = process.memoryUsage.rss();
  // run requests
  await runRequests(ITERATIONS);
  await Bun.sleep(10);
  Bun.gc(true);
  // take an end snapshot
  const end = process.memoryUsage.rss();

  const delta = end - baseline;
  const bodiesLeaked = delta / PAYLOAD.length;
  // we executed 10 requests per iteration
  if (bodiesLeaked > ITERATIONS) {
    console.log("Too many bodies leaked", bodiesLeaked);
    process.exit(1);
  }

  const endStats = getHeapStats();
  info.subprocess.kill();
  // check for H2FrameParser leaks
  const pendingH2Parsers = (endStats.H2FrameParser || 0) - (startStats.H2FrameParser || 0);
  if (pendingH2Parsers > 5) {
    console.log("Too many pending H2FrameParsers", pendingH2Parsers);
    process.exit(pendingH2Parsers);
  }
  // check for TLSSocket leaks
  const pendingTLSSockets = (endStats.TLSSocket || 0) - (startStats.TLSSocket || 0);
  if (pendingTLSSockets > 5) {
    console.log("Too many pending TLSSockets", pendingTLSSockets);
    process.exit(pendingTLSSockets);
  }
  process.exit(0);
} catch (err) {
  console.log(err);
  info.subprocess.kill();
  process.exit(99); // 99 exception
}
