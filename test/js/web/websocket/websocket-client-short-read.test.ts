import { TCPSocketListener } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot } from "harness";
import { WebSocket } from "ws";

const hostname = process.env.HOST || "127.0.0.1";
const port = parseInt(process.env.PORT || "0");

describe("WebSocket", () => {
  test("short read on payload length", async () => {
    let server: TCPSocketListener | undefined;
    let client: WebSocket | undefined;
    let init = false;

    try {
      server = Bun.listen({
        socket: {
          data(socket, data) {
            if (init) {
              return;
            }

            init = true;

            const frame = data.toString("utf-8");
            if (!frame.startsWith("GET")) {
              throw new Error("Invalid handshake");
            }

            const magic = /Sec-WebSocket-Key: (.*)\r\n/.exec(frame);
            if (!magic) {
              throw new Error("Missing Sec-WebSocket-Key");
            }

            const hasher = new Bun.CryptoHasher("sha1");
            hasher.update(magic[1]);
            hasher.update("258EAFA5-E914-47DA-95CA-C5AB0DC85B11");
            const accept = hasher.digest("base64");

            // Respond with a websocket handshake.
            socket.write(
              "HTTP/1.1 101 Switching Protocols\r\n" +
                "Upgrade: websocket\r\n" +
                "Connection: Upgrade\r\n" +
                `Sec-WebSocket-Accept: ${accept}\r\n` +
                "\r\n",
            );
            socket.flush();

            // Partially write a websocket text frame with an incomplete big-endian u16 length.
            socket.write(Uint8Array.from([129, 126, 0]));
            socket.flush();

            // Write the remainder of the websocket text frame.
            setTimeout(() => {
              socket.write(
                Uint8Array.from([
                  253, 123, 34, 106, 115, 111, 110, 114, 112, 99, 34, 58, 34, 50, 46, 48, 34, 44, 34, 109, 101, 116,
                  104, 111, 100, 34, 58, 34, 116, 114, 97, 110, 115, 97, 99, 116, 105, 111, 110, 78, 111, 116, 105, 102,
                  105, 99, 97, 116, 105, 111, 110, 34, 44, 34, 112, 97, 114, 97, 109, 115, 34, 58, 123, 34, 114, 101,
                  115, 117, 108, 116, 34, 58, 123, 34, 99, 111, 110, 116, 101, 120, 116, 34, 58, 123, 34, 115, 108, 111,
                  116, 34, 58, 50, 52, 57, 54, 48, 50, 49, 55, 57, 125, 44, 34, 118, 97, 108, 117, 101, 34, 58, 123, 34,
                  115, 105, 103, 110, 97, 116, 117, 114, 101, 34, 58, 34, 50, 80, 50, 120, 102, 51, 109, 85, 49, 118,
                  114, 110, 89, 99, 100, 49, 76, 105, 99, 104, 56, 69, 76, 104, 104, 88, 120, 55, 50, 111, 67, 105, 110,
                  77, 97, 81, 88, 101, 113, 106, 118, 68, 55, 111, 52, 101, 75, 77, 53, 70, 66, 51, 78, 76, 97, 104, 86,
                  55, 68, 87, 101, 81, 106, 105, 102, 98, 107, 53, 56, 75, 121, 104, 66, 119, 98, 119, 88, 49, 104, 103,
                  119, 103, 112, 112, 102, 118, 77, 71, 34, 44, 34, 115, 108, 111, 116, 34, 58, 50, 52, 57, 54, 48, 50,
                  49, 55, 57, 125, 125, 44, 34, 115, 117, 98, 115, 99, 114, 105, 112, 116, 105, 111, 110, 34, 58, 52,
                  48, 50, 56, 125, 125,
                ]),
              );
              socket.flush();
            }, 0);
          },
        },
        hostname,
        port,
      });

      const { promise, resolve } = Promise.withResolvers<string>();

      client = new WebSocket(`ws://${server.hostname}:${server.port}`);
      client.addEventListener("error", err => {
        throw new Error(err.message);
      });
      client.addEventListener("close", err => {
        if (!err.wasClean) {
          throw new Error(err.reason);
        }
      });
      client.addEventListener("message", event => resolve(event.data.toString("utf-8")));

      expect(await promise).toEqual(
        `{"jsonrpc":"2.0","method":"transactionNotification","params":{"result":{"context":{"slot":249602179},"value":{"signature":"2P2xf3mU1vrnYcd1Lich8ELhhXx72oCinMaQXeqjvD7o4eKM5FB3NLahV7DWeQjifbk58KyhBwbwX1hgwgppfvMG","slot":249602179}},"subscription":4028}}`,
      );
    } finally {
      client?.close();
      server?.stop(true);
    }
  });
});

