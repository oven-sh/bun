// close() lets the streams finish and then destroys the session. A stream is finished once its
// frames are serialized, but the socket may not have taken them all: each 16 MiB body below goes to
// a peer with the largest window, and the kernel takes about a sixth of it in one write. The rest
// waits in the session. A FIN must not overtake it, and the end of the session must not free it.
// Every delivery case is whole on node v26.3.0.
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, tls as certs, isASAN, isDebug, isWindows } from "harness";
import { once } from "node:events";
import http2 from "node:http2";
import net from "node:net";
import tls from "node:tls";
import http2utils from "./helpers";

const SIZE = 16 * 1024 * 1024;
const payload = Buffer.alloc(SIZE, "a");
const MAX_WINDOW = 2 ** 31 - 1;

type Seen = { data: number; endStream: boolean; trailers: boolean; goaway: boolean };
type PeerOptions = { secure?: boolean; after?: Buffer | "fin"; stopReading?: boolean };
const whole: Seen = { data: SIZE, endStream: true, trailers: false, goaway: true };

function uint32(value: number) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value);
  return bytes;
}
function frame(type: number, flags: number, id: number, body = Buffer.alloc(0)) {
  return Buffer.concat([new http2utils.Frame(body.length, type, flags, id).data, body]);
}
// SETTINGS_INITIAL_WINDOW_SIZE and a connection WINDOW_UPDATE: the other side may send any amount of DATA.
const openWindows = Buffer.concat([
  frame(4, 0, 0, Buffer.concat([Buffer.from([0, 4]), uint32(MAX_WINDOW)])),
  frame(8, 0, 0, uint32(MAX_WINDOW - 65535)),
]);
const settingsAck = frame(4, 1, 0);
const isSettings = (type: number, flags: number) => type === 4 && (flags & 1) === 0;

// Walks the frames in a byte stream: `onFrame` for each frame header, `onPayload` for each run of payload bytes.
function frameReader(
  skip: number,
  onFrame: (type: number, flags: number, id: number) => void,
  onPayload: (type: number, id: number, length: number) => void,
) {
  const header = Buffer.alloc(9);
  let filled = 0;
  let left = 0;
  let type = 0;
  let id = 0;
  return (chunk: Buffer) => {
    let offset = Math.min(skip, chunk.length);
    skip -= offset;
    while (offset < chunk.length) {
      if (left > 0) {
        const length = Math.min(left, chunk.length - offset);
        onPayload(type, id, length);
        left -= length;
        offset += length;
        continue;
      }
      const length = Math.min(9 - filled, chunk.length - offset);
      chunk.copy(header, filled, offset, offset + length);
      filled += length;
      offset += length;
      if (filled === 9) {
        filled = 0;
        left = header.readUIntBE(0, 3);
        type = header[3];
        id = header.readUInt32BE(5) & 0x7fffffff;
        onFrame(type, header[4], id);
      }
    }
  };
}

