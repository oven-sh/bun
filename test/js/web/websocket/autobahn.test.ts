import { afterAll, beforeAll, describe, expect, it } from "bun:test";
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
  });

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

    for (const i of testCases) {
      if (i > count) continue;

      const info = (await getCaseInfo(i)) as { id: string; description: string };

      // Run test case
      await runTestCase(i);
      const result = (await getCaseStatus(i)) as { behavior: string };

      // Check result
      try {
        expect(result.behavior).toBeOneOf(["OK", "INFORMATIONAL", "NON-STRICT"]);
      } catch (e) {
        throw new Error(`Test case ${info.id} (${info.description}) failed: behavior was ${result.behavior}`);
      }
    }
  }, 300000); // 5 minute timeout

  afterAll(() => {
    // Container managed by docker-compose, no need to kill
  });
});

// last test is 13.7.18
