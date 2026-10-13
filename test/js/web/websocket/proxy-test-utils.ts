/**
 * Shared utilities for the WebSocket proxy tests: websocket-proxy.test.ts,
 * ws-proxy.test.ts and websocket-syscall-fault.test.ts.
 */

import { createHash } from "crypto";
import { bunEnv, nodeExe, tls as tlsCerts } from "harness";
import net from "net";
import tls from "tls";

/** One CONNECT request as the proxy read it. Header names are lowercased. */
export interface ConnectRequest {
  requestLine: string;
  headers: Record<string, string>;
}

export interface ConnectProxyOptions {
  requireAuth?: boolean;
  /** Terminate TLS in front of the proxy (an HTTPS proxy), with the harness certificate. */
  tls?: boolean;
  /** Observes every CONNECT request the proxy reads, before the proxy answers it. */
  onConnectRequest?: (request: ConnectRequest) => void;
  /**
   * Intercepts the bytes flowing target -> client once the tunnel is up. Call
   * `forward` to deliver bytes to the client. Defaults to forwarding every
   * chunk as it arrives.
   */
  onTargetData?: (chunk: Buffer, forward: (bytes: Buffer) => void) => void;
}

/**
 * Create an HTTP CONNECT proxy server using Node's net module (tls module with
 * `tls: true`). This proxy handles the CONNECT method to establish tunnels for
 * WebSocket connections.
 */
export function createConnectProxy(options: ConnectProxyOptions = {}): net.Server {
  const onClient = (clientSocket: net.Socket) => {
    let buffer = Buffer.alloc(0);
    let tunnelEstablished = false;
    let targetSocket: net.Socket | null = null;

    clientSocket.on("data", (data: Buffer) => {
      // If tunnel is already established, forward data directly
      if (tunnelEstablished && targetSocket) {
        targetSocket.write(data);
        return;
      }

      buffer = Buffer.concat([buffer, data]);
      const bufferStr = buffer.toString();

      // Check if we have complete headers
      const headerEnd = bufferStr.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;

      const headerPart = bufferStr.substring(0, headerEnd);
      const lines = headerPart.split("\r\n");
      const requestLine = lines[0];
      const headers: Record<string, string> = {};

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (line === "") break;
        const colonIdx = line.indexOf(": ");
        if (colonIdx > 0) {
          headers[line.substring(0, colonIdx).toLowerCase()] = line.substring(colonIdx + 2);
        }
      }

      options.onConnectRequest?.({ requestLine, headers });

      // Check for CONNECT method
      const match = requestLine.match(/^CONNECT\s+([^:]+):(\d+)\s+HTTP/);
      if (!match) {
        clientSocket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
        clientSocket.end();
        return;
      }

      const [, targetHost, targetPort] = match;

      // Check auth if required
      if (options.requireAuth) {
        const authHeader = headers["proxy-authorization"];
        if (!authHeader) {
          clientSocket.write("HTTP/1.1 407 Proxy Authentication Required\r\n\r\n");
          clientSocket.end();
          return;
        }

        const auth = Buffer.from(authHeader.replace("Basic ", "").trim(), "base64").toString("utf8");
        if (auth !== "proxy_user:proxy_pass") {
          clientSocket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
          clientSocket.end();
          return;
        }
      }

      // Get any data after the headers (shouldn't be any for CONNECT)
      const remainingData = buffer.subarray(headerEnd + 4);

      // Connect to target
      targetSocket = net.connect(parseInt(targetPort), targetHost, () => {
        clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        tunnelEstablished = true;

        // Forward any remaining data
        if (remainingData.length > 0) {
          targetSocket!.write(remainingData);
        }

        // Set up bidirectional piping
        const forward = (bytes: Buffer) => {
          clientSocket.write(bytes);
        };
        targetSocket!.on("data", (chunk: Buffer) => {
          if (options.onTargetData) {
            options.onTargetData(chunk, forward);
          } else {
            forward(chunk);
          }
        });
      });

      targetSocket.on("error", () => {
        if (!tunnelEstablished) {
          clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
        }
        clientSocket.end();
      });

      targetSocket.on("close", () => clientSocket.destroy());
      clientSocket.on("close", () => targetSocket?.destroy());
    });

    clientSocket.on("error", () => {
      targetSocket?.destroy();
    });
  };

  return options.tls
    ? tls.createServer({ key: tlsCerts.key, cert: tlsCerts.cert }, onClient)
    : net.createServer(onClient);
}

/**
 * Helper to start a proxy server and get its port.
 */
export async function startProxy(server: net.Server): Promise<number> {
  return new Promise<number>(resolve => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as net.AddressInfo;
      resolve(addr.port);
    });
  });
}

