import { afterEach, describe, expect, it } from "bun:test";
import { once } from "node:events";
import type { Duplex } from "node:stream";
import { createWebSocketStream, WebSocket, WebSocketServer } from "ws";

const servers: WebSocketServer[] = [];
const sockets: WebSocket[] = [];

afterEach(() => {
  for (const ws of sockets.splice(0)) ws.terminate();
  for (const wss of servers.splice(0)) wss.close();
});

async function serve(handler: (ws: WebSocket) => void) {
  const wss = new WebSocketServer({ port: 0 });
  servers.push(wss);
  wss.on("connection", handler);
  await once(wss, "listening");
  return `ws://127.0.0.1:${(wss.address() as import("net").AddressInfo).port}`;
}

function connect(url: string) {
  const ws = new WebSocket(url);
  sockets.push(ws);
  return ws;
}

describe("createWebSocketStream", () => {
  it("returns a Duplex that round-trips data", async () => {
    const url = await serve(ws => {
      ws.on("message", msg => ws.send(msg));
    });

    const ws = connect(url);
    const duplex = createWebSocketStream(ws);
    expect(typeof duplex.write).toBe("function");
    expect(typeof duplex.read).toBe("function");

    const chunks: Buffer[] = [];
    duplex.on("data", chunk => chunks.push(chunk));

    await once(ws, "open");
    duplex.write("hello");

    while (chunks.length === 0) await once(duplex, "data");
    expect(Buffer.concat(chunks).toString()).toBe("hello");
  });

  it("queues writes issued before the socket opens", async () => {
    const received: string[] = [];
    const { promise, resolve } = Promise.withResolvers<void>();
    const url = await serve(ws => {
      ws.on("message", msg => {
        received.push(msg.toString());
        if (received.length === 2) resolve();
      });
    });

    const ws = connect(url);
    // readyState is CONNECTING here; _write must defer until 'open'.
    const duplex = createWebSocketStream(ws);
    duplex.write("first");
    duplex.write("second");

    await promise;
    expect(received).toEqual(["first", "second"]);
  });

  it("pushes null and emits 'end' when the WebSocket closes", async () => {
    const url = await serve(ws => {
      ws.send("bye");
      ws.close();
    });

    const ws = connect(url);
    const duplex = createWebSocketStream(ws);

    const chunks: Buffer[] = [];
    duplex.on("data", chunk => chunks.push(chunk));
    await once(duplex, "end");

    expect(Buffer.concat(chunks).toString()).toBe("bye");
  });

  it("closes the WebSocket when the stream ends", async () => {
    const serverClose = Promise.withResolvers<number>();
    const url = await serve(ws => {
      ws.on("close", code => serverClose.resolve(code));
    });

    const ws = connect(url);
    const duplex = createWebSocketStream(ws);
    const duplexClose = once(duplex, "close");
    duplex.resume();
    duplex.end();

    expect(await serverClose.promise).toBe(1000);
    await duplexClose;
    expect(duplex.destroyed).toBe(true);
  });

  it("terminates the WebSocket when the stream is destroyed", async () => {
    const serverClose = Promise.withResolvers<void>();
    const url = await serve(ws => {
      ws.on("close", () => serverClose.resolve());
    });

    const ws = connect(url);
    await once(ws, "open");
    const duplex = createWebSocketStream(ws);
    const duplexClose = once(duplex, "close");
    duplex.destroy();

    await serverClose.promise;
    await duplexClose;
    expect(ws.readyState).toBe(WebSocket.CLOSED);
  });

  it("forwards WebSocket errors to the duplex", async () => {
    // Connect to a port nothing is listening on.
    const ws = connect("ws://127.0.0.1:1");
    const duplex = createWebSocketStream(ws);

    const { promise, resolve } = Promise.withResolvers<unknown>();
    duplex.on("error", resolve);
    const err = await promise;
    expect(err).toBeTruthy();
    expect(duplex.destroyed).toBe(true);
  });

  it("passes readableObjectMode through and delivers text as strings", async () => {
    const url = await serve(ws => {
      ws.send("plain text");
    });

    const ws = connect(url);
    const duplex = createWebSocketStream(ws, { readableObjectMode: true });

    const [chunk] = await once(duplex, "data");
    expect(typeof chunk).toBe("string");
    expect(chunk).toBe("plain text");
  });

  it("wraps a server-side WebSocket", async () => {
    const { promise, resolve, reject } = Promise.withResolvers<Buffer>();
    const url = await serve(ws => {
      const duplex = createWebSocketStream(ws);
      duplex.on("error", reject);
      duplex.on("data", chunk => {
        duplex.write(Buffer.concat([Buffer.from("echo:"), chunk]));
      });
    });

    const ws = connect(url);
    await once(ws, "open");
    ws.send("ping");
    ws.on("message", msg => resolve(msg as Buffer));

    const msg = await promise;
    expect(msg.toString()).toBe("echo:ping");
  });

  it("errors the write callback when the server-side peer has closed", async () => {
    const { promise, resolve, reject } = Promise.withResolvers<unknown>();
    const url = await serve(ws => {
      const duplex = createWebSocketStream(ws);
      duplex.on("error", () => {});
      duplex.resume();
      ws.on("close", () => {
        duplex.write("too late", err => (err ? resolve(err) : reject(new Error("expected an error"))));
      });
    });

    const ws = connect(url);
    await once(ws, "open");
    ws.terminate();

    const err = await promise;
    expect((err as Error).message).toMatch(/not open/i);
  });

  it("forces objectMode and writableObjectMode to false", async () => {
    const url = await serve(() => {});
    const ws = connect(url);
    const duplex = createWebSocketStream(ws, {
      objectMode: true,
      writableObjectMode: true,
    } as unknown as import("node:stream").DuplexOptions);
    duplex.on("error", () => {});

    expect((duplex as Duplex & { _writableState: { objectMode: boolean } })._writableState.objectMode).toBe(false);
  });
});

// Previously `ws.once(event, fn)` registered the native forwarder twice
// (super.once -> this.on -> #on), so a single native event produced two
// EventEmitter emissions. createWebSocketStream depends on once("error")
// behaving like npm ws.
it("ws.once('error') fires exactly once per native error", async () => {
  const ws = new WebSocket("ws://127.0.0.1:1");
  sockets.push(ws);

  let emits = 0;
  const origEmit = ws.emit;
  ws.emit = function (ev: string, ...args: unknown[]) {
    if (ev === "error") emits++;
    return origEmit.call(this, ev, ...args);
  } as typeof ws.emit;

  const { promise, resolve } = Promise.withResolvers<void>();
  ws.once("error", () => {});
  ws.once("close", () => resolve());
  await promise;

  expect(emits).toBe(1);
});
