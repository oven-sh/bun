import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Regression test for use-after-free crash when setting self.onmessage = null
// in a worker to trigger graceful shutdown.

test("setting self.onmessage = null allows worker to exit gracefully", async () => {
  using dir = tempDir("worker-onmessage-null", {
    "worker.js": `
      self.onmessage = (event) => {
        if (event.data === "ping") {
          postMessage("pong");
          // Clear onmessage to allow natural exit
          self.onmessage = null;
        }
      };
    `,
    "main.js": `
      const worker = new Worker(new URL("./worker.js", import.meta.url).href);

      worker.onmessage = (event) => {
        if (event.data === "pong") {
          console.log("received pong");
          // Remove the onmessage handler to allow main process to exit
          worker.onmessage = null;
        }
      };

      worker.onerror = (e) => {
        console.error("Worker error:", e);
        process.exit(1);
      };

      worker.postMessage("ping");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("received pong");
  expect(exitCode).toBe(0);
});

test("setting self.onmessage = null multiple times works correctly", async () => {
  using dir = tempDir("worker-onmessage-null-multi", {
    "worker.js": `
      let count = 0;

      self.onmessage = (event) => {
        count++;
        postMessage("count: " + count);

        // Set and unset onmessage multiple times
        self.onmessage = null;
        self.onmessage = (e) => {
          count++;
          postMessage("count: " + count);
          if (count >= 3) {
            self.onmessage = null;
          }
        };
      };
    `,
    "main.js": `
      const worker = new Worker(new URL("./worker.js", import.meta.url).href);

      const responses = [];
      worker.onmessage = (event) => {
        responses.push(event.data);
        if (responses.length < 3) {
          worker.postMessage("ping");
        } else {
          console.log("responses:", responses.join(", "));
          // Remove handler to allow exit
          worker.onmessage = null;
        }
      };

      worker.onerror = (e) => {
        console.error("Worker error:", e);
        process.exit(1);
      };

      worker.postMessage("ping");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("responses: count: 1, count: 2, count: 3");
  expect(exitCode).toBe(0);
});
