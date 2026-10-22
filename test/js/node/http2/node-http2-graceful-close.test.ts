// close() lets the streams finish and then destroys the session. A stream is finished once its
// frames are serialized, but the socket may not have taken them all: each body below goes to a peer
// with the largest window, through a send buffer and a receive buffer of 64 KiB, so the kernel
// takes a small part of it in one write. The rest waits in the session. The end of the session must
// not free it, and the FIN must not overtake it, whether the session's close() or the socket's own
// end() sends that FIN.
import { socketFaultInjection as fault, setSocketOptions } from "bun:internal-for-testing";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, tls as certs, isASAN, isWindows, tempDir } from "harness";
import { AsyncLocalStorage } from "node:async_hooks";
import { once } from "node:events";
import http2 from "node:http2";
import net from "node:net";
import { join } from "node:path";
import { Duplex } from "node:stream";
import tls from "node:tls";
import http2utils from "./helpers";

// A write to a Windows socket is not bound by its send buffer, so the body is larger there.
const SIZE = (isWindows ? 16 : 1) * 1024 * 1024;
// SO_SNDBUF of the side that sends the body, SO_RCVBUF of the side that gets it.
const capSend = (socket: object) => setSocketOptions(socket, 1, 64 * 1024);
const capReceive = (socket: object) => setSocketOptions(socket, 2, 64 * 1024);
const payload = Buffer.alloc(SIZE, "a");
const MAX_WINDOW = 2 ** 31 - 1;

type Seen = { data: number; endStream: boolean; trailers: boolean; goaways: number; pingAcks: number };
type PeerOptions = {
  secure?: boolean;
  after?: Buffer | "fin";
  stopReading?: boolean;
  streamWindow?: number;
  keepOpen?: boolean;
  eager?: boolean;
  upload?: boolean;
};
const whole: Seen = { data: SIZE, endStream: true, trailers: false, goaways: 1, pingAcks: 0 };

function uint32(value: number) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value);
  return bytes;
}
function frame(type: number, flags: number, id: number, body = Buffer.alloc(0)) {
  return Buffer.concat([new http2utils.Frame(body.length, type, flags, id).data, body]);
}
// SETTINGS_INITIAL_WINDOW_SIZE and a connection WINDOW_UPDATE: the other side may send any amount
// of DATA on the connection, and `streamWindow` bytes of it on a stream.
function windows(streamWindow = MAX_WINDOW) {
  return Buffer.concat([
    frame(4, 0, 0, Buffer.concat([Buffer.from([0, 4]), uint32(streamWindow)])),
    frame(8, 0, 0, uint32(MAX_WINDOW - 65535)),
  ]);
}
const openWindows = windows();
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

