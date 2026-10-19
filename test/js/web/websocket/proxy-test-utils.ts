/**
 * Shared utilities for the WebSocket proxy tests: websocket-proxy.test.ts,
 * ws-proxy.test.ts and websocket-syscall-fault.test.ts.
 */

import { afterAll, beforeAll, expect } from "bun:test";
import { bunEnv, nodeExe, tls as tlsCerts } from "harness";
import { createHash } from "crypto";
import net from "net";
import tls from "tls";
import { createPeer, encodeFrame, OP, response101 } from "./raw-peer";

/**
 * NO_PROXY applies to explicit proxies too. An ambient NO_PROXY=localhost,127.0.0.1,... would bypass
 * the proxy tests in the calling describe block (or file).
 */
export function ignoreAmbientNoProxy() {
  const prevNoProxy = process.env.NO_PROXY;
  const prevNoProxyLower = process.env.no_proxy;
  beforeAll(() => {
    process.env.NO_PROXY = "";
    process.env.no_proxy = "";
  });
  afterAll(() => {
    if (prevNoProxy === undefined) delete process.env.NO_PROXY;
    else process.env.NO_PROXY = prevNoProxy;
    if (prevNoProxyLower === undefined) delete process.env.no_proxy;
    else process.env.no_proxy = prevNoProxyLower;
  });
}

/** One CONNECT request as the proxy read it. Header names are lowercased. */
export interface ConnectRequest {
  requestLine: string;
  headers: Record<string, string>;
}

