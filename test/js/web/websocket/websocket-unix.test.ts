import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tls as tlsCert } from "harness";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Unix domain sockets are not supported on Windows via ws+unix://
// (uSockets uses AF_UNIX which has limited support there).
describe.skipIf(isWindows)("WebSocket over unix domain socket", () => {
  function sockPath(name: string) {
    // Keep it short to stay under sun_path limits on macOS/Linux.
    return join(tmpdir(), `bun.ws.${name}.${process.pid}.${Date.now().toString(36)}.sock`);
  }

  test("ws+unix:// echoes through Bun.serve({ unix })", async () => {
    const unix = sockPath("echo");
    await using server = Bun.serve({
      unix,
      fetch(req, server) {
        if (server.upgrade(req)) return;
        return new Response("not a websocket", { status: 400 });
      },
      websocket: {
        open(ws) {
          ws.send("hello from server");
        },
        message(ws, message) {
          ws.send(message);
        },
      },
    });

    const ws = new WebSocket(`ws+unix://${unix}`);
    const received: string[] = [];
    const { promise, resolve, reject } = Promise.withResolvers<void>();

    ws.onerror = e => reject(e);
    ws.onopen = () => {
      ws.send("ping over unix");
    };
    ws.onmessage = e => {
      received.push(String(e.data));
      if (received.length === 2) {
        ws.close();
      }
    };
    ws.onclose = e => {
      resolve();
    };

    await promise;

    expect(received).toEqual(["hello from server", "ping over unix"]);
    expect(ws.url).toBe(`ws+unix://${unix}`);
  });

  test("ws+unix:// with ':path' after socket path", async () => {
    const unix = sockPath("path");
    let seenUrl = "";
    let seenHost = "";
    await using server = Bun.serve({
      unix,
      fetch(req, server) {
        seenUrl = new URL(req.url).pathname + new URL(req.url).search;
        seenHost = req.headers.get("host") ?? "";
        if (server.upgrade(req)) return;
        return new Response("not a websocket", { status: 400 });
      },
      websocket: {
        message(ws, message) {
          ws.send(`echo:${message}`);
        },
      },
    });

    const ws = new WebSocket(`ws+unix://${unix}:/api/v1/stream?x=1`);
    const { promise, resolve, reject } = Promise.withResolvers<string>();
    ws.onerror = e => reject(e);
    ws.onopen = () => ws.send("hi");
    ws.onmessage = e => {
      resolve(String(e.data));
      ws.close();
    };

    const got = await promise;
    expect(got).toBe("echo:hi");
    expect(seenUrl).toBe("/api/v1/stream?x=1");
    // Host header defaults to "localhost" over a unix socket, matching Node.
    expect(seenHost).toBe("localhost");
  });

  test("ws+unix:// sends binary data", async () => {
    const unix = sockPath("bin");
    await using server = Bun.serve({
      unix,
      fetch(req, server) {
        if (server.upgrade(req)) return;
        return new Response("no", { status: 400 });
      },
      websocket: {
        message(ws, message) {
          ws.sendBinary(message as Uint8Array);
        },
      },
    });

    const ws = new WebSocket(`ws+unix://${unix}`);
    ws.binaryType = "arraybuffer";
    const payload = new Uint8Array([1, 2, 3, 4, 5, 255]);
    const { promise, resolve, reject } = Promise.withResolvers<ArrayBuffer>();
    ws.onerror = e => reject(e);
    ws.onopen = () => ws.send(payload);
    ws.onmessage = e => {
      resolve(e.data);
      ws.close();
    };
    const got = new Uint8Array(await promise);
    expect([...got]).toEqual([...payload]);
  });

  test("ws+unix:// connection failure emits close when socket file does not exist", async () => {
    const unix = sockPath("missing");
    const ws = new WebSocket(`ws+unix://${unix}`);
    const { promise, resolve } = Promise.withResolvers<{ code: number; gotError: boolean }>();
    let gotError = false;
    ws.onerror = () => {
      gotError = true;
    };
    ws.onclose = e => resolve({ code: e.code, gotError });
    const { code, gotError: sawError } = await promise;
    expect(sawError).toBe(true);
    expect(code).toBe(1006);
  });

  test("ws+unix:// without a socket path throws SyntaxError", () => {
    expect(() => new WebSocket("ws+unix://")).toThrow(SyntaxError);
  });

  test("wss+unix:// connects to a TLS server over a unix socket", async () => {
    const unix = sockPath("tls");
    await using server = Bun.serve({
      unix,
      tls: tlsCert,
      fetch(req, server) {
        if (server.upgrade(req)) return;
        return new Response("no", { status: 400 });
      },
      websocket: {
        message(ws, message) {
          ws.send(`secure:${message}`);
        },
      },
    });

    const ws = new WebSocket(`wss+unix://${unix}`, {
      // @ts-expect-error bun extension
      tls: { rejectUnauthorized: false },
    });
    const { promise, resolve, reject } = Promise.withResolvers<string>();
    ws.onerror = e => reject(e);
    ws.onopen = () => ws.send("hello");
    ws.onmessage = e => {
      resolve(String(e.data));
      ws.close();
    };
    const got = await promise;
    expect(got).toBe("secure:hello");
  });

  test("works from a subprocess", async () => {
    const unix = sockPath("sp");
    await using server = Bun.serve({
      unix,
      fetch(req, server) {
        if (server.upgrade(req)) return;
        return new Response("no", { status: 400 });
      },
      websocket: {
        message(ws, message) {
          ws.send(`pong:${message}`);
        },
      },
    });

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const ws = new WebSocket(process.argv[1]);
          ws.onopen = () => ws.send("from-child");
          ws.onmessage = e => {
            console.log(String(e.data));
            ws.close();
          };
          ws.onerror = e => {
            console.error("error", e && e.message);
            process.exit(1);
          };
        `,
        `ws+unix://${unix}`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout.trim()).toBe("pong:from-child");
    expect(exitCode).toBe(0);
  });
});
