// close() lets the streams finish and then destroys the session. A stream is finished once its
// frames are serialized, but the socket may not have taken them all: each 16 MiB body below goes to
// a peer with the largest window, and the kernel takes about a sixth of it in one write. The rest
// waits in the session. The end of the session must not free it, and the FIN must not overtake it.
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, tls as certs } from "harness";
import { once } from "node:events";
import http2 from "node:http2";
import net from "node:net";
import { Duplex } from "node:stream";
import tls from "node:tls";
import http2utils from "./helpers";

const SIZE = 16 * 1024 * 1024;
const payload = Buffer.alloc(SIZE, "a");
const MAX_WINDOW = 2 ** 31 - 1;

type Seen = { data: number; endStream: boolean; trailers: boolean; goaways: number; pingAcks: number };
type PeerOptions = { secure?: boolean; after?: Buffer | "fin"; stopReading?: boolean };
const whole: Seen = { data: SIZE, endStream: true, trailers: false, goaways: 1, pingAcks: 0 };

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
const ping = frame(6, 0, 0, Buffer.alloc(8));
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
// counts what the server sends until the socket closes.
function openPeer(port: number, { secure = false, after, stopReading = false }: PeerOptions = {}) {
  const target = { port, host: "127.0.0.1", allowHalfOpen: true };
  const socket = secure ? tls.connect({ ...target, ALPNProtocols: ["h2"], ca: certs.cert }) : net.connect(target);
  const seen: Seen = { data: 0, endStream: false, trailers: false, goaways: 0, pingAcks: 0 };
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
        if (type === 7) seen.goaways++;
        if (type === 6 && flags & 1) seen.pingAcks++;
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

function createServer(secure = false) {
  return secure ? http2.createSecureServer({ ...certs }) : http2.createServer();
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
  const server = createServer(peerOptions.secure);
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

// A Duplex in front of a socket: a TLS socket over it writes through JS.
function duplexOver(socket: net.Socket) {
  const duplex = new Duplex({
    read() {
      socket.resume();
    },
    write(chunk, _encoding, callback) {
      socket.write(chunk, callback);
    },
    final(callback) {
      socket.end(callback);
    },
    destroy(error, callback) {
      socket.destroy();
      callback(error);
    },
  });
  socket.on("data", chunk => {
    if (!duplex.push(chunk)) socket.pause();
  });
  socket.on("end", () => duplex.push(null));
  socket.on("close", () => duplex.destroy());
  socket.on("error", error => duplex.destroy(error));
  return duplex;
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

  it("session.close() before write() calls and end() in one turn of the loop", async () => {
    const result = await download(stream => {
      stream.respond({ ":status": 200 });
      stream.session!.close();
      for (let offset = 0; offset < SIZE; offset += 65536) stream.write(payload.subarray(offset, offset + 65536));
      stream.end();
    });
    expect(result).toEqual(whole);
  });

  // The first write leaves frames queued on the stream. The writes of the later turn follow them.
  it("session.close() after write() calls in a later turn of the loop", async () => {
    const result = await download(stream => {
      stream.respond({ ":status": 200 });
      stream.write(payload.subarray(0, SIZE / 2));
      setImmediate(() => {
        stream.write(payload.subarray(SIZE / 2, SIZE / 2 + 1024));
        stream.end(payload.subarray(SIZE / 2 + 1024));
        stream.session!.close();
      });
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

  // The session is destroyed under the dispatch of the request. It answers nothing after that:
  // not the PING that came in the same read, and not the one that comes later.
  it("session.close() and then destroy() in the 'stream' event, with PING frames behind the request", async () => {
    const server = createServer();
    server.on("stream", (stream: http2.ServerHttp2Stream) => {
      stream.on("error", () => {});
      stream.respond({ ":status": 200 });
      stream.end(payload);
      stream.session!.close();
      stream.session!.destroy();
      setImmediate(() => {
        peer.socket.write(ping);
        peer.socket.resume();
      });
    });
    const peer = openPeer(await listening(server), { after: ping, stopReading: true });
    try {
      expect(await peer.closed).toEqual(whole);
    } finally {
      peer.socket.destroy();
      server.close();
    }
  });

  for (const secure of [false, true]) {
    it(`the close() callbacks run after the peer has the body${secure ? ", over TLS" : ""}`, async () => {
      const server = createServer(secure);
      const { promise: callbacks, resolve: onCallbacks } = Promise.withResolvers<Record<string, number>>();
      const port = await listening(server);
      const peer = openPeer(port, { secure });
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
  }

  it("process.exit() in the session.close() callback", async () => {
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
  });

  // An HTTP/2 server on a raw socket. It answers the request at once with an empty 200, so the
  // request is closed on both sides as soon as the client has serialized its body.
  for (const transport of ["TCP", "TLS", "TLS over a Duplex"] as const) {
    it(`client.close() after a request's end(chunk), over ${transport}`, async () => {
      const seen = { data: 0, endStream: false };
      const { promise: uploaded, resolve: onUploaded } = Promise.withResolvers<typeof seen>();
      const onConnection = (socket: net.Socket) => {
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
      };
      const server =
        transport === "TCP"
          ? net.createServer({ allowHalfOpen: true }, onConnection)
          : tls.createServer({ ...certs, ALPNProtocols: ["h2"], allowHalfOpen: true }, onConnection);
      await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
      const { port } = server.address() as net.AddressInfo;
      const client = http2.connect(`${transport === "TCP" ? "http" : "https"}://127.0.0.1:${port}`, {
        ca: certs.cert,
        createConnection:
          transport === "TLS over a Duplex"
            ? () =>
                tls.connect({
                  socket: duplexOver(net.connect(port, "127.0.0.1")),
                  ALPNProtocols: ["h2"],
                  ca: certs.cert,
                })
            : undefined,
      });
      client.on("error", () => {});
      try {
        const req = client.request({ ":path": "/", ":method": "POST" });
        req.on("error", () => {});
        req.resume();
        // The response follows the server's SETTINGS and WINDOW_UPDATE on the wire, so the client
        // knows both windows by now.
        await once(req, "response");
        req.end(payload);
        const { promise: closed, resolve: onClosed } = Promise.withResolvers<number>();
        client.close(() => onClosed(seen.data));
        expect({ atCloseCallback: await closed, ...(await uploaded) }).toEqual({
          atCloseCallback: SIZE,
          data: SIZE,
          endStream: true,
        });
      } finally {
        client.destroy();
        server.close();
      }
    });
  }

  // No close() here: net.Socket answers the peer's FIN with its own end(), which destroys the
  // socket over the body. Node delivers it. Main gets 2,652,707 of 16,777,216 bytes to the peer,
  // and bun 1.3.14 none.
  for (const secure of [false, true]) {
    it.todo(`a peer that ends its side after the request${secure ? ", over TLS" : ""}`, async () => {
      const result = await download(
        stream => {
          stream.respond({ ":status": 200 });
          stream.end(payload);
        },
        { secure, after: "fin" },
      );
      expect(result).toEqual({ ...whole, goaways: 0 });
    });
  }
});

for (const secure of [false, true]) {
  it(`close() of an idle session destroys it on the next turn of the loop, and its 'close' follows the socket's${secure ? ", over TLS" : ""}`, async () => {
    const server = createServer(secure);
    const events: string[] = [];
    const { promise: idle, resolve: onIdle } = Promise.withResolvers<http2.Http2Session>();
    const { promise: closed, resolve: onClosed } = Promise.withResolvers<void>();
    server.on(secure ? "secureConnection" : "connection", (socket: net.Socket) => {
      socket.on("close", () => events.push("socket close"));
    });
    server.on("stream", (stream: http2.ServerHttp2Stream) => {
      const session = stream.session!;
      stream.on("close", () => onIdle(session));
      stream.respond({ ":status": 200 }, { endStream: true });
    });
    const peer = openPeer(await listening(server), { secure });
    try {
      const session = await idle;
      session.on("close", () => {
        events.push("session close");
        onClosed();
      });
      session.close();
      await new Promise(resolve => process.nextTick(resolve));
      const afterTick = session.destroyed;
      await new Promise(resolve => setImmediate(resolve));
      const afterImmediate = session.destroyed;
      await closed;
      expect({ afterTick, afterImmediate, events }).toEqual({
        afterTick: false,
        afterImmediate: true,
        events: ["socket close", "session close"],
      });
    } finally {
      peer.socket.destroy();
      server.close();
    }
  });
}

describe("a body that waits for the socket and cannot be delivered", () => {
  for (const abort of ["resetAndDestroy", "destroy"] as const) {
    it(`the peer's socket.${abort}() ends the session once`, async () => {
      const server = createServer();
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

  // destroy(error) does not wait for the body. The guards against a peer that floods the session
  // and does not read end the session that way, and the socket has to go with it.
  it("a PING flood from a peer that does not read closes the socket", async () => {
    const server = createServer();
    const errors: string[] = [];
    const { promise: socketClosed, resolve: onSocketClosed } = Promise.withResolvers<void>();
    server.on("connection", socket => socket.on("close", () => onSocketClosed()));
    server.on("sessionError", (error: NodeJS.ErrnoException) => errors.push(String(error.code)));
    server.on("stream", (stream: http2.ServerHttp2Stream) => {
      stream.on("error", () => {});
      stream.respond({ ":status": 200 });
      stream.end(payload);
    });
    const flood = Buffer.concat(Array.from({ length: 1100 }, () => ping));
    const peer = openPeer(await listening(server), { after: flood, stopReading: true });
    try {
      await socketClosed;
      expect(errors).toEqual(["ERR_HTTP2_ERROR"]);
    } finally {
      peer.socket.destroy();
      server.close();
    }
  });
});
