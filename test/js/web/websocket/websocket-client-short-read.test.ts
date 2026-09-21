import { type Socket, TCPSocketListener } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tls } from "harness";
import { deflateRawSync } from "node:zlib";
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

// A `message`, `ping` or `pong` listener can tick the event loop before it
// returns: `expect(promise).resolves` waits synchronously in bun:test, and so
// does a `Bun.build` call with an async plugin. A read for the same socket that
// arrives in there re-enters the frame parser of the client, and every read on
// the event loop reuses the buffer that holds the rest of the interrupted read.
describe("WebSocket reads while a listener spins the event loop", () => {
  const CONTINUATION = 0x0;
  const TEXT = 0x1;
  const CLOSE = 0x8;
  const PING = 0x9;
  const PONG = 0xa;

  // One unmasked server-to-client frame.
  function frame(opcode: number, payload: string | Uint8Array, { fin = true, rsv1 = false } = {}): Buffer {
    const body = Buffer.from(payload);
    const length = body.length < 126 ? [body.length] : [126, body.length >> 8, body.length & 0xff];
    return Buffer.concat([Buffer.from([(fin ? 0x80 : 0) | (rsv1 ? 0x40 : 0) | opcode, ...length]), body]);
  }

  // The masked client-to-server frames in `bytes`, each with a payload under 126 bytes.
  function clientFrames(bytes: Buffer): { opcode: number; payload: string }[] {
    const frames: { opcode: number; payload: string }[] = [];
    for (let at = 0; at + 6 <= bytes.length; ) {
      const length = bytes[at + 1] & 0x7f;
      if (at + 6 + length > bytes.length) break;
      const mask = bytes.subarray(at + 2, at + 6);
      const payload = Buffer.from(bytes.subarray(at + 6, at + 6 + length).map((byte, i) => byte ^ mask[i % 4]));
      frames.push({ opcode: bytes[at] & 0x0f, payload: payload.toString() });
      at += 6 + length;
    }
    return frames;
  }

  // A raw peer that answers the upgrade. `socket` is the accepted connection,
  // once the 101 is written. `onData` gets what the client sends after that.
  function rawPeer({ secure = false, deflate = false } = {}) {
    const accepted = Promise.withResolvers<Socket>();
    let request = "";
    let upgraded = false;
    const server = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      tls: secure ? tls : undefined,
      socket: {
        data(socket, chunk) {
          if (upgraded) return peer.onData(chunk);
          request += chunk.toString("latin1");
          if (!request.includes("\r\n\r\n")) return;
          upgraded = true;
          const key = /sec-websocket-key: (.*)\r\n/i.exec(request)![1];
          const accept = new Bun.CryptoHasher("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11");
          socket.write(
            "HTTP/1.1 101 Switching Protocols\r\n" +
              "Upgrade: websocket\r\n" +
              "Connection: Upgrade\r\n" +
              `Sec-WebSocket-Accept: ${accept.digest("base64")}\r\n` +
              (deflate ? "Sec-WebSocket-Extensions: permessage-deflate\r\n" : "") +
              "\r\n",
          );
          socket.flush();
          accepted.resolve(socket);
        },
        // A client that fails the connection resets it.
        error() {},
      },
    });
    const peer = {
      url: `${secure ? "wss" : "ws"}://127.0.0.1:${server.port}`,
      socket: accepted.promise,
      onData: (_chunk: Buffer) => {},
      [Symbol.dispose]: () => server.stop(true),
    };
    return peer;
  }

  // Connects to `peer` and logs one entry per event. `logged(count)` settles when
  // the log has `count` entries. It also settles when the connection has ended and
  // no listener is in `spinUntil`, because then nothing more can come.
  async function connect(peer: ReturnType<typeof rawPeer>) {
    const log: string[] = [];
    const waiters: { met: () => boolean; resolve: () => void }[] = [];
    let ended = false;
    let spinning = 0;
    const settle = () => {
      for (const waiter of waiters) if (waiter.met()) waiter.resolve();
    };
    const record = (entry: string) => {
      log.push(entry);
      settle();
    };
    const end = (entry: string) => {
      ended = true;
      record(entry);
    };
    const when = (met: () => boolean) => {
      const { promise, resolve } = Promise.withResolvers<void>();
      waiters.push({ met, resolve });
      settle();
      return promise;
    };
    const logged = (count: number) => when(() => log.length >= count || (ended && spinning === 0));
    // Ticks the event loop inside the listener that calls it, until one of `entries`
    // is in the log or the connection has ended. The test timeout cannot interrupt a
    // synchronous wait, so a timer bounds it.
    const spinUntil = (...entries: string[]) => {
      const timer = setTimeout(end, 5000, `gave up the wait for ${JSON.stringify(entries)}`);
      spinning++;
      expect(when(() => ended || entries.some(entry => log.includes(entry)))).resolves.toBeUndefined();
      spinning--;
      clearTimeout(timer);
      settle();
    };

    const ws = new globalThis.WebSocket(peer.url, { tls: { rejectUnauthorized: false } });
    ws.binaryType = "arraybuffer";
    ws.addEventListener("open", () => record("open"));
    ws.addEventListener("message", event => record(`message ${event.data}`));
    ws.addEventListener("ping", event => record(`ping ${Buffer.from(event.data)}`));
    ws.addEventListener("error", event => record(`error ${(event as ErrorEvent).message}`));
    ws.addEventListener("close", event => end(`close ${event.code}${event.reason && ": " + event.reason}`));
    await logged(1);
    const socket = await peer.socket;
    const send = (...frames: Uint8Array[]) => {
      socket.write(Buffer.concat(frames));
      socket.flush();
    };
    return { ws, log, record, logged, spinUntil, send };
  }

  describe.each(["ws", "wss"])("%s", protocol => {
    const secure = protocol === "wss";

    // An empty message is dispatched from the step that parses the frame header.
    test.each(["a", ""])("the frame behind message %j is delivered before the frames of a later read", async first => {
      using peer = rawPeer({ secure });
      const { ws, log, record, logged, spinUntil, send } = await connect(peer);
      try {
        ws.addEventListener("message", event => {
          if (event.data !== first) return;
          send(frame(TEXT, "c"));
          spinUntil("message c");
          record("its listener returns");
        });
        // One write, so that one read brings both frames.
        send(frame(TEXT, first), frame(TEXT, "b"));
        await logged(5);
        expect(log).toEqual(["open", `message ${first}`, "message b", "message c", "its listener returns"]);
      } finally {
        ws.terminate();
      }
    });

    test("a frame split between the interrupted read and a later read arrives whole", async () => {
      using peer = rawPeer({ secure });
      const { ws, log, record, logged, spinUntil, send } = await connect(peer);
      const b = Buffer.alloc(300, "b").toString();
      const frameB = frame(TEXT, b);
      try {
        ws.addEventListener("message", event => {
          if (event.data !== "a") return;
          send(frameB.subarray(100), frame(TEXT, "c"));
          spinUntil("message c");
          record("the listener of a returns");
        });
        send(frame(TEXT, "a"), frameB.subarray(0, 100));
        await logged(5);
        expect(log).toEqual(["open", "message a", `message ${b}`, "message c", "the listener of a returns"]);
      } finally {
        ws.terminate();
      }
    });

    test("the frame behind the dispatched one survives a read of another connection", async () => {
      using peer = rawPeer({ secure });
      const { ws, log, record, logged, spinUntil, send } = await connect(peer);
      // The peer reads this message into the buffer that holds frame b. Frame a is
      // 3 bytes long, and byte 3 of the frame of this message is the low byte of
      // its length: 0x03, which is not a valid start of frame b.
      const fromClient = Buffer.alloc(0x103, "x").toString();
      let received = 0;
      peer.onData = chunk => {
        received += chunk.length;
        if (received === 8 + fromClient.length) record("the peer has the message of the client");
      };
      try {
        ws.addEventListener("message", event => {
          if (event.data !== "a") return;
          ws.send(fromClient);
          spinUntil("the peer has the message of the client");
          record("the listener of a returns");
        });
        send(frame(TEXT, "a"), frame(TEXT, "b"));
        await logged(5);
        expect(log).toEqual([
          "open",
          "message a",
          "the peer has the message of the client",
          "the listener of a returns",
          "message b",
        ]);
      } finally {
        ws.terminate();
      }
    });
  });

  test("each ping gets a pong with its own payload when the ping listener lets another ping in", async () => {
    using peer = rawPeer();
    const { ws, log, record, logged, spinUntil, send } = await connect(peer);
    let fromClient = Buffer.alloc(0);
    peer.onData = chunk => {
      fromClient = Buffer.concat([fromClient, chunk]);
      if (clientFrames(fromClient).length === 2) record("the peer has two pongs");
    };
    try {
      ws.addEventListener("ping", event => {
        if (Buffer.from(event.data).toString() !== "first") return;
        send(frame(PING, "second"));
        spinUntil("ping second");
        record("the listener of the first ping returns");
      });
      send(frame(PING, "first"), frame(TEXT, "behind the first ping"));
      await logged(6);
      expect(log).toEqual([
        "open",
        "ping first",
        "message behind the first ping",
        "ping second",
        "the listener of the first ping returns",
        "the peer has two pongs",
      ]);
      // The pong for "second" goes out first: the client sends a pong when the `ping` listeners return.
      expect(clientFrames(fromClient)).toEqual([
        { opcode: PONG, payload: "second" },
        { opcode: PONG, payload: "first" },
      ]);
    } finally {
      ws.terminate();
    }
  });

  test.each(["plain", "compressed"])(
    "a %s fragmented message can start while the listener of a buffered message runs",
    async kind => {
      const compressed = kind === "compressed";
      using peer = rawPeer({ deflate: compressed });
      const { ws, log, record, logged, spinUntil, send } = await connect(peer);
      const payload = (text: string) => (compressed ? deflateRawSync(text) : Buffer.from(text));
      const hello = payload("hello");
      const world = payload("world");
      try {
        ws.addEventListener("message", event => {
          if (event.data !== "hello") return;
          // The ping tells when the client has parsed the first fragment of "world".
          send(frame(TEXT, world.subarray(0, 3), { fin: false, rsv1: compressed }), frame(PING, "parsed"));
          spinUntil("ping parsed");
          record("the listener of hello returns");
        });
        // Two fragments, so the client assembles "hello" in its receive buffer.
        send(
          frame(TEXT, hello.subarray(0, 2), { fin: false, rsv1: compressed }),
          frame(CONTINUATION, hello.subarray(2)),
        );
        await logged(4);
        send(frame(CONTINUATION, world.subarray(3)));
        await logged(5);
        expect(log).toEqual(["open", "message hello", "ping parsed", "the listener of hello returns", "message world"]);
      } finally {
        ws.terminate();
      }
    },
  );

  test("a Close frame behind the dispatched frame also discards the later read", async () => {
    using peer = rawPeer();
    const { ws, log, record, logged, spinUntil, send } = await connect(peer);
    try {
      ws.addEventListener("message", event => {
        if (event.data !== "a") return;
        send(frame(TEXT, "c"));
        // "message c" only comes if the client takes frame c ahead of the Close frame.
        spinUntil("close 1000", "message c");
        record("the listener of a returns");
      });
      send(frame(TEXT, "a"), frame(CLOSE, Buffer.from([0x03, 0xe8])), frame(TEXT, "b"));
      await logged(4);
      expect(log).toEqual(["open", "message a", "close 1000", "the listener of a returns"]);
    } finally {
      ws.terminate();
    }
  });
});