describe("WebSocket upgrade split across reads", () => {
  function makeAccept(key: string): string {
    const hasher = new Bun.CryptoHasher("sha1");
    hasher.update(key);
    hasher.update("258EAFA5-E914-47DA-95CA-C5AB0DC85B11");
    return hasher.digest("base64");
  }

  // Unmasked binary frame with a 64-bit length header and `n` zero bytes of payload.
  function bigBinaryFrame(n: number): Uint8Array {
    const header = new Uint8Array(10);
    header[0] = 0x82; // FIN + binary
    header[1] = 127; // 64-bit length follows
    header[6] = (n >>> 24) & 0xff;
    header[7] = (n >>> 16) & 0xff;
    header[8] = (n >>> 8) & 0xff;
    header[9] = n & 0xff;
    const out = new Uint8Array(10 + n);
    out.set(header, 0);
    return out;
  }

  test("large frame pipelined after split 101 header is not counted against the header-size cap", async () => {
    // First read delivers a partial status line (ShortRead -> buffered); second
    // read delivers the rest of the 101 header plus a >16KB binary frame in one
    // segment. The header-size cap must only apply to bytes that are provably
    // header (the ShortRead accumulator), not to pipelined frame bytes.
    const PAYLOAD = 20000; // > default max_http_header_size (16384)

    using server = Bun.listen<{ buf: string; done: boolean }>({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        open(socket) {
          socket.data = { buf: "", done: false };
        },
        data(socket, chunk) {
          const st = socket.data;
          if (st.done) return;
          st.buf += chunk.toString("latin1");
          if (!st.buf.includes("\r\n\r\n")) return;
          st.done = true;
          const m = /Sec-WebSocket-Key:\s*(\S+)/i.exec(st.buf);
          if (!m) {
            socket.end();
            return;
          }
          const accept = makeAccept(m[1]);

          // First segment: partial status line -> client buffers via ShortRead.
          socket.write("HTTP/1.1 101 ");
          socket.flush();

          // Second segment: header tail + a >16KB frame, written together so
          // they arrive in the same read on the client.
          setTimeout(() => {
            const tail =
              "Switching Protocols\r\n" +
              "Upgrade: websocket\r\n" +
              "Connection: Upgrade\r\n" +
              `Sec-WebSocket-Accept: ${accept}\r\n` +
              "\r\n";
            const tailBytes = new TextEncoder().encode(tail);
            const frame = bigBinaryFrame(PAYLOAD);
            const packet = new Uint8Array(tailBytes.length + frame.length);
            packet.set(tailBytes, 0);
            packet.set(frame, tailBytes.length);
            socket.write(packet);
            socket.flush();
          }, 50);
        },
      },
    });

    const { promise, resolve, reject } = Promise.withResolvers<{ open: boolean; bytes: number }>();
    let opened = false;
    const ws = new globalThis.WebSocket(`ws://127.0.0.1:${server.port}`);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      opened = true;
    };
    ws.onmessage = ev => {
      const data = ev.data as ArrayBuffer;
      resolve({ open: opened, bytes: data.byteLength });
    };
    ws.onerror = ev => reject(new Error("ws error: " + (ev as ErrorEvent).message));
    ws.onclose = ev => {
      if (!ev.wasClean) reject(new Error(`unclean close: ${ev.code} ${ev.reason}`));
    };

    try {
      expect(await promise).toEqual({ open: true, bytes: PAYLOAD });
    } finally {
      ws.close();
    }
  });

  test("incomplete header larger than the cap is still rejected", async () => {
    // >16KB of header bytes with no terminating blank line must still fail.
    using server = Bun.listen<{ buf: string; done: boolean }>({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        open(socket) {
          socket.data = { buf: "", done: false };
        },
        data(socket, chunk) {
          const st = socket.data;
          if (st.done) return;
          st.buf += chunk.toString("latin1");
          if (!st.buf.includes("\r\n\r\n")) return;
          st.done = true;

          socket.write("HTTP/1.1 101 Switching Protocols\r\n");
          socket.flush();
          setTimeout(() => {
            // 20KB of header field bytes, no \r\n\r\n terminator.
            const pad = Buffer.alloc(20000, "a");
            socket.write(Buffer.concat([Buffer.from("X-Pad: "), pad]));
            socket.flush();
          }, 50);
        },
      },
    });

    const { promise, resolve, reject } = Promise.withResolvers<string>();
    const ws = new globalThis.WebSocket(`ws://127.0.0.1:${server.port}`);
    ws.onopen = () => reject(new Error("unexpected open"));
    ws.onerror = ev => resolve((ev as ErrorEvent).message ?? "error");
    ws.onclose = ev => {
      if (ev.wasClean) reject(new Error("unexpected clean close"));
    };

    try {
      const msg = await promise;
      expect(msg).toContain("Invalid response");
    } finally {
      ws.close();
    }
  });
});

