import { which } from "bun";
import { afterAll, describe, expect, it } from "bun:test";
import child_process from "child_process";
import { isLinux } from "harness";
import * as dockerCompose from "../../../docker/index.ts";

const dockerCLI = which("docker") as string;
function isDockerEnabled(): boolean {
  if (!dockerCLI) {
    return false;
  }

  // TODO: investigate why its not starting on Linux arm64
  if (isLinux && process.arch === "arm64") {
    return false;
  }

  try {
    const info = child_process.execSync(`${dockerCLI} info`, { stdio: ["ignore", "pipe", "inherit"] });
    return info.toString().indexOf("Server Version:") !== -1;
  } catch {
    return false;
  }
}

let url: string = "";
const agent = encodeURIComponent("bun/1.0.0");
async function load() {
  if (process.env.BUN_AUTOBAHN_URL) {
    url = process.env.BUN_AUTOBAHN_URL;
    return true;
  }

  // Use docker-compose to start Autobahn
  const autobahnInfo = await dockerCompose.ensure("autobahn");

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

if (isDockerEnabled() && (await load())) {
  // Prepare WebSocket options with Host header if needed
  const wsOptions = process.env.BUN_AUTOBAHN_HOST_HEADER
    ? { headers: { Host: process.env.BUN_AUTOBAHN_HOST_HEADER } }
    : undefined;

  describe("autobahn", async () => {
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

    const count = (await getTestCaseCount()) as number;
    it("should have test cases", () => {
      expect(count).toBeGreaterThan(0);
    });
    for (let i = 1; i <= count; i++) {
      const info = (await getCaseInfo(i)) as { id: string; description: string };

      it(`Running test case ${info.id}: ${info.description}`, async () => {
        await runTestCase(i);
        const result = (await getCaseStatus(i)) as { behavior: string };
        expect(result.behavior).toBeOneOf(["OK", "INFORMATIONAL", "NON-STRICT"]);
      });
    }

    afterAll(() => {
      // Container managed by docker-compose, no need to kill
    });
  });
} else {
  it.todo("Autobahn WebSocket not detected");
}
