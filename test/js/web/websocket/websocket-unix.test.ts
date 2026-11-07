import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir, tls as tlsCert } from "harness";
import { once } from "node:events";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tls from "node:tls";
import { WebSocketServer } from "ws";
import { createPeer, response101 } from "./raw-peer";

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

  // Only an IP address in the strict form of net.isIP gets no SNI. "wss+unix:"
  // is not a special scheme, so the URL host stays as typed, and ares_inet_pton
  // reads "127.1" (as 127.1.0.0), "10" and hex as an address.
  test("wss+unix:// sends a URL host that is IP shorthand as SNI", async () => {
    const unix = sockPath("sni");
    const seen: (string | null)[] = [];
    const server = tls.createServer(tlsCert, socket => {
      socket.on("error", () => {});
      seen.push(socket.servername || null);
      socket.destroy();
    });
    server.listen(unix);
    await once(server, "listening");
    try {
      for (const host of ["127.1", "10", "0x7f000001", "127.0.0.1", "localhost"]) {
        const ws = new WebSocket(`wss+unix://${host}${unix}`, {
          tls: { rejectUnauthorized: false },
        });
        const { promise, resolve } = Promise.withResolvers<void>();
        ws.onclose = () => resolve();
        await promise;
      }
      expect(seen).toEqual(["127.1", "10", "0x7f000001", null, "localhost"]);
    } finally {
      server.close();
    }
  });

  test("wss+unix:// takes the SNI and the verified name from tls.serverName", async () => {
    const unix = sockPath("name");
    const seen: (string | null)[] = [];
    const server = tls.createServer(
      { ...tlsCert, SNICallback: (name, cb) => (seen.push(name), cb(null, undefined)) },
      socket => {
        socket.on("error", () => {});
        socket.destroy();
      },
    );
    server.listen(unix);
    await once(server, "listening");
    try {
      const errors: (string | undefined)[] = [];
      // The harness certificate is for localhost. The server disconnects the client whose handshake succeeds.
      for (const [host, serverName] of [
        ["evil.test", "localhost"],
        ["localhost", "evil.test"],
      ]) {
        const ws = new WebSocket(`wss+unix://${host}${unix}`, { tls: { ca: tlsCert.cert, serverName } });
        const { promise, resolve } = Promise.withResolvers<string | undefined>();
        ws.onerror = event => resolve((event as ErrorEvent).error?.code);
        errors.push(await promise);
      }
      expect({ seen, errors }).toEqual({
        seen: ["localhost", "evil.test"],
        errors: ["ECONNRESET", "ERR_TLS_CERT_ALTNAME_INVALID"],
      });
    } finally {
      server.close();
    }
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

describe.concurrent("WebSocket to a peer on a unix socket that is slow to read", () => {
  // More than a unix socket or a Windows named pipe has room for.
  const size = 1_000_000;

  /** A peer that reads nothing behind the request before it is told to. */
  function createSlowPeer(dir: string) {
    return createPeer({
      path: isWindows ? `\\\\.\\pipe\\bun-test-${crypto.randomUUID()}` : join(dir, "s.sock"),
      respond(connection) {
        connection.socket.pause();
        return response101(connection);
      },
    });
  }

  /** Runs `script` in a process of its own. The peer reads once the process has printed a line, or is gone. */
  async function sendFromProcess(script: string) {
    using dir = tempDir("ws-slow-peer", {});
    await using peer = await createSlowPeer(String(dir));
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: { ...bunEnv, PEER: peer.url },
      stdout: "pipe",
      stderr: "inherit",
    });
    const connection = await peer.connection();
    await proc.stdout.getReader().read();
    connection.socket.resume();
    const [frame, exitCode] = await Promise.all([connection.nextFrame(), proc.exited]);
    return { received: frame?.length, exitCode };
  }

  test("bufferedAmount counts what the peer has yet to take", async () => {
    using dir = tempDir("ws-slow-peer", {});
    await using peer = await createSlowPeer(String(dir));
    const ws = new WebSocket(peer.url);
    await once(ws, "open");
    ws.send(new Uint8Array(size));
    const buffered = ws.bufferedAmount;
    const connection = await peer.connection();
    connection.socket.resume();
    const frame = await connection.nextFrame();
    while (ws.bufferedAmount > 0) await new Promise(setImmediate);
    ws.terminate();
    expect({ isBuffered: buffered > 0, received: frame?.length }).toEqual({ isBuffered: true, received: size });
  });

  test("the message has left the process when the callback of ws.send() runs", async () => {
    const result = await sendFromProcess(`
      const ws = new (require("ws"))(process.env.PEER);
      ws.on("open", async () => {
        ws.send(new Uint8Array(${size}), () => process.exit(0));
        for (let turn = 0; turn < 5; turn++) await new Promise(setImmediate);
        console.log("waiting");
      });
    `);
    expect(result).toEqual({ received: size, exitCode: 0 });
  });

  test("the callback of a server's ws.send() hears that terminate() cut the message off", async () => {
    using dir = tempDir("ws-slow-peer", {});
    const path = isWindows ? `\\\\.\\pipe\\bun-test-${crypto.randomUUID()}` : join(String(dir), "s.sock");
    const server = http.createServer();
    const sent = Promise.withResolvers<Error | null | undefined>();
    new WebSocketServer({ server }).on("connection", ws => {
      ws.send(new Uint8Array(size), sent.resolve);
      ws.terminate();
    });
    server.listen(path);
    await once(server, "listening");
    const client = net.connect(path);
    client.pause();
    client.on("error", () => {});
    client.write(
      "GET / HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n",
    );
    expect(await sent.promise).toBeInstanceOf(Error);
    client.destroy();
    server.close();
  });

  test("terminate() does not wait for the peer to read", async () => {
    const { exitCode } = await sendFromProcess(`
      const ws = new WebSocket(process.env.PEER);
      ws.onopen = () => {
        ws.send(new Uint8Array(${size}));
        ws.terminate();
      };
    `);
    expect(exitCode).toBe(0);
  });
});

