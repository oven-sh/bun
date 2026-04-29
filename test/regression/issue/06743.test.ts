import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

describe.skipIf(isWindows).each(["json", "advanced"])("IPC sendHandle - mode %s", mode => {
  test("parent can send net.Socket handle to forked child", async () => {
    using dir = tempDir("ipc-sendhandle", {
      "parent.js": `
        const net = require("net");
        const { fork } = require("child_process");
        const path = require("path");

        const server = net.createServer();
        server.on("connection", (socket) => {
          const worker = fork(path.join(process.cwd(), "child.js"), [], {
            serialization: "${mode}",
          });

          worker.on("message", (message) => {
            if (message === "ready") {
              worker.send("handle-incoming", socket);
            }
          });

          worker.on("exit", () => {
            server.close(() => {});
          });
        });

        server.listen(0, () => {
          const port = server.address().port;
          const client = net.connect(port, "127.0.0.1", () => {
            client.on("data", (chunk) => {
              process.stdout.write(chunk.toString());
              client.destroy();
              process.exit(0);
            });
          });
        });

        setTimeout(() => { process.exit(2); }, 8000).unref();
      `,
      "child.js": `
        process.send("ready");
        process.on("message", (msg, sendHandle) => {
          if (sendHandle) {
            sendHandle.write("Hello from child!", () => {
              process.disconnect();
            });
          } else {
            process.stderr.write("sendHandle was undefined\\n");
            process.exit(1);
          }
        });
        setTimeout(() => { process.exit(2); }, 8000).unref();
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "parent.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe("Hello from child!");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  }, 15000);

  test("child can write to received socket after async yield", async () => {
    using dir = tempDir("ipc-sendhandle-async", {
      "parent.js": `
        const net = require("net");
        const { fork } = require("child_process");
        const path = require("path");

        const server = net.createServer();
        server.on("connection", (socket) => {
          const worker = fork(path.join(process.cwd(), "child.js"), [], {
            serialization: "${mode}",
          });

          worker.on("message", (message) => {
            if (message === "ready") {
              worker.send("handle-incoming", socket);
            }
          });

          worker.on("exit", () => {
            server.close(() => {});
          });
        });

        server.listen(0, () => {
          const port = server.address().port;
          const client = net.connect(port, "127.0.0.1", () => {
            client.on("data", (chunk) => {
              process.stdout.write(chunk.toString());
              client.destroy();
              process.exit(0);
            });
          });
        });

        setTimeout(() => { process.exit(2); }, 8000).unref();
      `,
      "child.js": `
        process.send("ready");
        process.on("message", async (msg, sendHandle) => {
          if (sendHandle) {
            // Yield to the event loop before writing — this exercises the
            // connecting=false fix in parseHandle; without it the write
            // would hang because _write defers when connecting is true.
            await new Promise(resolve => setImmediate(resolve));
            sendHandle.write("Async hello!", () => {
              process.disconnect();
            });
          } else {
            process.stderr.write("sendHandle was undefined\\n");
            process.exit(1);
          }
        });
        setTimeout(() => { process.exit(2); }, 8000).unref();
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "parent.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe("Async hello!");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  }, 15000);

  test("sendHandle is undefined when handle argument is not provided", async () => {
    using dir = tempDir("ipc-no-handle", {
      "parent.js": `
        const { fork } = require("child_process");
        const path = require("path");

        const worker = fork(path.join(process.cwd(), "child.js"), [], {
          serialization: "${mode}",
        });

        worker.on("message", (message) => {
          if (message === "ready") {
            worker.send("just-a-message");
          } else {
            process.stdout.write(message);
            worker.kill();
          }
        });

        worker.on("exit", () => {
          process.exit(0);
        });

        setTimeout(() => { process.exit(2); }, 8000).unref();
      `,
      "child.js": `
        process.send("ready");
        process.on("message", (msg, sendHandle) => {
          if (sendHandle === undefined) {
            process.send("handle-is-undefined");
          } else {
            process.send("handle-is-" + typeof sendHandle);
          }
        });
        setTimeout(() => { process.exit(2); }, 8000).unref();
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "parent.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe("handle-is-undefined");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  }, 15000);
});