/** How a connection that a server accepted went away: after the peer's FIN or close_notify, with an error, or both. */
export interface Departure {
  fin: boolean;
  error?: string;
}

export function departure(socket: net.Socket): Promise<Departure> {
  const seen: Departure = { fin: false };
  socket.on("end", () => {
    seen.fin = true;
  });
  socket.on("error", (error: NodeJS.ErrnoException) => {
    seen.error = error.code;
  });
  return new Promise(resolve => socket.on("close", () => resolve(seen)));
}

/**
 * Starts a CONNECT proxy for one test and records every connection it accepts
 * and every CONNECT request it reads, so a test can assert what the client
 * sent to the proxy and not only that the tunnel came up. Dispose to close it.
 */
export async function startRecordingProxy(options: ConnectProxyOptions = {}) {
  const requests: ConnectRequest[] = [];
  const sni: (string | null)[] = [];
  const departures: Promise<Departure>[] = [];
  let connections = 0;
  const proxy = createConnectProxy({
    ...options,
    onConnectRequest(request) {
      requests.push(request);
      options.onConnectRequest?.(request);
    },
  });
  proxy.on("connection", () => {
    connections++;
  });
  proxy.on("secureConnection", (socket: tls.TLSSocket) => {
    sni.push(socket.servername || null);
  });
  proxy.on(options.tls ? "secureConnection" : "connection", (socket: net.Socket) => {
    departures.push(departure(socket));
  });
  const port = await startProxy(proxy);
  return {
    port,
    requests,
    /** With `tls: true`, the SNI of every handshake the proxy completed. `null` when the client sent none. */
    sni,
    /** One per connection the proxy accepted so far. Each resolves when that connection is gone. */
    departures,
    get connections() {
      return connections;
    },
    [Symbol.dispose]() {
      proxy.close();
    },
  };
}

/** The CONNECT request a client has to send to tunnel to `127.0.0.1:port`. */
export function connectRequest(port: number, headers: Record<string, string> = {}): ConnectRequest {
  return {
    requestLine: `CONNECT 127.0.0.1:${port} HTTP/1.1`,
    headers: { host: `127.0.0.1:${port}`, "proxy-connection": "Keep-Alive", ...headers },
  };
}

/**
 * A wss:// server that answers the upgrade by hand and gives every later chunk
 * to `onFrames`. It never ends a connection on its own.
 */