export interface ConnectProxyOptions {
  requireAuth?: boolean;
  /** Terminate TLS in front of the proxy (an HTTPS proxy), with the harness certificate. */
  tls?: boolean;
  /** Extra options for that TLS server, e.g. `requestCert`. */
  tlsOptions?: tls.TlsOptions;
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
    ? tls.createServer({ key: tlsCerts.key, cert: tlsCerts.cert, ...options.tlsOptions }, onClient)
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
  const clientCertificates: (string | null)[] = [];
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
    clientCertificates.push((socket.getPeerCertificate().subject?.CN as string | undefined) ?? null);
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
    /** With `requestCert`, the CN of the client certificate of every handshake. `null` when the client sent none. */
    clientCertificates,
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

export const TLS_RECORD = { changeCipherSpec: 20, alert: 21, handshake: 22, applicationData: 23 } as const;

/** The types of the complete TLS records in `bytes`, and how many bytes are left over behind them. */
export function tlsRecords(bytes: Buffer) {
  const types: number[] = [];
  let offset = 0;
  while (offset + 5 <= bytes.length) {
    const next = offset + 5 + bytes.readUInt16BE(offset + 3);
    if (next > bytes.length) break;
    types.push(bytes[offset]);
    offset = next;
  }
  return { types, trailing: bytes.length - offset };
}

/**
 * An `onTargetData` for a proxy with one connection. After `hold()`, it waits for `count` complete TLS
 * records from the target and forwards them in one write, so the client decrypts them in one read.
 * With `firstType`, it counts from the first record of that type and lets the records before it pass.
 */
export function forwardRecordsTogether(count: number, firstType?: number) {
  let held: Buffer | null = null;
  let holding = false;
  const forwarded: ReturnType<typeof tlsRecords>[] = [];
  return {
    /** What each write to the client carried since `hold()`. */
    forwarded,
    hold() {
      held = Buffer.alloc(0);
      holding = true;
    },
    onTargetData(chunk: Buffer, forward: (bytes: Buffer) => void) {
      const write = (bytes: Buffer) => {
        if (bytes.length === 0) return;
        if (holding) forwarded.push(tlsRecords(bytes));
        forward(bytes);
      };
      if (held === null) return write(chunk);

      held = Buffer.concat([held, chunk]);
      const { types, trailing } = tlsRecords(held);
      const records = held.subarray(0, held.length - trailing);
      const partialRecord = held.subarray(records.length);
      const first = firstType === undefined ? 0 : types.indexOf(firstType);
      if (first === -1) {
        held = partialRecord;
        write(records);
      } else if (types.length - first >= count) {
        held = null;
        write(records);
        write(partialRecord);
      }
    },
  };
}

/**
 * A wss:// origin that sends `messages` in the same write as the 101. What stands in front of it, a CONNECT
 * proxy or for "direct" a plain forwarder, puts a TLS record that can't be decrypted behind them, in the
 * same write to the client. Connect to `url`, through `proxy` if there is one.
 */
export async function startOriginWithCorruptRecord(route: "direct" | "http" | "https", messages: string[]) {
  const response = forwardRecordsTogether(1);
  const origin = await createPeer({
    secure: true,
    // A TLS 1.3 server can send session tickets right before the response.
    tls: { maxVersion: "TLSv1.2" },
    respond(connection) {
      response.hold();
      return response101(connection);
    },
    afterUpgrade: Buffer.concat(messages.map(message => encodeFrame(OP.text, message))),
  });
  const corruptRecord = Buffer.from([TLS_RECORD.applicationData, 3, 3, 0, 20, ...Buffer.alloc(20, 7)]);
  const onTargetData = (chunk: Buffer, forward: (bytes: Buffer) => void) =>
    response.onTargetData(chunk, bytes =>
      forward(response.forwarded.length === 1 ? Buffer.concat([bytes, corruptRecord]) : bytes),
    );
  const hop =
    route === "direct"
      ? net.createServer(client => {
          const target = net.connect(origin.port, "127.0.0.1");
          client.on("data", chunk => target.write(chunk));
          target.on("data", chunk => onTargetData(chunk, bytes => client.write(bytes)));
          client.on("error", () => {}).on("close", () => target.destroy());
          target.on("error", () => {}).on("close", () => client.destroy());
        })
      : createConnectProxy({ tls: route === "https", onTargetData });
  const port = await startProxy(hop);
  return {
    url: route === "direct" ? `wss://127.0.0.1:${port}` : origin.url,
    proxy: route === "direct" ? undefined : `${route}://127.0.0.1:${port}`,
    async [Symbol.asyncDispose]() {
      hop.close();
      await origin[Symbol.asyncDispose]();
    },
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

/**
 * A TLS 1.2 wss:// server that renegotiates once: before it answers the upgrade,
 * when the upgrade client owns the connection, or on the client's first frame,
 * when the connected client does. After the client's first frame (and that
 * renegotiation) it sends "after renegotiation", then replies to the client's next
 * frame (its Close frame) with Close 1000. With "behind a message" it sends
 * "renegotiating" right before it asks for the renegotiation, and echoes one more
 * short frame after "after renegotiation". It runs in real node because a
 * BoringSSL server cannot renegotiate, so skip the test when `nodeExe()` is null.
 */
export async function startRenegotiatingWssServer(when: "before the 101" | "after the 101" | "behind a message") {
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
            const send = payload => socket.write(Buffer.concat([Buffer.from([0x81, payload.length]), Buffer.from(payload)]));
            const closeOnNextFrame = () => socket.once("data", () => socket.end(Buffer.from([0x88, 0x02, 0x03, 0xe8])));
            const greet = () => {
              send("after renegotiation");
              closeOnNextFrame();
            };
            const greetThenEcho = () => {
              send("after renegotiation");
              socket.once("data", frame => {
                send(frame.subarray(6).map((byte, i) => byte ^ frame[2 + (i % 4)]));
                closeOnNextFrame();
              });
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
              } else if (process.env.WHEN === "behind a message") {
                socket.once("data", () => {
                  send("renegotiating");
                  renegotiate(greetThenEcho);
                });
                answer();
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
 * Resolves with "open", or with the `error` event's message without the "... failed: " prefix. With
 * `until: "message"`, waits for the first message and resolves with its data. Terminates `ws` afterwards.
 */
export function openOrFailure(ws: WebSocket, until: "open" | "message" = "open"): Promise<string> {
  const { promise, resolve } = Promise.withResolvers<string>();
  ws.addEventListener(until, event => resolve(until === "open" ? "open" : String((event as MessageEvent).data)));
  ws.addEventListener("error", event =>
    resolve((event as ErrorEvent).message.replace(/^WebSocket connection to '[^']*' failed: /, "")),
  );
  ws.addEventListener("close", event => resolve(`close ${event.code} ${event.reason}`));
  return promise.finally(() => ws.terminate());
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

/**
 * Events of a connection that failed before it opened, e.g. the proxy rejected it or a TLS
 * handshake failed. The error message is only matched up to `reason`, because TLS libraries
 * append their own details.
 */
export function failed(url: string, reason: string): ClientEvent[] {
  return [
    { error: expect.stringContaining(`WebSocket connection to '${new URL(url).href}' failed: ${reason}`) },
    { code: 1006, reason: "", wasClean: false },
  ];
}
