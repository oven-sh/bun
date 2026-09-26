import { type Socket, TCPSocketListener } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tls } from "harness";
import { WebSocket } from "ws";

const hostname = process.env.HOST || "127.0.0.1";
const port = parseInt(process.env.PORT || "0");

function makeAccept(key: string): string {
  const hasher = new Bun.CryptoHasher("sha1");
  hasher.update(key);
  hasher.update("258EAFA5-E914-47DA-95CA-C5AB0DC85B11");
  return hasher.digest("base64");
}

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

describe("WebSocket reads while a handshake listener spins the event loop", () => {
  function textFrame(text: string): Uint8Array {
    const payload = new TextEncoder().encode(text);
    return Uint8Array.from([0x81, payload.length, ...payload]);
  }

  // A raw peer that answers the upgrade request with a response head. `peer()` is the accepted socket.
  //   status: the status line after "HTTP/1.1 ". The default is the 101.
  //   glued: text frames in the same write as the head, so the client gets both from one read.
  //   splitHead: the head goes out in two writes, so the client buffers the start of it.
  function rawServer(
    options: { secure?: boolean; status?: string; glued?: readonly string[]; splitHead?: boolean } = {},
  ) {
    let accepted: Socket<{ request: string }> | undefined;
    const server = Bun.listen<{ request: string }>({
      hostname: "127.0.0.1",
      port: 0,
      tls: options.secure ? tls : undefined,
      socket: {
        open(socket) {
          socket.data = { request: "" };
        },
        data(socket, chunk) {
          if (accepted) return;
          socket.data.request += chunk.toString("latin1");
          if (!socket.data.request.includes("\r\n\r\n")) return;
          accepted = socket;
          const key = /sec-websocket-key: (.*)\r\n/i.exec(socket.data.request)![1];
          const head =
            `HTTP/1.1 ${options.status ?? "101 Switching Protocols"}\r\n` +
            "Upgrade: websocket\r\n" +
            "Connection: Upgrade\r\n" +
            `Sec-WebSocket-Accept: ${makeAccept(key)}\r\n` +
            "\r\n";
          const respond = (from: number) => {
            socket.write(Buffer.concat([Buffer.from(head.slice(from)), ...(options.glued ?? []).map(textFrame)]));
            socket.flush();
          };
          if (!options.splitHead) return respond(0);
          const first = "HTTP/1.1 ";
          socket.write(first);
          socket.flush();
          // The client shows no sign of having read `first`. 50 ms puts the rest in a later read.
          setTimeout(respond, 50, first.length);
        },
      },
    });
    return {
      url: `${options.secure ? "wss" : "ws"}://127.0.0.1:${server.port}`,
      peer: () => accepted!,
      [Symbol.dispose]: () => server.stop(true),
    };
  }

  // For a listener: the peer sends `bytes`, then this waits synchronously for `until`.
  // `expect().resolves` is not awaited on purpose. It ticks the event loop until the promise
  // settles, and it throws if the promise rejects.
  function sendAndWaitSynchronously(
    peer: Socket<{ request: string }>,
    bytes: Uint8Array | string,
    until: Promise<void>,
  ) {
    peer.write(bytes);
    peer.flush();
    expect(until).resolves.toBeUndefined();
  }

  describe.each(["ws", "wss"])("%s", protocol => {
    const secure = protocol === "wss";

    // The 101 head arrives in one read. Parsed without it, as the start of an HTTP response,
    // a frame of fewer than 9 bytes is a short read and a longer one is malformed.
    test.each([
      ["a 3-byte frame", [], "b"],
      ["a 15-byte frame", [], "after the 101"],
      ["a frame behind one that came with the 101", ["with the 101"], "after the 101"],
    ] as const)("the 'upgrade' listener of the ws package lets in %s", async (_, glued, later) => {
      using server = rawServer({ secure, glued });

      const order: string[] = [];
      const laterFrameRead = Promise.withResolvers<void>();
      const upgradeReturned = Promise.withResolvers<void>();
      const lastFrameRead = Promise.withResolvers<void>();
      const failed = Promise.withResolvers<never>();
      const ws = new WebSocket(server.url, { tls: { rejectUnauthorized: false } });
      ws.on("error", failed.reject);
      ws.on("close", code => failed.reject(new Error(`closed: ${code}`)));
      ws.on("upgrade", () => {
        order.push("upgrade");
        try {
          const until = Promise.race([laterFrameRead.promise, failed.promise]);
          sendAndWaitSynchronously(server.peer(), textFrame(later), until);
          order.push("upgrade returns");
          upgradeReturned.resolve();
        } catch (error) {
          upgradeReturned.reject(error);
        }
      });
      ws.on("open", () => order.push("open"));
      ws.on("message", data => {
        order.push(`message ${data}`);
        if (String(data) === later) laterFrameRead.resolve();
        if (String(data) === "last") lastFrameRead.resolve();
      });

      try {
        await Promise.race([upgradeReturned.promise, failed.promise]);
        // The client reads this frame after the call that dispatched 'upgrade' is over, so
        // `order` has everything that call did.
        server.peer().write(textFrame("last"));
        server.peer().flush();
        await Promise.race([lastFrameRead.promise, failed.promise]);
        expect(order).toEqual([
          "upgrade",
          "open",
          ...glued.map(text => `message ${text}`),
          `message ${later}`,
          "upgrade returns",
          "message last",
        ]);
      } finally {
        ws.close();
      }
    });

    // 'handshake' is the native event under 'upgrade'. The ws package listens once, this listener stays.
    test.each(["one read", "two reads"])(
      "'handshake' fires once when its listener lets in a frame, head in %s",
      async segmentation => {
        using server = rawServer({ secure, splitHead: segmentation === "two reads" });

        const order: string[] = [];
        const laterFrameRead = Promise.withResolvers<void>();
        const handshakeReturned = Promise.withResolvers<void>();
        const lastFrameRead = Promise.withResolvers<void>();
        const failed = Promise.withResolvers<never>();
        const ws = new globalThis.WebSocket(server.url, { tls: { rejectUnauthorized: false } });
        ws.addEventListener("error", event => failed.reject(new Error((event as ErrorEvent).message)));
        ws.addEventListener("close", event => failed.reject(new Error(`closed: ${event.code} ${event.reason}`)));
        ws.addEventListener("handshake" as any, () => {
          order.push("handshake");
          // A dispatch that repeats must not wait again.
          if (order.length > 1) return;
          try {
            const until = Promise.race([laterFrameRead.promise, failed.promise]);
            sendAndWaitSynchronously(server.peer(), textFrame("after the 101"), until);
            order.push("handshake returns");
            handshakeReturned.resolve();
          } catch (error) {
            handshakeReturned.reject(error);
          }
        });
        ws.addEventListener("open", () => order.push("open"));
        ws.addEventListener("message", event => {
          order.push(`message ${event.data}`);
          if (event.data === "after the 101") laterFrameRead.resolve();
          if (event.data === "last") lastFrameRead.resolve();
        });

        try {
          await Promise.race([handshakeReturned.promise, failed.promise]);
          // As above: `order` has everything the call that dispatched 'handshake' did.
          server.peer().write(textFrame("last"));
          server.peer().flush();
          await Promise.race([lastFrameRead.promise, failed.promise]);
          expect(order).toEqual(["handshake", "open", "message after the 101", "handshake returns", "message last"]);
        } finally {
          ws.close();
        }
      },
    );

    test("a response that is not a 101 fails for that reason when its listener lets in more bytes", async () => {
      using server = rawServer({ secure, status: "503 Service Unavailable" });

      const order: string[] = [];
      const closed = Promise.withResolvers<void>();
      const handshakeReturned = Promise.withResolvers<void>();
      const ws = new globalThis.WebSocket(server.url, { tls: { rejectUnauthorized: false } });
      ws.addEventListener("handshake" as any, () => {
        order.push("handshake");
        // A dispatch that repeats must not wait again.
        if (order.length > 1) return;
        try {
          sendAndWaitSynchronously(server.peer(), "more of the body", closed.promise);
          order.push("handshake returns");
          handshakeReturned.resolve();
        } catch (error) {
          handshakeReturned.reject(error);
        }
      });
      ws.addEventListener("open", () => order.push("open"));
      ws.addEventListener("close", event => {
        order.push(`close ${event.code} ${event.reason}`);
        closed.resolve();
        // Without a 'handshake' nothing else settles the promise that the test awaits.
        if (order[0] !== "handshake") handshakeReturned.reject(new Error(order[0]));
      });

      try {
        await handshakeReturned.promise;
        expect(order).toEqual(["handshake", "close 1002 Expected 101 status code", "handshake returns"]);
      } finally {
        ws.close();
      }
    });
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
