import { beforeAll, describe, expect, it } from "bun:test";
import { isDockerEnabled } from "harness";
import * as dockerCompose from "../../../docker/index.ts";

let url: string = "";
const agent = encodeURIComponent("bun/1.0.0");
async function load() {
  if (process.env.BUN_AUTOBAHN_URL) {
    url = process.env.BUN_AUTOBAHN_URL;
    return true;
  }

  console.log("Loading Autobahn via docker-compose...");
  // Use docker-compose to start Autobahn
  const autobahnInfo = await dockerCompose.ensure("autobahn");
  console.log("Autobahn info:", autobahnInfo);

  // Autobahn expects port 9002 in the Host header, but we might be on a different port
  const actualPort = autobahnInfo.ports[9002];
  url = `ws://${autobahnInfo.host}:${actualPort}`;

  // If we're on a different port, we'll need to pass a Host header
  if (actualPort !== 9002) {
    // Store for later use in WebSocket connections
    process.env.BUN_AUTOBAHN_HOST_HEADER = `${autobahnInfo.host}:9002`;
  }

  return true;
}

describe.skipIf(!isDockerEnabled())("autobahn", () => {
  let wsOptions: any;

  beforeAll(async () => {
    if (!(await load())) {
      throw new Error("Failed to load Autobahn");
    }

    console.log("URL after load:", url);

    // Prepare WebSocket options with Host header if needed
    wsOptions = process.env.BUN_AUTOBAHN_HOST_HEADER
      ? { headers: { Host: process.env.BUN_AUTOBAHN_HOST_HEADER } }
      : undefined;
    // Cold container start is bounded by `compose up --wait-timeout 180` plus
    // a `compose build` step; the default 5s hook timeout fires long before
    // that on a cold cache.
  }, 240_000);

  function getCaseStatus(testID: number) {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(`${url}/getCaseStatus?case=${testID}&agent=${agent}`, wsOptions);
      socket.binaryType = "arraybuffer";

      socket.addEventListener("message", event => {
        resolve(JSON.parse(event.data as string));
      });
      socket.addEventListener("error", event => {
        reject(event);
      });
    });
  }

  function getTestCaseCount() {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(`${url}/getCaseCount`, wsOptions);
      let count: number | null = null;
      socket.addEventListener("message", event => {
        count = parseInt(event.data as string, 10);
      });
      socket.addEventListener("close", () => {
        if (!count) {
          reject("No test count received");
        }
        resolve(count);
      });
    });
  }

  function getCaseInfo(testID: number) {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(`${url}/getCaseInfo?case=${testID}`, wsOptions);
      socket.binaryType = "arraybuffer";

      socket.addEventListener("message", event => {
        resolve(JSON.parse(event.data as string));
      });
      socket.addEventListener("error", event => {
        reject(event);
      });
    });
  }

  function runTestCase(testID: number) {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(`${url}/runCase?case=${testID}&agent=${agent}`, wsOptions);
      socket.binaryType = "arraybuffer";

      socket.addEventListener("message", event => {
        socket.send(event.data);
      });
      socket.addEventListener("close", () => {
        resolve(undefined);
      });
      socket.addEventListener("error", event => {
        reject(event);
      });
    });
  }

  it("should run Autobahn test cases", async () => {
    const count = (await getTestCaseCount()) as number;
    expect(count).toBeGreaterThan(0);

    // In CI, run a subset of tests to avoid timeout
    // Run first 50 tests plus some from each category
    const testCases = process.env.CI
      ? [...Array(50).keys()].map(i => i + 1).concat([100, 200, 300, 400, 500, count])
      : Array.from({ length: count }, (_, i) => i + 1);

    console.log(`Running ${testCases.length} of ${count} test cases`);

    // Each case runs on its own WebSocket connection and the fuzzingserver
    // stores results per (agent, case) pair, so cases are independent and can
    // overlap. The Twisted reactor is single-threaded but yields while a case
    // waits for the client echo or a closeAfter/killAfter timer, so a bounded
    // fan-out overlaps those waits instead of paying them serially.
    const concurrency = 16;
    const failures: { case: number; behavior: string }[] = [];
    let cursor = 0;
    async function worker() {
      while (true) {
        const idx = cursor++;
        if (idx >= testCases.length) return;
        const i = testCases[idx];
        if (i > count) continue;

        await runTestCase(i);
        const result = (await getCaseStatus(i)) as { behavior: string };
        if (!["OK", "INFORMATIONAL", "NON-STRICT"].includes(result.behavior)) {
          failures.push({ case: i, behavior: result.behavior });
        }
      }
    }
    await Promise.all(Array.from({ length: concurrency }, worker));

    failures.sort((a, b) => a.case - b.case);
    if (failures.length > 0) {
      // getCaseInfo is only needed for the failure message; fetching it
      // lazily skips one WebSocket round trip per case on the happy path.
      await Promise.all(
        failures.map(async f => {
          try {
            Object.assign(f, (await getCaseInfo(f.case)) as { id: string; description: string });
          } catch {}
        }),
      );
    }
    // Surface every failing case at once instead of only the first, and keep
    // the per-case OK / NON-STRICT / FAILED behavior in the diff output.
    expect(failures).toEqual([]);
  }, 300000); // 5 minute timeout
});

// last test is 13.7.18
