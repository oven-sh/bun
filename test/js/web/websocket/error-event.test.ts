import { describe, expect, test } from "bun:test";
import crypto from "node:crypto";
import net from "node:net";

test("WebSocket error event snapshot", async () => {
  const ws = new WebSocket("ws://127.0.0.1:8080");
  const { promise, resolve } = Promise.withResolvers();
  ws.onerror = error => {
    resolve(error);
  };
  const error = await promise;
  expect(error).toMatchInlineSnapshot(`ErrorEvent {
  type: "error",
  message: "WebSocket connection to 'ws://127.0.0.1:8080/' failed: Failed to connect", 
  error: [Error: WebSocket connection to 'ws://127.0.0.1:8080/' failed: Failed to connect]
}`);
  expect(Bun.inspect(error)).toMatchInlineSnapshot(`
    "ErrorEvent {
      type: "error",
      message: "WebSocket connection to 'ws://127.0.0.1:8080/' failed: Failed to connect",
      error: error: WebSocket connection to 'ws://127.0.0.1:8080/' failed: Failed to connect
    ,
    }"
  `);
});

test("ErrorEvent with no message", async () => {
  const error = new ErrorEvent("error");
  expect(error.message).toBe("");
  expect(Bun.inspect(error)).toMatchInlineSnapshot(`
    "ErrorEvent {
      type: "error",
      message: "",
      error: null,
    }"
  `);
  expect(error).toMatchInlineSnapshot(`ErrorEvent {
  type: "error",
  message: "", 
  error: null
}`);
});

