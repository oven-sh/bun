import { which } from "bun";
import { afterAll, describe, expect, it } from "bun:test";
import child_process from "child_process";
import { isLinux, tempDirWithFiles } from "harness";
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

let docker: child_process.ChildProcess | null = null;
let url: string = "";
const agent = encodeURIComponent("bun/1.0.0");
async function load() {
  if (process.env.BUN_AUTOBAHN_URL) {
    url = process.env.BUN_AUTOBAHN_URL;
    return true;
  }
  url = "ws://localhost:9002";

  const { promise, resolve } = Promise.withResolvers();
  // we can exclude cases by adding them to the exclude-cases array
  // "exclude-cases": [
  //   "9.*"
  // ],
  const CWD = tempDirWithFiles("autobahn", {
    "fuzzingserver.json": `{
        "url": "ws://127.0.0.1:9002",
        "outdir": "./",
        "cases": ["*"],
        "exclude-agent-cases": {}
      }`,
    "index.json": "{}",
  });

  docker = child_process.spawn(
    dockerCLI,
    [
      "run",
      "-t",
      "--rm",
      "-v",
      `${CWD}:/config`,
      "-v",
      `${CWD}:/reports`,
      "-p",
      "9002:9002",
      "--platform",
      "linux/amd64",
      "--name",
      "fuzzingserver",
      "crossbario/autobahn-testsuite",
    ],
    {
      cwd: CWD,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let out = "";
  let pending = true;
  docker.stdout?.on("data", data => {
    out += data;
    if (pending) {
      if (out.indexOf("Autobahn WebSocket") !== -1) {
        pending = false;
        resolve(true);
      }
    }
  });

  docker.on("close", () => {
    if (pending) {
      pending = false;
      resolve(false);
    }
  });
  return await promise;
}

if (isDockerEnabled() && (await load())) {
  describe("autobahn", async () => {
    function getCaseStatus(testID: number) {
      return new Promise((resolve, reject) => {
        const socket = new WebSocket(`${url}/getCaseStatus?case=${testID}&agent=${agent}`);
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
        const socket = new WebSocket(`${url}/getCaseCount`);
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
        const socket = new WebSocket(`${url}/getCaseInfo?case=${testID}`);
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
        const socket = new WebSocket(`${url}/runCase?case=${testID}&agent=${agent}`);
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
      docker?.kill();
    });
  });
} else {
  it.todo("Autobahn WebSocket not detected");
}
