import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// A closed ServerWebSocket retained in JS points into the server's native
// allocation; stopping and collecting the server freed it, so ws.publish()
// and ws.send() read freed memory. Found investigating #36788.
test("retained ServerWebSocket stays usable after server.stop() and GC", async () => {
  using dir = tempDir("ws-stop-retained", {
    "repro.js": `
      globalThis.retained = null;

      async function connectAndClose() {
        const serverClosed = Promise.withResolvers();
        let server = Bun.serve({
          port: 0,
          fetch(req, srv) {
            if (srv.upgrade(req)) return;
            return new Response("no");
          },
          websocket: {
            open(ws) {
              globalThis.retained = ws;
            },
            message() {},
            close() {
              serverClosed.resolve();
            },
          },
        });
        const client = new WebSocket("ws://127.0.0.1:" + server.port + "/");
        await new Promise((resolve, reject) => {
          client.onopen = resolve;
          client.onerror = reject;
        });
        const closed = new Promise(resolve => (client.onclose = resolve));
        client.close();
        await closed;
        await serverClosed.promise;
        await server.stop(true);
      }

      await connectAndClose();

      // Collect the Server wrapper: clean macrotask stacks plus allocation
      // pressure so JSC actually sweeps the wrapper. The server's native
      // teardown then runs on deferred event-loop tasks with no JS-observable
      // signal; the setTimeout ticks in this loop are what drain them.
      for (let i = 0; i < 50; i++) {
        await new Promise(resolve => setTimeout(resolve, 1));
        let garbage = [];
        for (let j = 0; j < 1000; j++) garbage.push({ x: j, s: "s" + j });
        garbage = null;
        Bun.gc(true);
      }
      // Drain the deferred teardown tasks enqueued by the final GC iteration.
      await new Promise(resolve => setTimeout(resolve, 1));
      await new Promise(resolve => setTimeout(resolve, 1));

      const ws = globalThis.retained;
      console.log(JSON.stringify([ws.readyState, ws.publish("t", "m"), ws.send("m"), ws.subscribe("t")]));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "repro.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("[3,0,0,false]");
  expect(exitCode).toBe(0);
});
