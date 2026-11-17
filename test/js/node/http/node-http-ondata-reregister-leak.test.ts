import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import path from "node:path";

// NodeHTTPResponse.setOnData used to take an unbalanced `this.ref()` and re-acquire the
// `body_read_ref` event-loop keep-alive when JS cleared and then re-assigned `ondata`
// after the request body had finished. No code path released either ref, so the
// NodeHTTPResponse leaked and `vm.active_tasks` never reached zero — the process hung.
test.concurrent(
  "re-registering ondata after request body completes does not leak NodeHTTPResponse",
  async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), path.join(import.meta.dir, "node-http-ondata-reregister-leak.fixture.js")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("CLOSED");
    expect(exitCode).toBe(0);
  },
  30_000,
);

// A request that declares a body holds `body_read_ref` until its last chunk. In
// each scenario the request ends without that chunk, and nothing that usually
// releases the ref runs: no abort callback and no `maybe_stop_reading_body()`.
test.concurrent(
  "a request that ends without the last chunk of its body releases body_read_ref",
  async () => {
    const script = /* js */ `
      const http = require("http");
      const net = require("net");
      const { getEventLoopStats } = require("bun:internal-for-testing");

      const activeTasks = () => getEventLoopStats().activeTasks;
      // Declares 10 bytes and sends 5.
      const incompletePost = path =>
        ["POST " + path + " HTTP/1.1", "Host: localhost", "Content-Length: 10", "", "hello"].join("\\r\\n");

      const scenarios = {
        // A pipelined dispatch returns no promise and its response is still
        // pending when the handler returns, so nothing follows the abort.
        "res.destroy() on a pipelined response": {
          request: "GET /first HTTP/1.1\\r\\nHost: localhost\\r\\n\\r\\n" + incompletePost("/second"),
          handler(req, res, state) {
            if (req.url === "/first") {
              state.first = res;
              return;
            }
            // 'socket': the response left the queue and owns the connection.
            res.on("socket", () => setImmediate(() => res.destroy()));
            state.first.end("one");
          },
        },
        // The handler's promise settles before the response ends. The close of
        // the socket then finds the request complete and skips the abort callback.
        "res.emit('close') before the client disconnects": {
          request: incompletePost("/"),
          handler(req, res, state) {
            setImmediate(() => {
              res.emit("close");
              setImmediate(() => state.client.destroy());
            });
          },
        },
      };

      // Resolves with the event loop refs that are left once the server closed.
      function run(scenario) {
        const { promise, resolve } = Promise.withResolvers();
        const { request, handler } = scenarios[scenario];
        const before = activeTasks();
        const state = {};
        const server = http.createServer((req, res) => handler(req, res, state));
        server.listen(0, "127.0.0.1", () => {
          state.client = net.connect(server.address().port, "127.0.0.1");
          state.client.on("error", () => {});
          state.client.on("data", () => {});
          state.client.on("close", () => server.close(() => resolve({ scenario, afterClose: activeTasks() - before })));
          state.client.write(request);
        });
        return promise;
      }

      (async () => {
        let held = false;
        for (const scenario of Object.keys(scenarios)) {
          const result = await run(scenario);
          console.log(JSON.stringify(result));
          held ||= result.afterClose !== 0;
        }
        // A ref that is still held keeps the process alive, so do not wait for
        // an exit that does not come.
        if (held) process.exit(1);
      })();
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ stdout, stderr, exitCode, signalCode: proc.signalCode }).toEqual({
      stdout:
        JSON.stringify({ scenario: "res.destroy() on a pipelined response", afterClose: 0 }) +
        "\n" +
        JSON.stringify({ scenario: "res.emit('close') before the client disconnects", afterClose: 0 }) +
        "\n",
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  },
  // A debug build on a busy machine takes 4.5 s here, and 8.7 s with LeakSanitizer on.
  30_000,
);
