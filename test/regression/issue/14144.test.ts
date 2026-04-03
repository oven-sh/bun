import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Regression test for https://github.com/oven-sh/bun/issues/14144
// Worker messages and close events were lost when a worker called
// process.exit() immediately after postMessage(), because the parent
// event loop was unreffed too early in notifyNeedTermination().
test("worker postMessage followed by process.exit delivers all messages", async () => {
  // Run the test multiple times to catch the race condition reliably.
  // The original bug had a ~77% failure rate on release builds.
  for (let i = 0; i < 10; i++) {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const workerBody = \`
          self.postMessage({type: "start"});
          self.addEventListener("message", function(event) {
            let message = JSON.parse(event.data);
            self.postMessage({type: "finish"});
            process.exit();
          });
        \`;

        const blob = new Blob([workerBody], {type: "application/javascript"});
        const url = URL.createObjectURL(blob);
        const workersCount = 2;
        let finished = 0;
        let closed = 0;

        function checkDone() {
          if (finished === workersCount && closed === workersCount) {
            console.log("ALL_DONE");
          }
        }

        for (let i = 0; i < workersCount; i++) {
          const w = new Worker(url);
          w.addEventListener("message", (event) => {
            if (event.data.type === "finish") {
              finished++;
              checkDone();
            }
          });
          w.addEventListener("close", () => {
            closed++;
            checkDone();
          });
          w.postMessage(JSON.stringify({}));
        }
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout).toInclude("ALL_DONE");
    expect(exitCode).toBe(0);
  }
}, 30_000);