export async function startRawWssServer(
  onFrames: (socket: tls.TLSSocket, chunk: Buffer) => void = () => {},
  options: tls.TlsOptions = {},
) {
  const departures: Promise<Departure>[] = [];
  const server = tls.createServer({ key: tlsCerts.key, cert: tlsCerts.cert, ...options }, socket => {
    departures.push(departure(socket));
    let request = "";
    let upgraded = false;
    socket.on("data", (chunk: Buffer) => {
      if (upgraded) return onFrames(socket, chunk);
      request += chunk.toString("latin1");
      if (!request.includes("\r\n\r\n")) return;
      upgraded = true;
      const key = /^sec-websocket-key: (.*)\r$/im.exec(request)![1];
      const accept = createHash("sha1")
        .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
        .digest("base64");
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
          `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
      );
    });
  });
  const port = await startProxy(server);
  return {
    port,
    /** One per connection the server accepted so far. Each resolves when that connection is gone. */
    departures,
    [Symbol.dispose]() {
      server.close();
    },
  };
}

/** One frame as an endpoint wrote it. */
export interface WireFrame {
  fin: boolean;
  rsv1: boolean;
  opcode: number;
  payload: Buffer;
}

/**
 * One unmasked frame, as a server writes it. `declaredLength` is for the
 * header of a frame whose payload never comes (or comes short).
 */
export function serverFrame(
  opcode: number,
  payload: string | Uint8Array = "",
  options: { fin?: boolean; rsv1?: boolean; declaredLength?: number } = {},
): Buffer {
  const body = typeof payload === "string" ? Buffer.from(payload) : Buffer.from(payload);
  const length = options.declaredLength ?? body.length;
  const first = (options.fin === false ? 0 : 0x80) | (options.rsv1 ? 0x40 : 0) | opcode;
  let header: Buffer;
  if (length < 126) {
    header = Buffer.from([first, length]);
  } else if (length < 65536) {
    header = Buffer.from([first, 126, 0, 0]);
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = first;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  return Buffer.concat([header, body]);
}

/** The connection of one client to `startRawWsServer`, after the server answered its upgrade. */
export interface RawWsPeer {
  socket: net.Socket;
  /** The upgrade request as the client wrote it. */
  request: string;
  /** Every frame the client wrote so far, unmasked. */
  frames: WireFrame[];
  /**
   * The status code of the Close frame of the client (1005 for one without a
   * code), or `null` when its connection goes away without one. The server
   * answers that Close frame with the same one and ends the connection.
   */
  closeCode: Promise<number | null>;
  /** How the connection of the client went away. */
  departed: Promise<Departure>;
}

export interface RawWsServerOptions {
  tls?: boolean;
  /** Accept a permessage-deflate offer, with no context takeover on either side. */
  deflate?: boolean;
  /**
   * Writes the 101 response. The default is one write. A test passes this to
   * choose how the bytes of the response, and what follows them, reach the client.
   */
  respond?: (socket: net.Socket, response: Buffer) => void | Promise<void>;
}

/**
 * A ws:// (or wss://) server that answers the upgrade by hand and then runs
 * `onUpgraded`: a test writes every byte the client reads after the 101, and
 * reads every frame the client writes. It uses no WebSocket implementation,
 * so it runs the same way under Node.js.
 */
export async function startRawWsServer(onUpgraded: (peer: RawWsPeer) => void, options: RawWsServerOptions = {}) {
  let connections = 0;
  const onSocket = (socket: net.Socket) => {
    connections++;
    const departed = departure(socket);
    const closeCode = Promise.withResolvers<number | null>();
    departed.then(() => closeCode.resolve(null));
    const frames: WireFrame[] = [];
    let request = "";
    let upgraded = false;
    let pending = Buffer.alloc(0);
    const readFrames = () => {
      for (;;) {
        if (pending.length < 2) return;
        const masked = (pending[1] & 0x80) !== 0;
        let length = pending[1] & 0x7f;
        let offset = 2;
        if (length === 126) {
          if (pending.length < 4) return;
          length = pending.readUInt16BE(2);
          offset = 4;
        } else if (length === 127) {
          if (pending.length < 10) return;
          length = Number(pending.readBigUInt64BE(2));
          offset = 10;
        }
        const mask = masked ? pending.subarray(offset, offset + 4) : null;
        if (masked) offset += 4;
        if (pending.length < offset + length) return;
        const payload = Buffer.from(pending.subarray(offset, offset + length));
        if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
        const frame = {
          fin: (pending[0] & 0x80) !== 0,
          rsv1: (pending[0] & 0x40) !== 0,
          opcode: pending[0] & 0x0f,
          payload,
        };
        pending = pending.subarray(offset + length);
        frames.push(frame);
        if (frame.opcode === 0x8) {
          closeCode.resolve(payload.length >= 2 ? payload.readUInt16BE(0) : 1005);
          socket.end(serverFrame(0x8, payload));
        }
      }
    };
    socket.on("data", (chunk: Buffer) => {
      if (upgraded) {
        pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
        return readFrames();
      }
      request += chunk.toString("latin1");
      const end = request.indexOf("\r\n\r\n");
      if (end === -1) return;
      upgraded = true;
      pending = Buffer.from(request.slice(end + 4), "latin1");
      request = request.slice(0, end + 4);
      const key = /^sec-websocket-key: (.*)\r$/im.exec(request)![1];
      const accept = createHash("sha1")
        .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
        .digest("base64");
      const deflate = options.deflate && /^sec-websocket-extensions: .*permessage-deflate/im.test(request);
      const response = Buffer.from(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
          `Sec-WebSocket-Accept: ${accept}\r\n` +
          (deflate
            ? "Sec-WebSocket-Extensions: permessage-deflate; server_no_context_takeover; client_no_context_takeover\r\n"
            : "") +
          "\r\n",
      );
      const peer: RawWsPeer = { socket, request, frames, closeCode: closeCode.promise, departed };
      Promise.resolve((options.respond ?? ((socket, response) => void socket.write(response)))(socket, response)).then(
        () => {
          onUpgraded(peer);
          readFrames();
        },
      );
    });
  };
  const server = options.tls
    ? tls.createServer({ key: tlsCerts.key, cert: tlsCerts.cert }, onSocket)
    : net.createServer(onSocket);
  const port = await startProxy(server);
  return {
    port,
    url: `${options.tls ? "wss" : "ws"}://127.0.0.1:${port}/`,
    /** How many connections the server accepted so far. */
    get connections() {
      return connections;
    },
    [Symbol.dispose]() {
      server.close();
    },
  };
}

/**
 * A TLS 1.2 wss:// server that renegotiates once: before it answers the upgrade,
 * when the upgrade client owns the connection, or on the client's first frame,
 * when the connected client does. After the client's first frame (and that
 * renegotiation) it sends "after renegotiation". It runs in real node because a
 * BoringSSL server cannot renegotiate, so skip the test when `nodeExe()` is null.
 */
export async function startRenegotiatingWssServer(when: "before the 101" | "after the 101") {
  const server = Bun.spawn({
    cmd: [
      nodeExe()!,
      "-e",
      `
        const tls = require("tls");
        const crypto = require("crypto");
        const server = tls.createServer(
          { cert: process.env.SERVER_CERT, key: process.env.SERVER_KEY, minVersion: "TLSv1.2", maxVersion: "TLSv1.2" },
          socket => {
            socket.on("error", () => {});
            const renegotiate = then =>
              socket.renegotiate({ rejectUnauthorized: false }, err => (err ? socket.destroy(err) : then()));
            const greet = () => {
              const payload = Buffer.from("after renegotiation");
              socket.write(Buffer.concat([Buffer.from([0x81, payload.length]), payload]));
            };
            let head = "";
            const onHead = chunk => {
              head += chunk.toString("latin1");
              if (!head.includes("\\r\\n\\r\\n")) return;
              socket.off("data", onHead);
              const key = /sec-websocket-key:\\s*(\\S+)/i.exec(head)[1];
              const accept = crypto.createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
              const answer = () =>
                socket.write(
                  "HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\n" +
                    "Sec-WebSocket-Accept: " + accept + "\\r\\n\\r\\n",
                );
              if (process.env.WHEN === "before the 101") {
                socket.once("data", greet);
                renegotiate(answer);
              } else {
                socket.once("data", () => renegotiate(greet));
                answer();
              }
            };
            socket.on("data", onHead);
          },
        );
        server.listen(0, "127.0.0.1", () => console.log(server.address().port));
      `,
    ],
    stdout: "pipe",
    stderr: "inherit",
    stdin: "ignore",
    env: { ...bunEnv, WHEN: when, SERVER_CERT: tlsCerts.cert, SERVER_KEY: tlsCerts.key },
  });
  const { value } = await server.stdout.getReader().read();
  return {
    port: Number(new TextDecoder().decode(value).trim()),
    [Symbol.asyncDispose]: () => server[Symbol.asyncDispose](),
  };
}

/** A WebSocket echo server. It greets each client with "connected", then echoes every message. */
export function startEchoServer(options: { tls?: boolean } = {}) {
  return Bun.serve({
    port: 0,
    ...(options.tls ? { tls: { key: tlsCerts.key, cert: tlsCerts.cert } } : {}),
    fetch(req, server) {
      if (server.upgrade(req)) return;
      return new Response("Expected WebSocket", { status: 400 });
    },
    websocket: {
      open(ws) {
        ws.send("connected");
      },
      message(ws, message) {
        ws.send(message);
      },
    },
  });
}

export type ClientEvent = string | { error: string } | { code: number; reason: string; wasClean: boolean };

/**
 * Everything the client observes, in order: each message as a string, each
 * error event as `{ error }` and the close event last. Resolves on close.
 */
export function clientEvents(ws: WebSocket): Promise<ClientEvent[]> {
  const events: ClientEvent[] = [];
  const { promise, resolve } = Promise.withResolvers<ClientEvent[]>();
  ws.addEventListener("message", event => {
    events.push(String(event.data));
  });
  ws.addEventListener("error", event => {
    events.push({ error: (event as ErrorEvent).message });
  });
  ws.addEventListener("close", event => {
    events.push({ code: event.code, reason: event.reason, wasClean: event.wasClean });
    resolve(events);
  });
  return promise;
}

/**
 * Sends `message` once open and closes after the echo arrives. A working
 * tunnel to an echo server produces `echoed(message)`.
 */
export function echoSession(ws: WebSocket, message: string): Promise<ClientEvent[]> {
  ws.addEventListener("open", () => ws.send(message));
  ws.addEventListener("message", event => {
    if (String(event.data) === message) ws.close(1000);
  });
  return clientEvents(ws);
}

/**
 * For a connection that must fail: should it open after all, it is closed at
 * once so the assertion reports the open instead of the test timing out.
 */
export function failingSession(ws: WebSocket): Promise<ClientEvent[]> {
  ws.addEventListener("open", () => ws.close(1000));
  return clientEvents(ws);
}

/** The echo server greets first, echoes the message, then the client closes cleanly. */
export function echoed(message: string): ClientEvent[] {
  return ["connected", message, { code: 1000, reason: "", wasClean: true }];
}

/** A connection the proxy refused, or whose TLS handshake with the proxy failed. */
export function failed(url: string, reason: string, code: number): ClientEvent[] {
  return [
    { error: `WebSocket connection to '${new URL(url).href}' failed: ${reason}` },
    { code, reason, wasClean: false },
  ];
}
