import { which } from "bun";
import { afterAll, describe, expect, it } from "bun:test";
import child_process from "child_process";
import { tempDirWithFiles } from "harness";

const dockerCLI = which("docker") as string;
function isDockerEnabled(): boolean {
  if (!dockerCLI) {
    return false;
  }

  try {
    const info = child_process.execSync(`${dockerCLI} info`, { stdio: "ignore" });
    return info.toString().indexOf("Server Version:") !== -1;
  } catch {
    return false;
  }
}

if (isDockerEnabled()) {
  describe("autobahn", async () => {
    const url = "ws://localhost:9001";
    const agent = encodeURIComponent("bun/1.0.0");
    let docker: child_process.ChildProcessWithoutNullStreams | null = null;
    const { promise, resolve } = Promise.withResolvers();
    // we can exclude cases by adding them to the exclude-cases array
    // "exclude-cases": [
    //   "9.*"
    // ],
    const CWD = tempDirWithFiles("autobahn", {
      "fuzzingserver.json": `{
        "url": "ws://127.0.0.1:9001",
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
        "9001:9001",
        "--name",
        "fuzzingserver",
        "crossbario/autobahn-testsuite",
      ],
      {
        cwd: CWD,
        stdout: "pipe",
        stderr: "pipe",
      },
    ) as child_process.ChildProcessWithoutNullStreams;

    let out = "";
    let pending = true;
    docker.stdout.on("data", data => {
      out += data;
      if (pending) {
        if (out.indexOf("Autobahn WebSocket") !== -1) {
          pending = false;
          resolve(true);
        }
      }
    });

    docker.on("close", code => {
      if (pending) {
        pending = false;
        resolve(false);
      }
    });
    const cases = await promise;
    if (!cases) {
      throw new Error("Autobahn WebSocket not detected");
    }

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
        socket.addEventListener("close", event => {
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
        socket.addEventListener("close", event => {
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
      const test = parseInt(info.id.split(".")[0]) > 10 ? it.todo : it;
      // tests > 10 are compression tests, which are not supported yet
      test(`Running test case ${info.id}: ${info.description}`, async () => {
        await runTestCase(i);
        const result = (await getCaseStatus(i)) as { behavior: string };
        expect(["OK", "INFORMATIONAL", "NON-STRICT"]).toContain(result.behavior);
      });
    }

    afterAll(() => {
      docker?.kill();
    });
  });
} else {
  it.todo("Autobahn WebSocket not detected");
}