// An HTTP/2 client on a raw socket. It opens its windows and, once it has the server's SETTINGS,
// sends the ACK and GET / on stream 1. `after` is what follows the request: more frames, or "fin"
// to end its side of the connection. `stopReading` leaves everything after that in the kernel. It
// counts what the server sends on stream 1 until the socket closes.
function openPeer(port: number, { secure = false, after, stopReading = false }: PeerOptions = {}) {
  const target = { port, host: "127.0.0.1", allowHalfOpen: true };
  const socket = secure ? tls.connect({ ...target, ALPNProtocols: ["h2"], ca: certs.cert }) : net.connect(target);
  const seen: Seen = { data: 0, endStream: false, trailers: false, goaway: false };
  const authority = Buffer.from("127.0.0.1");
  // :method GET, :scheme, :path /, :authority
  const request = frame(
    1,
    0x5,
    1,
    Buffer.concat([Buffer.from([0x82, secure ? 0x87 : 0x86, 0x84, 0x41, authority.length]), authority]),
  );
  let requested = false;
  let headerBlocks = 0;
  socket.on(
    "data",
    frameReader(
      0,
      (type, flags, id) => {
        if (isSettings(type, flags) && !requested) {
          requested = true;
          const bytes = Buffer.concat([settingsAck, request, Buffer.isBuffer(after) ? after : Buffer.alloc(0)]);
          if (after === "fin") socket.end(bytes);
          else socket.write(bytes);
          if (stopReading) socket.pause();
        }
        if (type === 7) seen.goaway = true;
        if (id !== 1 || type > 1) return;
        if (type === 1 && ++headerBlocks > 1) seen.trailers = true;
        if (flags & 1) seen.endStream = true;
      },
      (type, id, length) => {
        if (type === 0 && id === 1) seen.data += length;
      },
    ),
  );
  socket.on("error", () => {});
  socket.on("end", () => socket.end());
  socket.write(Buffer.concat([http2utils.kClientMagic, openWindows]));
  return { socket, seen, closed: new Promise<Seen>(resolve => socket.once("close", () => resolve(seen))) };
}

async function listening(server: net.Server) {
  server.on("sessionError", () => {});
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as net.AddressInfo).port;
}

// Serves the peer's request with `respond(stream, server)` and reports what the peer got.
async function download(
  respond: (stream: http2.ServerHttp2Stream, server: http2.Http2Server | http2.Http2SecureServer) => void,
  peerOptions: PeerOptions = {},
) {
  const server = peerOptions.secure ? http2.createSecureServer({ ...certs }) : http2.createServer();
  server.on("stream", (stream: http2.ServerHttp2Stream) => {
    stream.on("error", () => {});
    respond(stream, server);
  });
  const peer = openPeer(await listening(server), peerOptions);
  try {
    return await peer.closed;
  } finally {
    peer.socket.destroy();
    server.close();
  }
}