describe("WebSocket buffered handshake data", () => {
  test("terminating the client from its open handler while handshake bytes are buffered shuts down cleanly", async () => {
    // A raw TCP "websocket server" that appends a complete text frame to the 101
    // response in the same packet, so the client buffers those bytes for a
    // deferred initial-data callback. Scenario 1 tears the client down from the
    // open handler before that callback runs; scenario 2 checks the buffered
    // bytes still arrive as a message when the client stays open.
    const script = String.raw`
      function makeAccept(key) {
        const hasher = new Bun.CryptoHasher("sha1");
        hasher.update(key);
        hasher.update("258EAFA5-E914-47DA-95CA-C5AB0DC85B11");
        return hasher.digest("base64");
      }

      function startServer(afterHandshake) {
        return Bun.listen({
          hostname: "127.0.0.1",
          port: 0,
          socket: {
            data(socket, data) {
              const request = data.toString("utf-8");
              const match = /Sec-WebSocket-Key: (.*)\r\n/.exec(request);
              if (!match) return;
              const head =
                "HTTP/1.1 101 Switching Protocols\r\n" +
                "Upgrade: websocket\r\n" +
                "Connection: Upgrade\r\n" +
                "Sec-WebSocket-Accept: " + makeAccept(match[1]) + "\r\n" +
                "\r\n";
              const headBytes = new TextEncoder().encode(head);
              // Complete 2-byte text frame ("hi") appended to the handshake
              // response in the same write.
              const frame = Uint8Array.from([0x81, 0x02, 0x68, 0x69]);
              const packet = new Uint8Array(headBytes.length + frame.length);
              packet.set(headBytes, 0);
              packet.set(frame, headBytes.length);
              socket.write(packet);
              socket.flush();
              afterHandshake(socket);
            },
          },
        });
      }

      async function scenarioTeardownFromOpen() {
        const settled = Promise.withResolvers();
        // Server ends the connection right after the handshake packet.
        const server = startServer(socket => socket.end());
        const ws = new WebSocket("ws://127.0.0.1:" + server.port);
        ws.addEventListener("open", () => {
          console.log("scenario-1 open");
          // Tear the client down synchronously while the buffered handshake
          // bytes are still waiting on their deferred callback.
          ws.terminate();
        });
        ws.addEventListener("close", () => settled.resolve());
        ws.addEventListener("error", () => settled.resolve());
        await settled.promise;
        console.log("scenario-1 settled");
        server.stop(true);
      }

      async function scenarioMessageStillDelivered() {
        const received = Promise.withResolvers();
        const server = startServer(() => {});
        const ws = new WebSocket("ws://127.0.0.1:" + server.port);
        ws.addEventListener("message", event => received.resolve(event.data));
        ws.addEventListener("error", () => received.resolve("error"));
        console.log("scenario-2 message " + (await received.promise));
        ws.close();
        server.stop(true);
      }

      scenarioTeardownFromOpen()
        .then(scenarioMessageStillDelivered)
        .then(() => {
          Bun.gc(true);
          console.log("done");
        })
        .catch(err => {
          console.log("error " + err);
          process.exit(1);
        });
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(normalizeBunSnapshot(stdout).split("\n")).toEqual([
      "scenario-1 open",
      "scenario-1 settled",
      "scenario-2 message hi",
      "done",
    ]);
    expect(exitCode).toBe(0);
  });
});
