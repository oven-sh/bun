/**
 * Shared utilities for WebSocket proxy tests.
 * Used by both websocket-proxy.test.ts and ws-proxy.test.ts
 */

import { tls as tlsCerts } from "harness";
import net from "net";
import tls from "tls";

export interface ConnectProxyOptions {
  requireAuth?: boolean;
}

/**
 * Create an HTTP CONNECT proxy server using Node's net module.
 * This proxy handles the CONNECT method to establish tunnels for WebSocket connections.
 */
export function createConnectProxy(options: ConnectProxyOptions = {}): net.Server {
  return net.createServer(clientSocket => {
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
        targetSocket!.on("data", chunk => {
          clientSocket.write(chunk);
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
  });
}

/**
 * Create an HTTPS CONNECT proxy server using Node's tls module.
 * This proxy handles TLS-encrypted CONNECT tunnels.
 */
export function createTLSConnectProxy(): tls.Server {
  return tls.createServer(
    {
      key: tlsCerts.key,
      cert: tlsCerts.cert,
    },
    clientSocket => {
      let buffer = Buffer.alloc(0);
      let tunnelEstablished = false;
      let targetSocket: net.Socket | null = null;

      clientSocket.on("data", data => {
        if (tunnelEstablished && targetSocket) {
          targetSocket.write(data);
          return;
        }

        buffer = Buffer.concat([buffer, data]);
        const bufferStr = buffer.toString();

        const headerEnd = bufferStr.indexOf("\r\n\r\n");
        if (headerEnd === -1) return;

        const headerPart = bufferStr.substring(0, headerEnd);
        const lines = headerPart.split("\r\n");
        const requestLine = lines[0];

        const match = requestLine.match(/^CONNECT\s+([^:]+):(\d+)\s+HTTP/);
        if (!match) {
          clientSocket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
          clientSocket.end();
          return;
        }

        const [, targetHost, targetPort] = match;
        const remainingData = buffer.subarray(headerEnd + 4);

        targetSocket = net.connect(parseInt(targetPort), targetHost, () => {
          clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          tunnelEstablished = true;

          if (remainingData.length > 0) {
            targetSocket!.write(remainingData);
          }

          targetSocket!.on("data", chunk => {
            clientSocket.write(chunk);
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
    },
  );
}

/**
 * Helper to start a proxy server and get its port.
 */
export async function startProxy(server: net.Server | tls.Server): Promise<number> {
  return new Promise<number>(resolve => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as net.AddressInfo;
      resolve(addr.port);
    });
  });
}