describe("a graceful close delivers a body that still waits for the socket", () => {
  it("server.close() after end(chunk)", async () => {
    const result = await download((stream, server) => {
      stream.respond({ ":status": 200 });
      stream.end(payload);
      server.close();
    });
    expect(result).toEqual(whole);
  });

  for (const secure of [false, true]) {
    it(`session.close() after end(chunk)${secure ? ", over TLS" : ""}`, async () => {
      const result = await download(
        stream => {
          stream.respond({ ":status": 200 });
          stream.end(payload);
          stream.session!.close();
        },
        { secure },
      );
      expect(result).toEqual(whole);
    });
  }

  it("session.close() from the stream's 'close' event", async () => {
    const result = await download(stream => {
      const session = stream.session!;
      stream.on("close", () => session.close());
      stream.respond({ ":status": 200 });
      stream.end(payload);
    });
    expect(result).toEqual(whole);
  });

  it("session.close() and then destroy() from the stream's 'close' event", async () => {
    const result = await download(stream => {
      const session = stream.session!;
      stream.on("close", () => {
        session.close();
        session.destroy();
      });
      stream.respond({ ":status": 200 });
      stream.end(payload);
    });
    expect(result).toEqual(whole);
  });

  it("session.close() before many write() calls and end()", async () => {
    const result = await download(stream => {
      stream.respond({ ":status": 200 });
      stream.session!.close();
      for (let offset = 0; offset < SIZE; offset += 65536) stream.write(payload.subarray(offset, offset + 65536));
      stream.end();
    });
    expect(result).toEqual(whole);
  });

  it("session.close() after end(chunk) on a stream that sends trailers", async () => {
    const result = await download(stream => {
      stream.respond({ ":status": 200 }, { waitForTrailers: true });
      stream.on("wantTrailers", () => stream.sendTrailers({ "x-trailer": "sent" }));
      stream.end(payload);
      stream.session!.close();
    });
    expect(result).toEqual({ ...whole, trailers: true });
  });

  it("server.close() after res.addTrailers() and res.end(chunk)", async () => {
    const server = http2.createServer((req, res) => {
      res.addTrailers({ "x-trailer": "sent" });
      res.end(payload);
      server.close();
    });
    const peer = openPeer(await listening(server));
    expect(await peer.closed).toEqual({ ...whole, trailers: true });
  });

  it("the peer's GOAWAY(NO_ERROR) after end(chunk)", async () => {
    const result = await download(
      stream => {
        stream.respond({ ":status": 200 });
        stream.end(payload);
      },
      { after: new http2utils.GoAwayFrame(0, 0).data },
    );
    expect(result).toEqual(whole);
  });

  // No close() at all: net.Socket answers the peer's FIN with its own end(), which must wait too.
  for (const secure of [false, true]) {
    it(`a peer that ends its side after the request${secure ? ", over TLS" : ""}`, async () => {
      const result = await download(
        stream => {
          stream.respond({ ":status": 200 });
          stream.end(payload);
        },
        { secure, after: "fin" },
      );
      expect(result).toEqual({ ...whole, goaway: false });
    });
  }

  // The socket's handle sends a deferred FIN by itself: the caller of shutdown() does not ask again.
  it("the handle's shutdown() sends its FIN after the body", async () => {
    const server = http2.createServer();
    const { promise: answer, resolve: onAnswer } = Promise.withResolvers<unknown>();
    let handle: { shutdown(): unknown };
    server.on("connection", socket => {
      handle = (socket as unknown as { _handle: typeof handle })._handle;
    });
    server.on("stream", (stream: http2.ServerHttp2Stream) => {
      stream.on("error", () => {});
      stream.respond({ ":status": 200 });
      stream.end(payload);
      onAnswer(handle.shutdown());
    });
    const peer = openPeer(await listening(server));
    try {
      expect({ answer: await answer, ...(await peer.closed) }).toEqual({ answer: false, ...whole, goaway: false });
    } finally {
      peer.socket.destroy();
      server.close();
    }
  });

  it("the close() callbacks run after the peer has the body", async () => {
    const server = http2.createServer();
    const { promise: callbacks, resolve: onCallbacks } = Promise.withResolvers<Record<string, number>>();
    const port = await listening(server);
    const peer = openPeer(port);
    server.on("stream", (stream: http2.ServerHttp2Stream) => {
      const received: Record<string, number> = {};
      const record = (name: string) => () => {
        received[name] = peer.seen.data;
        if ("session" in received && "server" in received) onCallbacks(received);
      };
      stream.respond({ ":status": 200 });
      stream.end(payload);
      stream.session!.close(record("session"));
      server.close(record("server"));
    });
    expect(await callbacks).toEqual({ session: SIZE, server: SIZE });
  });

  it(
    "process.exit() in the session.close() callback",
    async () => {
      await using server = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
          const http2 = require("node:http2");
          const server = http2.createServer();
          server.on("stream", stream => {
            const session = stream.session;
            stream.respond({ ":status": 200 });
            stream.end(Buffer.alloc(${SIZE}, "a"));
            session.close(() => process.exit(0));
            // close() queued the destroy of the session before this.
            setImmediate(() => console.log("destroyed", session.destroyed));
          });
          server.listen(0, "127.0.0.1", () => console.log(server.address().port));
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "inherit",
      });
      const reader = server.stdout.getReader();
      let output = "";
      // The next line of the child's output, or what is left of it when the child has exited.
      async function line() {
        while (!output.includes("\n")) {
          const { value, done } = await reader.read();
          if (done) break;
          output += Buffer.from(value).toString();
        }
        const [first, ...rest] = output.split("\n");
        output = rest.join("\n");
        return first;
      }
      // The peer reads nothing until the session is destroyed, so the body cannot leave before that.
      const peer = openPeer(Number(await line()), { stopReading: true });
      await line();
      peer.socket.resume();
      expect(await peer.closed).toEqual(whole);
      expect(await server.exited).toBe(0);
    },
    // A debug or ASAN build needs seconds to start the child.
    isDebug || isASAN ? 30_000 : undefined,
  );

  it("client.close() after a request's end(chunk)", async () => {
    // An HTTP/2 server on a raw socket. It answers the request at once with an empty 200, so the
    // request is closed on both sides as soon as the client has serialized its body.
    const seen = { data: 0, endStream: false };
    const { promise: uploaded, resolve: onUploaded } = Promise.withResolvers<typeof seen>();
    const server = net.createServer({ allowHalfOpen: true }, socket => {
      socket.on(
        "data",
        frameReader(
          http2utils.kClientMagic.length,
          (type, flags, id) => {
            if (isSettings(type, flags)) socket.write(settingsAck);
            if (id !== 1 || type > 1) return;
            // :status 200, END_STREAM
            if (type === 1) socket.write(frame(1, 0x5, 1, Buffer.from([0x88])));
            if (flags & 1) seen.endStream = true;
          },
          (type, id, length) => {
            if (type === 0 && id === 1) seen.data += length;
          },
        ),
      );
      socket.on("error", () => {});
      socket.on("end", () => socket.end());
      socket.on("close", () => onUploaded(seen));
      socket.write(openWindows);
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const client = http2.connect(`http://127.0.0.1:${(server.address() as net.AddressInfo).port}`);
    client.on("error", () => {});
    try {
      const req = client.request({ ":path": "/", ":method": "POST" });
      req.on("error", () => {});
      req.resume();
      // The response follows the server's SETTINGS and WINDOW_UPDATE on the wire, so the client
      // knows both windows by now.
      await once(req, "response");
      req.end(payload);
      client.close();
      expect(await uploaded).toEqual({ data: SIZE, endStream: true });
    } finally {
      client.destroy();
      server.close();
    }
  });
});