describe.skipIf(!isWindows)("WebSocket over a named pipe", () => {
  const pipePath = (name: string) => `\\\\.\\pipe\\bun.ws.${name}.${process.pid}`;

  test("ws+unix: echoes through Bun.serve({ unix })", async () => {
    const unix = pipePath("echo");
    using server = Bun.serve({
      unix,
      fetch(req, server) {
        return server.upgrade(req) ? undefined : new Response(new URL(req.url).pathname, { status: 400 });
      },
      websocket: {
        message(ws, message) {
          ws.send("echo:" + message);
        },
      },
    });
    const ws = new WebSocket(`ws+unix:${unix}:/chat`);
    const { promise, resolve, reject } = Promise.withResolvers<string>();
    ws.onopen = () => ws.send("hello");
    ws.onmessage = event => resolve(String(event.data));
    ws.onerror = reject;
    expect(await promise).toBe("echo:hello");
    ws.close();
  });

  // The server has all of the request, and answers, before the client's loop hears that its write is through.
  test("ws+unix: to a pipe that has less room than the upgrade request", async () => {
    const fixture = JSON.stringify(join(import.meta.dir, "..", "..", "node", "net", "windows-foreign-pipe-fixture.js"));
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const server = require(${fixture}).createServer({ quota: 16, outQuota: 4096 });
          async function receive(isWhole) {
            let received = "";
            while (!isWhole(received)) {
              await new Promise(setImmediate);
              // Throws once the client is gone.
              if (server.available()) received += server.text();
            }
            return received;
          }
          const ws = new WebSocket("ws+unix:" + server.name);
          ws.onopen = () => ws.send("hello");
          const request = await receive(text => text.endsWith("\\r\\n\\r\\n"));
          const key = /sec-websocket-key: (.*)\\r\\n/i.exec(request)[1] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
          const accept = new Bun.CryptoHasher("sha1").update(key).digest("base64");
          server.write(
            "HTTP/1.1 101 x\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\nSec-WebSocket-Accept: " + accept + "\\r\\n\\r\\n",
          );
          // Two bytes of header, four of mask, and the text.
          console.log((await receive(text => text.length >= 11)).length);
          process.exit(0);
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect({ stdout, exitCode }).toEqual({ stdout: "11\n", exitCode: 0 });
  });

  test.each([
    ["does not exist", "missing"],
    ["has a name that is too long to exist", Buffer.alloc(300, "n").toString()],
  ])("ws+unix: fails with ENOENT when the pipe %s", async (_, name) => {
    const ws = new WebSocket(`ws+unix:${pipePath(name)}`);
    const { promise, resolve } = Promise.withResolvers<{ error: unknown; close: number }>();
    let error: unknown;
    ws.onerror = event => (error = (event as ErrorEvent).error?.code);
    ws.onclose = event => resolve({ error, close: event.code });
    expect(await promise).toEqual({ error: "ENOENT", close: 1006 });
  });
});
