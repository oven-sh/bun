/**
 * Shared utilities for the WebSocket proxy tests: websocket-proxy.test.ts,
 * ws-proxy.test.ts and websocket-syscall-fault.test.ts.
 */

import { tls as tlsCerts } from "harness";
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

    clientSocket.on("data", data => {
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
        targetSocket!.on("data", chunk => {
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

/**
 * Starts a CONNECT proxy for one test and records every connection it accepts
 * and every CONNECT request it reads, so a test can assert what the client
 * sent to the proxy and not only that the tunnel came up. Dispose to close it.
 */
export async function startRecordingProxy(options: ConnectProxyOptions = {}) {
  const requests: ConnectRequest[] = [];
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
  const port = await startProxy(proxy);
  return {
    port,
    requests,
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