describe("a body that waits for the socket and cannot be delivered", () => {
  for (const abort of ["resetAndDestroy", "destroy"] as const) {
    it(`the peer's socket.${abort}() ends the session once`, async () => {
      const server = http2.createServer();
      const events: string[] = [];
      const { promise: sessionDestroyed, resolve: onSessionDestroyed } = Promise.withResolvers<void>();
      const { promise: socketClosed, resolve: onSocketClosed } = Promise.withResolvers<void>();
      server.on("connection", socket => socket.on("close", () => onSocketClosed()));
      server.on("stream", (stream: http2.ServerHttp2Stream) => {
        const session = stream.session!;
        stream.on("error", () => {});
        session.on("error", error => events.push(`error ${(error as NodeJS.ErrnoException).code}`));
        session.on("close", () => events.push("close"));
        stream.respond({ ":status": 200 });
        stream.end(payload);
        session.close(() => events.push("callback"));
        // close() queued the destroy of the session before this.
        setImmediate(onSessionDestroyed);
      });
      const peer = openPeer(await listening(server), { stopReading: true });
      try {
        await sessionDestroyed;
        peer.socket[abort]();
        await socketClosed;
        // 'close' of the session comes from the socket's 'close'; a second one would be queued by now.
        await new Promise(resolve => setImmediate(resolve));
        expect(events).toEqual(["close", "callback"]);
      } finally {
        peer.socket.destroy();
        server.close();
      }
    });
  }

  // The session is alive here: the peer's FIN made the socket end its side, and that FIN waits for
  // the body. When the peer then goes away, node reports nothing on the session, and the socket
  // finishes its write side before it closes.
  it.skipIf(isWindows)("a peer that ends its side and then resets is no error for the session", async () => {
    const server = http2.createServer();
    const events: string[] = [];
    const { promise: socketEnded, resolve: onSocketEnded } = Promise.withResolvers<void>();
    const { promise: socketClosed, resolve: onSocketClosed } = Promise.withResolvers<void>();
    server.on("sessionError", (error: NodeJS.ErrnoException) => events.push(`sessionError ${error.code}`));
    server.on("session", (session: http2.Http2Session) => {
      session.on("error", error => events.push(`session error ${(error as NodeJS.ErrnoException).code}`));
      session.on("close", () => events.push("session close"));
    });
    server.on("connection", socket => {
      socket.on("error", error => events.push(`socket error ${(error as NodeJS.ErrnoException).code}`));
      socket.on("finish", () => events.push("socket finish"));
      socket.on("close", () => {
        events.push("socket close");
        onSocketClosed();
      });
      // The socket answers the peer's FIN with end() on the next tick.
      socket.on("end", () => setImmediate(onSocketEnded));
    });
    server.on("stream", (stream: http2.ServerHttp2Stream) => {
      stream.on("error", () => {});
      stream.respond({ ":status": 200 });
      stream.end(payload);
    });
    const peer = openPeer(await listening(server), { after: "fin", stopReading: true });
    try {
      await socketEnded;
      peer.socket.resetAndDestroy();
      await socketClosed;
      await new Promise(resolve => setImmediate(resolve));
      expect(events).toEqual(["socket finish", "socket close", "session close"]);
    } finally {
      peer.socket.destroy();
      server.close();
    }
  });

  for (const [name, args, errors] of [
    ["destroy()", [], []],
    ["destroy(error)", [new Error("boom")], ["boom"]],
  ] as const) {
    it(`${name} ends a socket whose FIN waits for the body`, async () => {
      const server = http2.createServer();
      const seenErrors: string[] = [];
      const { promise: socketClosed, resolve: onSocketClosed } = Promise.withResolvers<void>();
      let session: http2.Http2Session;
      server.on("session", (serverSession: http2.Http2Session) => {
        session = serverSession;
        session.on("error", error => seenErrors.push(error.message));
      });
      server.on("connection", socket => {
        socket.on("close", () => onSocketClosed());
        // The socket answers the peer's FIN with end() on the next tick, and that FIN waits for the body.
        socket.on("end", () => setImmediate(() => session.destroy(...args)));
      });
      server.on("stream", (stream: http2.ServerHttp2Stream) => {
        stream.on("error", () => {});
        stream.respond({ ":status": 200 });
        stream.end(payload);
      });
      // The peer reads nothing, so the socket closes only if destroy() lets go of that FIN.
      const peer = openPeer(await listening(server), { after: "fin", stopReading: true });
      try {
        await socketClosed;
        expect(seenErrors).toEqual([...errors]);
      } finally {
        peer.socket.destroy();
        server.close();
      }
    });
  }
});

it("close() of an idle session destroys it on the next turn of the loop", async () => {
  const server = http2.createServer();
  const { promise: idle, resolve: onIdle } = Promise.withResolvers<http2.Http2Session>();
  const { promise: socketClosed, resolve: onSocketClosed } = Promise.withResolvers<void>();
  server.on("connection", socket => socket.on("close", () => onSocketClosed()));
  server.on("stream", (stream: http2.ServerHttp2Stream) => {
    const session = stream.session!;
    stream.on("close", () => onIdle(session));
    stream.respond({ ":status": 200 }, { endStream: true });
  });
  const peer = openPeer(await listening(server));
  try {
    const session = await idle;
    const sessionClosed = once(session, "close");
    session.close();
    await new Promise(resolve => process.nextTick(resolve));
    const afterTick = session.destroyed;
    await new Promise(resolve => setImmediate(resolve));
    const afterImmediate = session.destroyed;
    await Promise.all([sessionClosed, socketClosed]);
    expect({ afterTick, afterImmediate }).toEqual({ afterTick: false, afterImmediate: true });
  } finally {
    peer.socket.destroy();
    server.close();
  }
});