// WHATWG §4 requires an error event before the close event whenever the user
// agent is required to "fail the WebSocket connection" (RFC 6455 §7.1.7).
// Node/undici and browsers all fire error for these post-open failure shapes.
describe("fires error before close on post-establishment failure", () => {
  const MAGIC = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

  async function rawWsServer(afterUpgrade: (sock: net.Socket) => void, extraHeaders = "") {
    const { promise, resolve, reject } = Promise.withResolvers<net.Server>();
    const server = net.createServer(sock => {
      let buf = "";
      let upgraded = false;
      sock.on("data", d => {
        if (upgraded) return;
        buf += d;
        if (!buf.includes("\r\n\r\n")) return;
        upgraded = true;
        const key = /Sec-WebSocket-Key: (.+)\r\n/i.exec(buf)![1];
        const accept = crypto
          .createHash("sha1")
          .update(key + MAGIC)
          .digest("base64");
        sock.write(
          "HTTP/1.1 101 Switching Protocols\r\n" +
            "Upgrade: websocket\r\n" +
            "Connection: Upgrade\r\n" +
            "Sec-WebSocket-Accept: " +
            accept +
            "\r\n" +
            extraHeaders +
            "\r\n",
        );
        afterUpgrade(sock);
      });
      sock.on("error", () => {});
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
    return promise;
  }

  async function connectAndTrace(
    server: net.Server,
    opts: { onOpen?: (ws: WebSocket) => void; protocols?: string[] } = {},
  ) {
    const address = server.address() as net.AddressInfo;
    const ws = new WebSocket(`ws://127.0.0.1:${address.port}/`, opts.protocols);
    const events: string[] = [];
    let errorMessage: string | undefined;
    const { promise, resolve } = Promise.withResolvers<void>();
    ws.onopen = () => {
      events.push("open");
      opts.onOpen?.(ws);
    };
    ws.onerror = e => {
      events.push("error");
      errorMessage = (e as ErrorEvent).message;
    };
    ws.onclose = e => {
      events.push(`close{${e.code},wasClean:${e.wasClean}}`);
      resolve();
    };
    await promise;
    await new Promise<void>(r => server.close(() => r()));
    return { events, errorMessage };
  }

  test.concurrent("socket destroyed with no close frame", async () => {
    // Destroy once we see the client's first frame (proves open fired).
    const server = await rawWsServer(sock => sock.once("data", () => sock.destroy()));
    const { events, errorMessage } = await connectAndTrace(server, { onOpen: ws => ws.send("x") });
    expect(events).toEqual(["open", "error", "close{1006,wasClean:false}"]);
    expect(errorMessage).toContain("Connection ended");
  });

  test.concurrent("RSV bit set without permessage-deflate negotiated", async () => {
    // FIN=1, RSV1=1, opcode=text, len=1, payload 'x'
    const server = await rawWsServer(sock => sock.write(Buffer.from([0xc1, 0x01, 0x78])));
    const { events } = await connectAndTrace(server);
    expect(events).toEqual(["open", "error", "close{1002,wasClean:false}"]);
  });

  test.concurrent("RSV2/RSV3 set", async () => {
    // FIN=1, RSV2=1, opcode=text, len=1, payload 'x'
    const server = await rawWsServer(sock => sock.write(Buffer.from([0xa1, 0x01, 0x78])));
    const { events } = await connectAndTrace(server);
    expect(events).toEqual(["open", "error", "close{1002,wasClean:false}"]);
  });

  test.concurrent("text frame with invalid UTF-8", async () => {
    // FIN=1, opcode=text, len=2, payload 0xc3 0x28 (invalid UTF-8 sequence)
    const server = await rawWsServer(sock => sock.write(Buffer.from([0x81, 0x02, 0xc3, 0x28])));
    const { events, errorMessage } = await connectAndTrace(server);
    expect(events).toEqual(["open", "error", "close{1007,wasClean:false}"]);
    expect(errorMessage).toContain("invalid UTF8");
  });

  test.concurrent("masked frame from server", async () => {
    // FIN=1, opcode=text, MASK=1, len=1, mask=00000000, payload 'x'
    const server = await rawWsServer(sock => sock.write(Buffer.from([0x81, 0x81, 0, 0, 0, 0, 0x78])));
    const { events } = await connectAndTrace(server);
    expect(events).toEqual(["open", "error", "close{1002,wasClean:false}"]);
  });

  test.concurrent("subprotocol mismatch (server responds with unrequested protocol)", async () => {
    const server = await rawWsServer(() => {}, "Sec-WebSocket-Protocol: not-what-you-asked\r\n");
    const { events } = await connectAndTrace(server, { protocols: ["chat"] });
    expect(events).toEqual(["error", "close{1002,wasClean:false}"]);
  });

  test.concurrent("clean close does NOT fire error", async () => {
    // FIN=1, opcode=close, len=2, code=1000
    const server = await rawWsServer(sock => sock.write(Buffer.from([0x88, 0x02, 0x03, 0xe8])));
    const { events } = await connectAndTrace(server);
    expect(events).toEqual(["open", "close{1000,wasClean:true}"]);
  });

  test.concurrent("ws.terminate() after open does NOT fire error (user-initiated, matches npm ws)", async () => {
    const server = await rawWsServer(() => {});
    const { events } = await connectAndTrace(server, { onOpen: ws => ws.terminate() });
    expect(events).toEqual(["open", "close{1006,wasClean:false}"]);
  });

  test.concurrent("handshake failure fires error then close (control, pre-establishment)", async () => {
    const { promise, resolve, reject } = Promise.withResolvers<net.Server>();
    const server = net.createServer(sock => {
      sock.on("data", () => {
        sock.write("HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\n\r\n");
        sock.end();
      });
      sock.on("error", () => {});
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
    await promise;
    const address = server.address() as net.AddressInfo;
    const ws = new WebSocket(`ws://127.0.0.1:${address.port}/`);
    const events: string[] = [];
    const done = Promise.withResolvers<void>();
    ws.onopen = () => events.push("open");
    ws.onerror = () => events.push("error");
    ws.onclose = e => {
      events.push(`close{${e.code},wasClean:${e.wasClean}}`);
      done.resolve();
    };
    await done.promise;
    await new Promise<void>(r => server.close(() => r()));
    expect(events).toEqual(["error", "close{1002,wasClean:false}"]);
  });
});
