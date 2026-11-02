import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// An accessor that a program defines on the request, the response or the socket of an exchange sees each read and store of the server.
test("own accessors on the objects of an exchange see the reads and stores of the server", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const http = require("node:http");
      const lines = [];
      process.on("uncaughtException", error => lines.push("  uncaught " + error.message));
      const steps = [
        ["req", "_readableState", "watched"],
        ["req", "_events", "watched"],
        ["req", "read", "watched"],
        ["socket", "_httpMessage", "watched"],
        ["socket", "_writableState", "watched"],
        ["socket", "_writableState", "throws"],
        ["socket", "_httpMessage", "throws"],
        ["res", "_keepAliveTimeout", "watched"],
        ["res", "_eventsCount", "watched"],
      ];
      let step;
      const server = http.createServer((req, res) => {
        const [which, key, change] = step;
        const object = { req, res, socket: req.socket }[which];
        req.on("error", error => lines.push("  the request emits 'error': " + error.message));
        lines.push(step.join(" "));
        let held = object[key];
        Object.defineProperty(object, key, {
          get() {
            if (change === "throws") throw new Error("get " + key);
            lines.push("  get");
            return held;
          },
          set(value) {
            lines.push("  set");
            held = value;
          },
          configurable: true,
          enumerable: true,
        });
        res.end("ok");
      });
      server.listen(0, "127.0.0.1", async () => {
        for (step of steps) {
          await new Promise(resolve => {
            const request = http.get({ port: server.address().port, host: "127.0.0.1", agent: false }, response => {
              response.resume();
            });
            request.on("error", () => {});
            request.on("close", () => setImmediate(resolve));
          });
        }
        console.log(lines.join("\\n").replace(/(\\n  get)+/g, all => "\\n  get x " + all.length / 6));
        process.exit(0);
      });
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim().split("\n"), stderr, exitCode }).toEqual({
    stdout: [
      "req _readableState watched",
      "  get x 18",
      "req _events watched",
      "  get x 6",
      "req read watched",
      "  get x 3",
      "socket _httpMessage watched",
      "  get x 1",
      "  set",
      "  get x 1",
      "socket _writableState watched",
      "  get x 8",
      "socket _writableState throws",
      "  uncaught get _writableState",
      "  the request emits 'error': get _writableState",
      "  uncaught get _writableState",
      "socket _httpMessage throws",
      "  uncaught get _httpMessage",
      "  uncaught get _httpMessage",
      "res _keepAliveTimeout watched",
      "res _eventsCount watched",
    ],
    stderr: "",
    exitCode: 0,
  });
});
