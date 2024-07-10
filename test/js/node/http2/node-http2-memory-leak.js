// This file is meant to be able to run in node and bun
const http2 = require("http2");
const { TLS_OPTIONS, nodeEchoServer } = require("./http2-helpers.cjs");
function getHeapStats() {
  if (globalThis.Bun) {
    const heapStats = require("bun:jsc").heapStats;
    return heapStats().objectTypeCounts;
  } else {
    return {
      objectTypeCounts: {
        H2FrameParser: 0,
        TLSSocket: 0,
      },
    };
  }
}
const gc = globalThis.gc || globalThis.Bun?.gc || (() => {});
const sleep = dur => new Promise(resolve => setTimeout(resolve, dur));

// X iterations should be enough to detect a leak
const ITERATIONS = 20;
// lets send a bigish payload
const PAYLOAD = Buffer.from("BUN".repeat((1024 * 128) / 3));
const MULTIPLEX = 50;

async function main() {
  let info;
  let tls;

  if (process.env.HTTP2_SERVER_INFO) {
    info = JSON.parse(process.env.HTTP2_SERVER_INFO);
  } else {
    info = await nodeEchoServer();
    console.log("Starting server", info.url);
  }

  if (process.env.HTTP2_SERVER_TLS) {
    tls = JSON.parse(process.env.HTTP2_SERVER_TLS);
  } else {
    tls = TLS_OPTIONS;
  }

  async function runRequests(iterations) {
    for (let j = 0; j < iterations; j++) {
      let client = http2.connect(info.url, tls);
      let promises = [];
      for (let i = 0; i < MULTIPLEX; i++) {
        const { promise, resolve, reject } = Promise.withResolvers();
        const req = client.request({ ":path": "/post", ":method": "POST", "x-no-echo": "1" });
        req.setEncoding("utf8");
        req.on("response", (headers, flags) => {
          req.on("data", chunk => {
            if (JSON.parse(chunk) !== PAYLOAD.length) {
              console.log("Got wrong data", chunk);
              reject(new Error("wrong data"));
              return;
            }

            resolve();
          });
        });

        req.end(PAYLOAD, err => {
          if (err) reject(err);
        });
        promises.push(promise);
      }
      try {
        await Promise.all(promises);
      } catch (e) {
        console.log(e);
      }

      try {
        client.close();
      } catch (e) {
        console.log(e);
      }
      client = null;
      promises = null;
      gc(true);
    }
  }

  try {
    const startStats = getHeapStats();

    // warm up
    await runRequests(ITERATIONS);
    await sleep(10);
    gc(true);
    // take a baseline
    const baseline = process.memoryUsage.rss();
    console.error("Initial memory usage", (baseline / 1024 / 1024) | 0, "MB");

    // run requests
    await runRequests(ITERATIONS);
    await sleep(10);
    gc(true);
    // take an end snapshot
    const end = process.memoryUsage.rss();

    const delta = end - baseline;
    const deltaMegaBytes = (delta / 1024 / 1024) | 0;
    console.error("Memory delta", deltaMegaBytes, "MB");

    // we executed 100 requests per iteration, memory usage should not go up by 10 MB
    if (deltaMegaBytes > 20) {
      console.log("Too many bodies leaked", deltaMegaBytes);
      process.exit(1);
    }

    const endStats = getHeapStats();
    info?.subprocess?.kill?.();
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
    info?.subprocess?.kill?.();
    process.exit(99); // 99 exception
  }
}

main().then(
  () => {},
  err => {
    console.error(err);
    process.exit(99);
  },
);