// An HTTP/2 client on a raw socket, to a port or to the path of a unix socket. It opens its windows
// and, once it has the server's SETTINGS (at once if `eager`), sends the ACK and GET / on stream 1,
// or a POST with a body if `upload`. `after` is what follows the request: more frames, or "fin" to
// end its side of the connection. `stopReading` leaves everything after that in the kernel. It
// answers the server's FIN with its own (unless `keepOpen`), and counts what the server sends until
// the socket closes.
function openPeer(
  address: number | string,
  {
    secure = false,
    after,
    stopReading = false,
    streamWindow,
    keepOpen = false,
    eager = false,
    upload = false,
  }: PeerOptions = {},
) {
  const target =
    typeof address === "string"
      ? { path: address, allowHalfOpen: true }
      : { port: address, host: "127.0.0.1", allowHalfOpen: true };
  const socket = secure ? tls.connect({ ...target, ALPNProtocols: ["h2"], ca: certs.cert }) : net.connect(target);
  socket.once(secure ? "secureConnect" : "connect", () => capReceive(socket));
  const seen: Seen = { data: 0, endStream: false, trailers: false, goaways: 0, pingAcks: 0 };
  const authority = Buffer.from("127.0.0.1");
  // :method GET or POST, :scheme, :path /, :authority
  const block = Buffer.concat([
    Buffer.from([upload ? 0x83 : 0x82, secure ? 0x87 : 0x86, 0x84, 0x41, authority.length]),
    authority,
  ]);
  const request = upload
    ? Buffer.concat([frame(1, 0x4, 1, block), frame(0, 0x1, 1, Buffer.from("body"))])
    : frame(1, 0x5, 1, block);
  const follow = () => {
    const bytes = Buffer.concat([request, Buffer.isBuffer(after) ? after : Buffer.alloc(0)]);
    if (after === "fin") socket.end(bytes);
    else socket.write(bytes);
    if (stopReading) socket.pause();
  };
  let requested = eager;
  let headerBlocks = 0;
  socket.on(
    "data",
    frameReader(
      0,
      (type, flags, id) => {
        if (isSettings(type, flags) && !requested) {
          requested = true;
          socket.write(settingsAck);
          follow();
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
  if (!keepOpen) socket.on("end", () => socket.end());
  socket.write(Buffer.concat([http2utils.kClientMagic, windows(streamWindow)]));
  if (eager) follow();
  return { socket, seen, closed: new Promise<Seen>(resolve => socket.once("close", () => resolve(seen))) };
}

function createServer(secure = false, tlsOptions: tls.SecureContextOptions = {}) {
  const server = secure ? http2.createSecureServer({ ...certs, ...tlsOptions }) : http2.createServer();
  server.on(secure ? "secureConnection" : "connection", capSend);
  return server;
}

// Listens on a port of the loopback interface, or on `path`, and gives what openPeer() connects to.
async function listening(server: net.Server, path?: string) {
  server.on("sessionError", () => {});
  if (path) {
    await new Promise<void>(resolve => server.listen(path, resolve));
    return path;
  }
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as net.AddressInfo).port;
}

// The next turn of the event loop. The ticks that were queued before it have run by then.
const nextTurn = () => new Promise<void>(resolve => setImmediate(resolve));

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
    server.on("connection", capSend);
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
        server.on("connection", socket => require("bun:internal-for-testing").setSocketOptions(socket, 1, 65536));
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
        capReceive(socket);
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
      let raw: net.Socket | undefined;
      const client = http2.connect(`${transport === "TCP" ? "http" : "https"}://127.0.0.1:${port}`, {
        ca: certs.cert,
        createConnection:
          transport === "TLS over a Duplex"
            ? () =>
                tls.connect({
                  socket: duplexOver((raw = net.connect(port, "127.0.0.1"))),
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
        capSend(raw ?? client.socket);
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
});

// An HTTP/2 server on a raw socket. It answers the request with a 200 and, at the first DATA frame
// of the request body, ends the response: `answer` gets the END_STREAM frame, and by default ends
// the server's side of the connection with it. It counts the request body until the socket closes.
async function listenForUpload(
  secure = false,
  answer: (socket: net.Socket, endStream: Buffer) => void = (socket, endStream) => socket.end(endStream),
) {
  const seen = { data: 0, endStream: false };
  const { promise: uploaded, resolve: onUploaded } = Promise.withResolvers<typeof seen>();
  const onConnection = (socket: net.Socket) => {
    capReceive(socket);
    let ended = false;
    socket.on(
      "data",
      frameReader(
        http2utils.kClientMagic.length,
        (type, flags, id) => {
          if (isSettings(type, flags)) socket.write(settingsAck);
          if (id !== 1 || type > 1) return;
          // :status 200
          if (type === 1) socket.write(frame(1, 0x4, 1, Buffer.from([0x88])));
          if (type === 0 && !ended) {
            ended = true;
            answer(socket, frame(0, 0x1, 1));
          }
          if (flags & 1) seen.endStream = true;
        },
        (type, id, length) => {
          if (type === 0 && id === 1) seen.data += length;
        },
      ),
    );
    socket.on("error", () => {});
    socket.on("close", () => onUploaded(seen));
    socket.write(openWindows);
  };
  const server = secure
    ? tls.createServer({ ...certs, ALPNProtocols: ["h2"], allowHalfOpen: true }, onConnection)
    : net.createServer({ allowHalfOpen: true }, onConnection);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return { server, port: (server.address() as net.AddressInfo).port, uploaded };
}

// A socket to listenForUpload(), and the HTTP/2 client on it. "adopted": tls.connect() takes the
// descriptor of a net.Socket.
function connectClient(port: number, secure: boolean | "adopted" = false) {
  const target = { port, host: "127.0.0.1" };
  const options = { ALPNProtocols: ["h2"], ca: certs.cert };
  const socket =
    secure === "adopted"
      ? tls.connect({ socket: net.connect(target), ...options })
      : secure
        ? tls.connect({ ...target, ...options })
        : net.connect(target);
  const client = http2.connect(`${secure ? "https" : "http"}://127.0.0.1:${port}`, { createConnection: () => socket });
  return { socket, client };
}

// Sends the request, and the body once the response headers are there. The response follows the
// server's SETTINGS and WINDOW_UPDATE on the wire, so the client knows both windows by then.
async function upload(client: http2.ClientHttp2Session) {
  const req = client.request({ ":path": "/", ":method": "POST" });
  req.on("error", () => {});
  req.resume();
  await once(req, "response");
  capSend(client.socket);
  req.end(payload);
}

// The source of an HTTP/2 client that does the same in a process of its own.
const uploadClient = (port: number, prepare = "", afterEnd = "") => `
  const http2 = require("node:http2");
  const net = require("node:net");
  const socket = net.connect(${port}, "127.0.0.1");
  const client = http2.connect("http://127.0.0.1:${port}", { createConnection: () => socket });
  ${prepare}
  const req = client.request({ ":path": "/", ":method": "POST" });
  req.resume();
  req.on("response", () => {
    require("bun:internal-for-testing").setSocketOptions(socket, 1, 65536);
    req.end(Buffer.alloc(${SIZE}, "a"));
    ${afterEnd}
  });
`;

// The first line of a child's output.
async function firstLine(output: ReadableStream<Uint8Array>) {
  let text = "";
  for await (const chunk of output) {
    text += Buffer.from(chunk).toString();
    if (text.includes("\n")) break;
  }
  return text.split("\n")[0];
}

// Whether the kernel has not taken the whole body from `socket`: the rest waits in the session.
const owes = (socket: net.Socket) => (socket as any)._handle.bytesWritten < SIZE;

// Resolves a turn of the loop after `socket` has ended its write side. The socket asks for its
// FIN on the tick after end(), so it has asked by then.
async function askedForFin(socket: net.Socket) {
  while (!socket.writableEnded) await nextTurn();
  await nextTurn();
}

// No graceful close of the session is needed for these. net.Socket ends its write side by itself
// when the peer ends its side, and that FIN follows the frames the socket has not taken: libuv runs
// node's shutdown request after the queued writes, and 'finish' comes after it.
describe("the end of the socket's write side waits for a body that the socket has not taken", () => {
  // At TLS 1.2, Node v26.3.0 sends nothing of this response.
  for (const transport of ["TCP", "TLS", "TLS 1.2", "a unix socket"] as const) {
    // A path is a named pipe on Windows.
    it.skipIf(isWindows && transport === "a unix socket")(
      `a peer that ends its side after the request, over ${transport}`,
      async () => {
        using dir = transport === "a unix socket" ? tempDir("h2-peer-fin", {}) : undefined;
        const secure = transport.startsWith("TLS");
        const server = createServer(secure, transport === "TLS 1.2" ? { maxVersion: "TLSv1.2" } : {});
        const events: string[] = [];
        const { promise: sessionClosed, resolve: onSessionClosed } = Promise.withResolvers<void>();
        server.on(secure ? "secureConnection" : "connection", (socket: net.Socket) => {
          for (const event of ["end", "finish", "close"]) socket.on(event, () => events.push(`socket ${event}`));
        });
        server.on("session", (session: http2.Http2Session) => {
          session.on("close", () => {
            events.push("session close");
            onSessionClosed();
          });
        });
        server.on("stream", (stream: http2.ServerHttp2Stream) => {
          stream.on("error", () => {});
          stream.respond({ ":status": 200 });
          stream.end(payload);
        });
        const peer = openPeer(await listening(server, dir && join(String(dir), "h2.sock")), { secure, after: "fin" });
        try {
          const seen = await peer.closed;
          await sessionClosed;
          expect({ ...seen, events }).toEqual({
            ...whole,
            goaways: 0,
            events: ["socket end", "socket finish", "socket close", "session close"],
          });
        } finally {
          peer.socket.destroy();
          server.close();
        }
      },
    );
  }

  // The second write waits on the stream until the socket has taken the first.
  it("a peer that ends its side after the request, and a response in two writes", async () => {
    const result = await download(
      stream => {
        stream.respond({ ":status": 200 });
        stream.write(payload);
        stream.end(payload);
      },
      { after: "fin" },
    );
    expect(result).toEqual({ ...whole, data: 2 * SIZE, goaways: 0 });
  });

  // These responses end their stream after the body has been flushed: the trailers, or the empty
  // DATA frame of the compat API, follow the last byte. Node v26.3.0 sends the body and no END_STREAM.
  it("a peer that ends its side after the request, and a response with trailers", async () => {
    const result = await download(
      stream => {
        stream.respond({ ":status": 200 }, { waitForTrailers: true });
        stream.on("wantTrailers", () => stream.sendTrailers({ "x-trailer": "sent" }));
        stream.end(payload);
      },
      { after: "fin" },
    );
    expect(result).toEqual({ ...whole, trailers: true, goaways: 0 });
  });

  it("a peer that ends its side after the request, and a response of the compat API", async () => {
    const server = http2.createServer((req, res) => res.end(payload));
    server.on("connection", capSend);
    const peer = openPeer(await listening(server), { after: "fin" });
    try {
      expect(await peer.closed).toEqual({ ...whole, goaways: 0 });
    } finally {
      peer.socket.destroy();
      server.close();
    }
  });

  // The response is written when the request body has ended, which is before the socket reads the FIN.
  it("a peer that ends its side after a request with a body", async () => {
    const result = await download(
      stream => {
        stream.resume();
        stream.on("end", () => {
          stream.respond({ ":status": 200 });
          stream.end(payload);
        });
      },
      { after: "fin", upload: true },
    );
    expect(result).toEqual({ ...whole, goaways: 0 });
  });

  // A raw client that opens the connection window and leaves each stream at 65,535 bytes. It sends
  // GET / on streams 1 and 3, a WINDOW_UPDATE for stream `open` only, and ends its side.
  function openTwoStreamPeer(port: number, open: number) {
    const socket = net.connect({ port, host: "127.0.0.1", allowHalfOpen: true });
    const seen: Record<number, { data: number; endStream: boolean }> = {
      1: { data: 0, endStream: false },
      3: { data: 0, endStream: false },
    };
    const authority = Buffer.from("127.0.0.1");
    const request = (id: number) =>
      frame(1, 0x5, id, Buffer.concat([Buffer.from([0x82, 0x86, 0x84, 0x41, authority.length]), authority]));
    let requested = false;
    socket.on(
      "data",
      frameReader(
        0,
        (type, flags, id) => {
          if (isSettings(type, flags) && !requested) {
            requested = true;
            const update = frame(8, 0, open, uint32(MAX_WINDOW - 65535));
            socket.end(Buffer.concat([settingsAck, request(1), request(3), update]));
          }
          if (seen[id] && type <= 1 && flags & 1) seen[id].endStream = true;
        },
        (type, id, length) => {
          if (type === 0 && seen[id]) seen[id].data += length;
        },
      ),
    );
    socket.on("error", () => {});
    socket.on("end", () => socket.end());
    socket.once("connect", () => capReceive(socket));
    socket.write(Buffer.concat([http2utils.kClientMagic, windows(65535)]));
    return { socket, closed: new Promise<typeof seen>(resolve => socket.once("close", () => resolve(seen))) };
  }

  // The response over its window stays queued on its stream, and the session queues the other
  // response behind it. In the socket's 'end' event the responses are written in the turn of the
  // socket's own end(): node v26.3.0 sends no DATA of them, because its end() asks for the FIN at once.
  for (const [limited, open] of [
    [1, 3],
    [3, 1],
  ] as const) {
    for (const when of ["the 'stream' event", "the socket's 'end' event"] as const) {
      it(`two responses, stream ${limited} over its window, written in ${when}`, async () => {
        const server = createServer();
        const events: string[] = [];
        const waiting: http2.ServerHttp2Stream[] = [];
        const respond = (stream: http2.ServerHttp2Stream) => {
          stream.respond({ ":status": 200 });
          stream.end(payload);
        };
        server.on("connection", socket => {
          for (const event of ["end", "finish", "close"]) socket.on(event, () => events.push(event));
          socket.on("end", () => waiting.forEach(respond));
        });
        server.on("stream", (stream: http2.ServerHttp2Stream) => {
          stream.on("error", () => {});
          if (when === "the 'stream' event") respond(stream);
          else waiting.push(stream);
        });
        const peer = openTwoStreamPeer((await listening(server)) as number, open);
        try {
          expect({ ...(await peer.closed), events }).toEqual({
            [limited]: { data: 65535, endStream: false },
            [open]: { data: SIZE, endStream: true },
            events: ["end", "finish", "close"],
          });
        } finally {
          peer.socket.destroy();
          server.close();
        }
      });
    }
  }

  // The session stays after the peer's FIN, and the user ends the socket. The callback of that
  // end() and 'finish' come after the body, in the async context of the call, as in node.
  it("socket.end(callback) after the peer's FIN on a server with allowHalfOpen", async () => {
    const als = new AsyncLocalStorage<string>();
    const server = http2.createServer({ allowHalfOpen: true });
    const stores: Record<string, string | undefined> = {};
    let owed = false;
    server.on("connection", socket => {
      capSend(socket);
      socket.on("finish", () => (stores.finish = als.getStore()));
      socket.on("end", async () => {
        als.run("caller", () => socket.end(() => (stores.callback = als.getStore())));
        await askedForFin(socket);
        owed = owes(socket);
        peer.socket.resume();
      });
    });
    server.on("stream", (stream: http2.ServerHttp2Stream) => {
      stream.on("error", () => {});
      stream.respond({ ":status": 200 });
      stream.end(payload);
    });
    const peer = openPeer(await listening(server), { after: "fin", stopReading: true });
    try {
      expect({ ...(await peer.closed), owed, stores }).toEqual({
        ...whole,
        goaways: 0,
        owed: true,
        stores: { callback: "caller", finish: "caller" },
      });
    } finally {
      peer.socket.destroy();
      server.close();
    }
  });

  // The socket had the peer's FIN, behind the request, before the session was attached to it.
  for (const secure of [false, true]) {
    it(`a session that gets its socket after the peer's FIN${secure ? ", over TLS" : ""}`, async () => {
      const sessions = createServer(secure);
      sessions.on("sessionError", () => {});
      sessions.on("stream", (stream: http2.ServerHttp2Stream) => {
        stream.on("error", () => {});
        stream.respond({ ":status": 200 });
        stream.end(payload);
      });
      const attach = (socket: net.Socket) => {
        socket.on("error", () => {});
        const poll = () => {
          if (!(socket as any)._readableState.ended) return void setImmediate(poll);
          sessions.emit(secure ? "secureConnection" : "connection", socket);
        };
        poll();
      };
      const server = secure ? tls.createServer({ ...certs, ALPNProtocols: ["h2"] }, attach) : net.createServer(attach);
      await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
      const { port } = server.address() as net.AddressInfo;
      const peer = openPeer(port, { secure, after: "fin", eager: true });
      try {
        expect(await peer.closed).toEqual({ ...whole, goaways: 0 });
      } finally {
        peer.socket.destroy();
        server.close();
      }
    });
  }

  // The socket takes nothing until the peer's FIN. HEADERS and the first write wait in the
  // session's buffer, the second write on the stream behind them, and the rest of the body behind
  // that write. The PING of the socket's 'end' event is serialized in the turn of the socket's own
  // end(), so the first write of that end empties the buffer. What waits on the stream is owed too.
  it.skipIf(!fault.available() || isWindows)(
    "the end of the socket takes what waits on a stream behind the session's buffer",
    async () => {
      const server = createServer();
      let session!: http2.ServerHttp2Session;
      let fd = -1;
      let queued = -1;
      server.on("session", (serverSession: http2.ServerHttp2Session) => {
        session = serverSession;
      });
      server.on("connection", socket => {
        fd = (socket as any)._handle.fd;
        socket.on("end", () => {
          fault.clear();
          session.ping(() => {});
        });
      });
      server.on("stream", async (stream: http2.ServerHttp2Stream) => {
        stream.on("error", () => {});
        for (const syscall of ["send", "writev"] as const) {
          fault.set({ syscall, action: "errno", errno: "EAGAIN", repeat: -1, fd });
        }
        stream.respond({ ":status": 200 });
        stream.write(payload.subarray(0, 1000));
        // The frames of that turn have met the socket by the next one, and wait in the session.
        await nextTurn();
        stream.write(payload.subarray(1000, 2000));
        queued = session.state.outboundQueueSize!;
        stream.end(payload.subarray(2000));
        peer.socket.end();
      });
      const peer = openPeer(await listening(server));
      try {
        expect({ ...(await peer.closed), queued }).toEqual({ ...whole, goaways: 0, queued: 1 });
      } finally {
        fault.clear();
        peer.socket.destroy();
        server.close();
      }
    },
  );

  // The callback of the write that waited on the stream runs inside the socket's end(), and it
  // destroys the session there. ASAN reports a parser that the end() still used after that.
  it.skipIf(!isASAN || isWindows)(
    "session.destroy() in a write callback that runs inside the socket's end()",
    async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), join(import.meta.dir, "node-http2-half-close-destroy-fixture.ts")],
        env: { ...bunEnv, ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "symbolize=0"].filter(Boolean).join(":") },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).not.toContain("AddressSanitizer");
      expect({ stdout: stdout.trim(), exitCode }).toEqual({ stdout: "destroyed", exitCode: 0 });
    },
  );

  // Node v26.3.0 emits 'finish' before 'end' here over TCP, and sends two GOAWAY frames: up to
  // v26.8 it reads nothing from the socket, the peer's FIN included, while a write of the session
  // is pending. Bun reads the FIN at once.
  it("session.close() for a peer that ended its side", async () => {
    const server = createServer();
    const events: string[] = [];
    server.on("connection", socket => {
      for (const event of ["end", "finish", "close"]) socket.on(event, () => events.push(event));
    });
    server.on("stream", (stream: http2.ServerHttp2Stream) => {
      stream.on("error", () => {});
      stream.respond({ ":status": 200 });
      stream.end(payload);
      stream.session!.close();
    });
    const peer = openPeer(await listening(server), { after: "fin" });
    try {
      expect({ ...(await peer.closed), events }).toEqual({ ...whole, events: ["end", "finish", "close"] });
    } finally {
      peer.socket.destroy();
      server.close();
    }
  });

  // The end of the socket waits first, and the session lets go of its frames after that. Bun sends
  // the GOAWAY of this close() ahead of the FIN. Node v26.3.0 sends none: over TLS its socket takes
  // no write after it has asked for the FIN, and over TCP its session is gone when close() runs.
  for (const secure of [false, true]) {
    it(`session.close() while the end of the socket waits for the body${secure ? ", over TLS" : ""}`, async () => {
      const server = createServer(secure);
      let session!: http2.Http2Session;
      const atClose = { owed: false, finished: true, destroyed: true };
      server.on("session", (serverSession: http2.Http2Session) => {
        session = serverSession;
      });
      server.on(secure ? "secureConnection" : "connection", (socket: net.Socket) => {
        socket.on("end", async () => {
          await askedForFin(socket);
          Object.assign(atClose, {
            owed: owes(socket),
            finished: socket.writableFinished,
            destroyed: session.destroyed,
          });
          session.close();
          peer.socket.resume();
        });
      });
      server.on("stream", (stream: http2.ServerHttp2Stream) => {
        stream.on("error", () => {});
        stream.respond({ ":status": 200 });
        stream.end(payload);
      });
      const peer = openPeer(await listening(server), { secure, after: "fin", stopReading: true });
      try {
        expect({ ...(await peer.closed), atClose }).toEqual({
          ...whole,
          atClose: { owed: true, finished: false, destroyed: false },
        });
      } finally {
        peer.socket.destroy();
        server.close();
      }
    });
  }

  // The peer keeps its side open and reads nothing at first, so a close cannot finish the socket:
  // the drain that follows the FIN does, and not before the socket has the body.
  for (const secure of [false, true]) {
    it(`session.close() finishes the socket once the body has left, and not before${secure ? ", over TLS" : ""}`, async () => {
      const server = createServer(secure);
      const { promise: connected, resolve: onConnected } = Promise.withResolvers<net.Socket>();
      server.on(secure ? "secureConnection" : "connection", onConnected);
      server.on("stream", (stream: http2.ServerHttp2Stream) => {
        stream.on("error", () => {});
        stream.respond({ ":status": 200 });
        stream.end(payload);
        stream.session!.close();
      });
      const peer = openPeer(await listening(server), { secure, stopReading: true, keepOpen: true });
      try {
        const socket = await connected;
        await askedForFin(socket);
        const owed = owes(socket);
        const finishedBeforeBody = socket.writableFinished;
        peer.socket.resume();
        if (!socket.writableFinished) await once(socket, "finish");
        peer.socket.end();
        expect({ ...(await peer.closed), owed, finishedBeforeBody }).toEqual({
          ...whole,
          // A write to a Windows socket can take the whole body: the socket then finishes at once.
          owed: isWindows ? owed : true,
          finishedBeforeBody: !owed,
        });
      } finally {
        peer.socket.destroy();
        server.close();
      }
    });
  }

  for (const transport of ["TCP", "TLS", "TLS over a socket that tls.connect() adopted"] as const) {
    it(`a server that ends its side during the upload of a request, over ${transport}`, async () => {
      const { server, port, uploaded } = await listenForUpload(transport !== "TCP");
      const client = http2.connect(`${transport === "TCP" ? "http" : "https"}://127.0.0.1:${port}`, {
        ca: certs.cert,
        createConnection:
          transport === "TLS over a socket that tls.connect() adopted"
            ? () => tls.connect({ socket: net.connect(port, "127.0.0.1"), ALPNProtocols: ["h2"], ca: certs.cert })
            : undefined,
      });
      client.on("error", () => {});
      try {
        await upload(client);
        expect(await uploaded).toEqual({ data: SIZE, endStream: true });
      } finally {
        client.destroy();
        server.close();
      }
    });
  }

  // The callback runs before the frames of the turn have left the session, as in node.
  it("socket.end() in the callback of stream.end(chunk)", async () => {
    const server = createServer();
    let socket!: net.Socket;
    server.on("connection", connection => {
      socket = connection;
    });
    server.on("stream", (stream: http2.ServerHttp2Stream) => {
      stream.on("error", () => {});
      stream.respond({ ":status": 200 });
      stream.end("hello", () => socket.end());
    });
    const peer = openPeer(await listening(server));
    try {
      expect(await peer.closed).toEqual({ ...whole, data: 5, goaways: 0 });
    } finally {
      peer.socket.destroy();
      server.close();
    }
  });

  // The server ends the response, keeps its side open and reads nothing of the upload at first, so
  // a close cannot finish the client's socket: the drain that follows the FIN does, and not before
  // the socket has the upload.
  for (const secure of [false, true]) {
    it(`client.close() finishes the socket once the upload has left, and not before${secure ? ", over TLS" : ""}`, async () => {
      let serverSocket!: net.Socket;
      const { server, port, uploaded } = await listenForUpload(secure, (socket, endStream) => {
        serverSocket = socket;
        socket.write(endStream);
        socket.pause();
      });
      const { socket, client } = connectClient(port, secure);
      client.on("error", () => {});
      try {
        await upload(client);
        client.close();
        await askedForFin(socket);
        const owed = owes(socket);
        const finishedBeforeUpload = socket.writableFinished;
        serverSocket.resume();
        if (!socket.writableFinished) await once(socket, "finish");
        serverSocket.end();
        expect({ ...(await uploaded), owed, finishedBeforeUpload }).toEqual({
          data: SIZE,
          endStream: true,
          // A write to a Windows socket can take the whole body: the socket then finishes at once.
          owed: isWindows ? owed : true,
          finishedBeforeUpload: !owed,
        });
      } finally {
        client.destroy();
        server.close();
      }
    });
  }

  // The socket had the server's FIN before the session was attached to it.
  it("a client session that gets its socket after the server's FIN", async () => {
    const seen = { data: 0, endStream: false };
    const { promise: uploaded, resolve: onUploaded } = Promise.withResolvers<typeof seen>();
    const server = net.createServer({ allowHalfOpen: true }, socket => {
      capReceive(socket);
      socket.on(
        "data",
        frameReader(
          http2utils.kClientMagic.length,
          (type, flags, id) => {
            if (id === 1 && type <= 1 && flags & 1) seen.endStream = true;
          },
          (type, id, length) => {
            if (type === 0 && id === 1) seen.data += length;
          },
        ),
      );
      socket.on("error", () => {});
      socket.on("close", () => onUploaded(seen));
      socket.end(openWindows);
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as net.AddressInfo;
    const socket = net.connect(port, "127.0.0.1");
    socket.on("error", () => {});
    let client: http2.ClientHttp2Session | undefined;
    try {
      await once(socket, "connect");
      while (!(socket as any)._readableState.ended) await nextTurn();
      capSend(socket);
      client = http2.connect(`http://127.0.0.1:${port}`, { createConnection: () => socket });
      client.on("error", () => {});
      const req = client.request({ ":path": "/", ":method": "POST" });
      req.on("error", () => {});
      req.end(payload);
      expect(await uploaded).toEqual({ data: SIZE, endStream: true });
    } finally {
      client?.destroy();
      socket.destroy();
      server.close();
    }
  });

  // The handle dials again while the end of its first connection waits. That end is over then, as
  // it is for a handle that sent its FIN at once: 'finish' comes before the second 'connect'.
  it("socket.connect() while the end waits finishes the first connection first", async () => {
    let serverSocket!: net.Socket;
    const { server, port } = await listenForUpload(false, (socket, endStream) => {
      serverSocket = socket;
      socket.write(endStream);
      socket.pause();
    });
    const second = net.createServer(connection => connection.on("error", () => {}));
    await new Promise<void>(resolve => second.listen(0, "127.0.0.1", resolve));
    const { socket, client } = connectClient(port);
    client.on("error", () => {});
    socket.on("error", () => {});
    try {
      await upload(client);
      client.close();
      await askedForFin(socket);
      const owed = owes(socket);
      const events: string[] = [];
      socket.on("finish", () => events.push("finish"));
      const { promise: connected, resolve: onConnected } = Promise.withResolvers<void>();
      socket.once("connect", () => {
        events.push("connect");
        onConnected();
      });
      socket.connect((second.address() as net.AddressInfo).port, "127.0.0.1");
      await connected;
      expect({ owed, events }).toEqual({
        // A write to a Windows socket can take the whole body: the socket has finished by then.
        owed: isWindows ? owed : true,
        events: owed ? ["finish", "connect"] : ["connect"],
      });
    } finally {
      socket.destroy();
      client.destroy();
      serverSocket?.destroy();
      server.close();
      second.close();
    }
  });

  // The session's socket is the last handle of the client's process. A FIN that waits for the
  // upload holds the process as a pending write does, whichever of the two ends comes first. The
  // server reads no more of the upload until the client's socket has answered its FIN.
  // Windows takes a first write whole, so no FIN waits there.
  for (const [order, afterEnd] of [
    ["the server's FIN comes before the end of the session", ""],
    ["client.close() comes before the server's FIN", "client.close();"],
  ] as const) {
    it.skipIf(isWindows)(`the process of a client stays until its upload has left: ${order}`, async () => {
      let serverSocket!: net.Socket;
      const { server, port, uploaded } = await listenForUpload(false, (socket, endStream) => {
        serverSocket = socket;
        socket.end(endStream);
        socket.pause();
      });
      try {
        await using client = Bun.spawn({
          cmd: [
            bunExe(),
            "-e",
            uploadClient(port, `socket.once("end", () => setImmediate(() => console.log("end")));`, afterEnd),
          ],
          env: bunEnv,
          stdout: "pipe",
          stderr: "inherit",
        });
        expect(await firstLine(client.stdout)).toBe("end");
        serverSocket.resume();
        expect({ ...(await uploaded), exitCode: await client.exited, signalCode: client.signalCode }).toEqual({
          data: SIZE,
          endStream: true,
          exitCode: 0,
          signalCode: null,
        });
      } finally {
        server.close();
      }
    });
  }
});

describe("the end of the socket's write side does not wait", () => {
  // The peer can send no WINDOW_UPDATE after its FIN, so the part of the body that is over its
  // window cannot leave. The socket takes the first window at once, and the second over several writes.
  for (const streamWindow of [65535, SIZE / 2]) {
    it(`for the part of a body that is over the peer's window of ${streamWindow} bytes`, async () => {
      const server = createServer();
      const events: string[] = [];
      server.on("connection", socket => {
        for (const event of ["end", "finish", "close"]) socket.on(event, () => events.push(event));
      });
      server.on("stream", (stream: http2.ServerHttp2Stream) => {
        stream.on("error", () => {});
        stream.respond({ ":status": 200 });
        stream.end(payload);
      });
      const peer = openPeer(await listening(server), { after: "fin", streamWindow });
      try {
        expect({ ...(await peer.closed), events }).toEqual({
          ...whole,
          data: streamWindow,
          endStream: false,
          goaways: 0,
          events: ["end", "finish", "close"],
        });
      } finally {
        peer.socket.destroy();
        server.close();
      }
    });
  }

  // Node sends the whole body here, END_STREAM included, and no PING ACK: its socket had the body
  // at end(), and takes nothing that the session produces after it.
  it.todo("socket.end() on the socket of a session whose peer still has its side open sends the body first");

  // The peer has not ended its side, so it can still send frames, and the session would go on
  // answering them. Bun sends the FIN at once here, over the part of the body that the kernel has
  // not taken, and answers nothing after it.
  it("for a session whose peer still sends: a PING after socket.end() gets no answer", async () => {
    const server = createServer();
    let socket!: net.Socket;
    server.on("connection", connection => {
      socket = connection;
    });
    server.on("stream", (stream: http2.ServerHttp2Stream) => {
      stream.on("error", () => {});
      stream.respond({ ":status": 200 });
      stream.end(payload);
      setImmediate(() => {
        socket.end();
        askedForFin(socket).then(() => {
          peer.socket.write(ping);
          peer.socket.resume();
        });
      });
    });
    const peer = openPeer(await listening(server), { stopReading: true });
    try {
      const seen = await peer.closed;
      expect({ ...seen, data: seen.data > 0 && seen.data < SIZE }).toEqual({
        ...whole,
        data: true,
        endStream: false,
        goaways: 0,
        pingAcks: 0,
      });
    } finally {
      peer.socket.destroy();
      server.close();
    }
  });

  // The server ends its side and reads no more, so the upload cannot leave. The client keeps its
  // process alive until its socket has answered the FIN, and that end() then waits for the upload.
  // Node keeps this process: a pending write or shutdown holds its loop for an unref'd socket too.
  // Bun lets an unref'd socket go with a write pending, and the end that waits follows that rule.
  it("in a process whose session is unref'd", async () => {
    const { server, port } = await listenForUpload(false, (socket, endStream) => {
      socket.end(endStream);
      socket.pause();
    });
    try {
      await using client = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          uploadClient(
            port,
            `client.unref();
             const alive = setInterval(() => {}, 1000);
             socket.once("end", () => setImmediate(() => clearInterval(alive)));`,
          ),
        ],
        env: bunEnv,
        stdout: "inherit",
        stderr: "inherit",
      });
      expect({ exitCode: await client.exited, signalCode: client.signalCode }).toEqual({
        exitCode: 0,
        signalCode: null,
      });
    } finally {
      server.close();
    }
  });
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

  // In the cases below the session is alive and the peer reads nothing. Its FIN made the socket end
  // its write side, and that end waits for the body. Two bodies, so that one waits on a kernel that
  // takes a first write whole.
  function respondWithTwoBodies(stream: http2.ServerHttp2Stream) {
    stream.on("error", () => {});
    stream.respond({ ":status": 200 });
    stream.write(payload);
    stream.end(payload);
  }

  // Node reports nothing when that peer goes away: the write of the session fails without an
  // error, and the socket finishes its write side before it closes.
  for (const secure of [false, true]) {
    it(`a peer that ends its side and then resets is no error for the session${secure ? ", over TLS" : ""}`, async () => {
      const server = createServer(secure);
      const events: string[] = [];
      const { promise: socketEnded, resolve: onSocketEnded } = Promise.withResolvers<void>();
      const { promise: socketClosed, resolve: onSocketClosed } = Promise.withResolvers<void>();
      server.on("sessionError", (error: NodeJS.ErrnoException) => events.push(`sessionError ${error.code}`));
      server.on("session", (session: http2.Http2Session) => {
        session.on("error", error => events.push(`session error ${(error as NodeJS.ErrnoException).code}`));
        session.on("close", () => events.push("session close"));
      });
      server.on(secure ? "secureConnection" : "connection", (socket: net.Socket) => {
        socket.on("error", error => events.push(`socket error ${(error as NodeJS.ErrnoException).code}`));
        socket.on("finish", () => events.push("socket finish"));
        socket.on("close", () => {
          events.push("socket close");
          onSocketClosed();
        });
        socket.on("end", () => askedForFin(socket).then(onSocketEnded));
      });
      server.on("stream", respondWithTwoBodies);
      const peer = openPeer(await listening(server), { secure, after: "fin", stopReading: true });
      try {
        await socketEnded;
        peer.socket.resetAndDestroy();
        await socketClosed;
        await nextTurn();
        expect(events).toEqual(["socket finish", "socket close", "session close"]);
      } finally {
        peer.socket.destroy();
        server.close();
      }
    });
  }

  // destroy() and destroy(error) do not wait for the body, so they let go of a FIN that waits for it.
  for (const secure of [false, true]) {
    for (const [name, args] of [
      ["destroy()", []],
      ["destroy(error)", [new Error("boom")]],
    ] as const) {
      it(`${name} ends a socket whose FIN waits for the body${secure ? ", over TLS" : ""}`, async () => {
        const server = createServer(secure);
        const errors: string[] = [];
        const { promise: socketClosed, resolve: onSocketClosed } = Promise.withResolvers<void>();
        let session!: http2.Http2Session;
        server.on("session", (serverSession: http2.Http2Session) => {
          session = serverSession;
          session.on("error", error => errors.push(error.message));
        });
        server.on(secure ? "secureConnection" : "connection", (socket: net.Socket) => {
          socket.on("close", () => onSocketClosed());
          socket.on("end", () => askedForFin(socket).then(() => session.destroy(...args)));
        });
        server.on("stream", respondWithTwoBodies);
        const peer = openPeer(await listening(server), { secure, after: "fin", stopReading: true });
        try {
          await socketClosed;
          expect(errors).toEqual(args.map(error => error.message));
        } finally {
          peer.socket.destroy();
          server.close();
        }
      });
    }

    // As in node, a socket that is destroyed before its shutdown completes emits no 'finish'.
    it(`socket.destroy() ends a socket whose FIN waits for the body${secure ? ", over TLS" : ""}`, async () => {
      const server = createServer(secure);
      const events: string[] = [];
      const { promise: sessionClosed, resolve: onSessionClosed } = Promise.withResolvers<void>();
      server.on("session", (session: http2.Http2Session) => {
        session.on("error", error => events.push(`session error ${(error as NodeJS.ErrnoException).code}`));
        session.on("close", () => {
          events.push("session close");
          onSessionClosed();
        });
      });
      server.on(secure ? "secureConnection" : "connection", (socket: net.Socket) => {
        socket.on("error", error => events.push(`socket error ${(error as NodeJS.ErrnoException).code}`));
        socket.on("finish", () => events.push("socket finish"));
        socket.on("close", () => events.push("socket close"));
        socket.on("end", () => askedForFin(socket).then(() => socket.destroy()));
      });
      server.on("stream", respondWithTwoBodies);
      const peer = openPeer(await listening(server), { secure, after: "fin", stopReading: true });
      try {
        await sessionClosed;
        expect(events).toEqual(["socket close", "session close"]);
      } finally {
        peer.socket.destroy();
        server.close();
      }
    });
  }

  // The server leaves the upload in the kernel and closes once the client's socket has answered
  // its FIN. The end() of that socket waits for the upload, and node reports nothing for its loss.
  for (const [transport, secure] of [
    ["TCP", false],
    ["TLS", true],
    ["TLS over a socket that tls.connect() adopted", "adopted"],
  ] as const) {
    it(`a server that answers, ends its side and then closes is no error for a client that still uploads, over ${transport}`, async () => {
      const events: string[] = [];
      let socket!: net.Socket;
      const { server, port, uploaded } = await listenForUpload(secure !== false, (serverSocket, endStream) => {
        serverSocket.end(endStream);
        serverSocket.pause();
        socket.once("end", () => askedForFin(socket).then(() => serverSocket.destroy()));
      });
      const connection = connectClient(port, secure);
      socket = connection.socket;
      const client = connection.client;
      const { promise: closed, resolve: onClosed } = Promise.withResolvers<void>();
      client.on("error", error => events.push(`session error ${(error as NodeJS.ErrnoException).code}`));
      client.on("close", () => {
        events.push("session close");
        onClosed();
      });
      socket.on("error", error => events.push(`socket error ${(error as NodeJS.ErrnoException).code}`));
      try {
        await upload(client);
        await uploaded;
        await closed;
        expect(events).toEqual(["session close"]);
      } finally {
        client.destroy();
        server.close();
      }
    });
  }

  // The server ends the response, reads nothing of the upload and sends no FIN. client.close()
  // ends the socket, that end waits for the upload, and a reset then destroys the socket with an
  // error. A socket connects again after that, and nothing of the old end is left on it.
  it("a socket that a reset destroyed while its FIN waited connects again", async () => {
    let serverSocket!: net.Socket;
    const { server, port } = await listenForUpload(false, (socket, endStream) => {
      serverSocket = socket;
      socket.write(endStream);
      socket.pause();
    });
    const received: string[] = [];
    const echo = net.createServer(connection => {
      connection.on("data", chunk => {
        received.push(`data ${chunk}`);
        connection.write(chunk);
      });
      connection.on("end", () => received.push("end"));
    });
    await new Promise<void>(resolve => echo.listen(0, "127.0.0.1", resolve));
    const { socket, client } = connectClient(port);
    const errors: string[] = [];
    socket.on("error", error => errors.push(String((error as NodeJS.ErrnoException).code)));
    client.on("error", () => {});
    try {
      await upload(client);
      client.close();
      await askedForFin(socket);
      const owed = owes(socket);
      const finishedBeforeReset = socket.writableFinished;
      const { promise: closed, resolve: onClosed } = Promise.withResolvers<void>();
      socket.once("close", () => onClosed());
      serverSocket.resetAndDestroy();
      await closed;

      const { promise: echoed, resolve: onEchoed } = Promise.withResolvers<string>();
      socket.once("data", chunk => onEchoed(String(chunk)));
      socket.connect((echo.address() as net.AddressInfo).port, "127.0.0.1", () => socket.write("ping"));
      const answer = await echoed;
      const { promise: closedAgain, resolve: onClosedAgain } = Promise.withResolvers<void>();
      socket.once("close", () => onClosedAgain());
      socket.end();
      await closedAgain;
      expect({ owed, finishedBeforeReset, errors, answer, received }).toEqual({
        // A write to a Windows socket can take the whole body: the socket then finishes at once.
        owed: isWindows ? owed : true,
        finishedBeforeReset: !owed,
        errors: ["ECONNRESET"],
        answer: "ping",
        received: ["data ping", "end"],
      });
    } finally {
      socket.destroy();
      client.destroy();
      server.close();
      echo.close();
    }
  });
});
