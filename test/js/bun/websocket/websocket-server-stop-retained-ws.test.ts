import type { ServerWebSocket, WebSocketHandler } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir, tls } from "harness";

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

describe.concurrent.each(["ws", "wss"] as const)("%s: server.stop(true)", scheme => {
  function listen(websocket: WebSocketHandler<undefined>) {
    return Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      ...(scheme === "wss" ? { tls } : {}),
      fetch(req, server) {
        if (server.upgrade(req)) return;
        return new Response("upgrade failed", { status: 400 });
      },
      websocket,
    });
  }

  async function connect(port: number) {
    const client = new WebSocket(`${scheme}://127.0.0.1:${port}`, { tls: { rejectUnauthorized: false } });
    const opened = Promise.withResolvers<void>();
    const closed = Promise.withResolvers<{ code: number; reason: string; wasClean: boolean; messages: string[] }>();
    const messages: string[] = [];
    client.onopen = () => opened.resolve();
    client.onmessage = event => messages.push(event.data);
    client.onclose = ({ code, reason, wasClean }) => {
      opened.reject(new Error(`closed before open: ${code}`));
      closed.resolve({ code, reason, wasClean, messages });
    };
    await opened.promise;
    return { client, closed: closed.promise };
  }

  const goingAway = { code: 1001, reason: "Server closed" };

  test("closes every WebSocket with 1001", async () => {
    const serverClosed = Promise.withResolvers<{ code: number; reason: string }>();
    const server = listen({
      message() {},
      close(ws, code, reason) {
        serverClosed.resolve({ code, reason });
      },
    });
    try {
      const { closed } = await connect(server.port!);
      await server.stop(true);
      expect({
        server: await serverClosed.promise,
        client: await closed,
        pendingWebSockets: server.pendingWebSockets,
      }).toEqual({
        server: goingAway,
        client: { ...goingAway, wasClean: true, messages: [] },
        pendingWebSockets: 0,
      });
    } finally {
      server.stop(true);
    }
  });

  test("flushes same-tick send() and publish() messages before the Close frame", async () => {
    let results: number[] = [];
    const server = listen({
      open(ws) {
        ws.subscribe("room");
      },
      message(ws) {
        results = [ws.send("sent"), ...[0, 1, 2].map(i => server.publish("room", "bye" + i))];
        server.stop(true);
      },
    });
    try {
      const a = await connect(server.port!);
      const b = await connect(server.port!);
      a.client.send("go");
      const [fromA, fromB] = await Promise.all([a.closed, b.closed]);
      expect({ results, a: fromA, b: fromB }).toEqual({
        results: [4, 4, 4, 4],
        a: { ...goingAway, wasClean: true, messages: ["sent", "bye0", "bye1", "bye2"] },
        b: { ...goingAway, wasClean: true, messages: ["bye0", "bye1", "bye2"] },
      });
    } finally {
      server.stop(true);
    }
  });

  test("closes WebSockets that an earlier stop() left open", async () => {
    const echoed = Promise.withResolvers<void>();
    const server = listen({
      message(ws, message) {
        ws.send(message);
      },
    });
    try {
      const { client, closed } = await connect(server.port!);
      const graceful = server.stop();
      client.addEventListener("message", () => echoed.resolve());
      client.send("still here");
      await echoed.promise;
      expect(server.pendingWebSockets).toBe(1);

      await Promise.all([graceful, server.stop(true)]);
      expect(await closed).toEqual({ ...goingAway, wasClean: true, messages: ["still here"] });
    } finally {
      server.stop(true);
    }
  });

  test("closes every WebSocket when a close handler terminates the others and calls stop(true) again", async () => {
    const sockets: ServerWebSocket<undefined>[] = [];
    const codes: number[] = [];
    const server = listen({
      open(ws) {
        sockets.push(ws);
      },
      message() {},
      close(ws, code) {
        if (codes.push(code) > 1) return;
        for (const other of sockets) if (other !== ws) other.terminate();
        server.stop(true);
      },
    });
    try {
      const clients = [];
      for (let i = 0; i < 4; i++) clients.push(await connect(server.port!));
      await server.stop(true);
      await Promise.all(clients.map(client => client.closed));
      expect({ codes, pendingWebSockets: server.pendingWebSockets }).toEqual({
        codes: [1001, 1006, 1006, 1006],
        pendingWebSockets: 0,
      });
    } finally {
      server.stop(true);
    }
  });
});
