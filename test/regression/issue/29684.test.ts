// https://github.com/oven-sh/bun/issues/29684
//
// ws default is to advertise `Sec-WebSocket-Extensions: permessage-deflate;
// client_max_window_bits` on the upgrade request. With `perMessageDeflate:
// false`, both upstream `ws` and Node.js suppress the extension offer. Bun
// was ignoring the option and always sending the header, which broke some
// gateway paths.
import { describe, expect, it } from "bun:test";
import crypto from "node:crypto";
import { AddressInfo, connect, createServer as createNetServer } from "node:net";
import WebSocket from "ws";

// Listen on a raw TCP socket, capture the WebSocket upgrade request bytes,
// complete a minimal RFC 6455 handshake so the client opens, and resolve
// with the request line + headers.
function captureUpgradeRequest(connectClient: (url: string) => void): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  let accepted: import("net").Socket | undefined;

  const server = createNetServer(socket => {
    accepted = socket;
    let buf = Buffer.alloc(0);
    socket.on("data", chunk => {
      buf = Buffer.concat([buf, chunk]);
      const end = buf.indexOf("\r\n\r\n");
      if (end === -1) return;

      const request = buf.subarray(0, end).toString("utf8");
      const headerLines = request.split("\r\n");
      const keyLine = headerLines.find(l => l.toLowerCase().startsWith("sec-websocket-key:"));
      if (!keyLine) {
        socket.destroy();
        reject(new Error("client did not send Sec-WebSocket-Key"));
        return;
      }
      const key = keyLine.slice(keyLine.indexOf(":") + 1).trim();
      const accept = crypto
        .createHash("sha1")
        .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
        .digest("base64");

      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
      );
      resolve(request);
    });
    socket.on("error", reject);
  });

  server.listen(0, "127.0.0.1", () => {
    const { port } = server.address() as AddressInfo;
    connectClient(`ws://127.0.0.1:${port}/`);
  });

  // `server.close()` only stops listening — the accepted connection keeps
  // the event loop alive until the client's close timeout fires. Destroy it
  // explicitly so the test doesn't leak a socket on slower runners.
  return promise.finally(() => {
    accepted?.destroy();
    server.close();
  });
}

describe("perMessageDeflate upgrade header", () => {
  it("omits Sec-WebSocket-Extensions when perMessageDeflate is false", async () => {
    const request = await captureUpgradeRequest(url => {
      const ws = new WebSocket(url, { perMessageDeflate: false });
      ws.on("open", () => ws.close());
      ws.on("error", () => {});
    });
    expect(request.toLowerCase()).not.toContain("sec-websocket-extensions");
  });

  it("still sends Sec-WebSocket-Extensions when perMessageDeflate is unset", async () => {
    const request = await captureUpgradeRequest(url => {
      const ws = new WebSocket(url);
      ws.on("open", () => ws.close());
      ws.on("error", () => {});
    });
    expect(request).toContain("Sec-WebSocket-Extensions: permessage-deflate; client_max_window_bits");
  });

  it("omits Sec-WebSocket-Extensions for native WebSocket with perMessageDeflate: false", async () => {
    const request = await captureUpgradeRequest(url => {
      // globalThis.WebSocket is Bun's native client, separate from the `ws`
      // package's BunWebSocket wrapper — verify the option is threaded all
      // the way through to the native upgrade builder.
      const ws = new (globalThis as any).WebSocket(url, { perMessageDeflate: false });
      ws.addEventListener("open", () => ws.close());
      ws.addEventListener("error", () => {});
    });
    expect(request.toLowerCase()).not.toContain("sec-websocket-extensions");
  });

  // npm ws uses a truthy check after merging defaults (`const opts = { perMessageDeflate: true, ...options }`),
  // so any own-key falsy value — not just literal `false` — suppresses the extension offer.
  it.each([null, 0, "", undefined] as const)(
    "omits Sec-WebSocket-Extensions for perMessageDeflate: %p",
    async falsy => {
      const request = await captureUpgradeRequest(url => {
        const ws = new WebSocket(url, { perMessageDeflate: falsy as unknown as boolean });
        ws.on("open", () => ws.close());
        ws.on("error", () => {});
      });
      expect(request.toLowerCase()).not.toContain("sec-websocket-extensions");
    },
  );

  it("keeps the offer when perMessageDeflate is truthy (e.g. empty object)", async () => {
    const request = await captureUpgradeRequest(url => {
      const ws = new WebSocket(url, { perMessageDeflate: {} });
      ws.on("open", () => ws.close());
      ws.on("error", () => {});
    });
    expect(request).toContain("Sec-WebSocket-Extensions: permessage-deflate; client_max_window_bits");
  });

  // ws merges with `...options`, which only spreads own enumerable properties.
  // An inherited `perMessageDeflate: false` on the prototype must not disable
  // the offer — otherwise a caller accidentally using an object with Options
  // on its prototype would get surprisingly different wire bytes.
  it("ignores prototype-only perMessageDeflate properties", async () => {
    const request = await captureUpgradeRequest(url => {
      const options = Object.create({ perMessageDeflate: false });
      const ws = new WebSocket(url, options);
      ws.on("open", () => ws.close());
      ws.on("error", () => {});
    });
    expect(request).toContain("Sec-WebSocket-Extensions: permessage-deflate; client_max_window_bits");
  });

  // Per RFC 6455 §9.1 (and npm ws), accepting a server-advertised extension we
  // didn't offer is a protocol violation. Fail the handshake with an error
  // event instead of completing the upgrade with compression silently enabled.
  it("rejects a Sec-WebSocket-Extensions response when we did not offer it", async () => {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    let accepted: import("net").Socket | undefined;

    const server = createNetServer(socket => {
      accepted = socket;
      let buf = Buffer.alloc(0);
      socket.on("data", chunk => {
        buf = Buffer.concat([buf, chunk]);
        const end = buf.indexOf("\r\n\r\n");
        if (end === -1) return;
        const headerLines = buf.subarray(0, end).toString("utf8").split("\r\n");
        const keyLine = headerLines.find(l => l.toLowerCase().startsWith("sec-websocket-key:"))!;
        const key = keyLine.slice(keyLine.indexOf(":") + 1).trim();
        const accept = crypto
          .createHash("sha1")
          .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
          .digest("base64");

        // Server erroneously returns permessage-deflate even though client
        // opted out via `perMessageDeflate: false` → should fail handshake.
        socket.write(
          "HTTP/1.1 101 Switching Protocols\r\n" +
            "Upgrade: websocket\r\n" +
            "Connection: Upgrade\r\n" +
            `Sec-WebSocket-Accept: ${accept}\r\n` +
            "Sec-WebSocket-Extensions: permessage-deflate\r\n\r\n",
        );
      });
      socket.on("error", () => {});
    });

    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      const ws = new WebSocket(`ws://127.0.0.1:${port}/`, { perMessageDeflate: false });
      ws.on("open", () => reject(new Error("handshake should have failed")));
      ws.on("error", () => resolve());
      ws.on("close", () => {
        // If close fires before error, resolve — the handshake was aborted.
        resolve();
      });
    });

    try {
      await promise;
    } finally {
      accepted?.destroy();
      server.close();
    }
  });

  // Protect the proxy plumbing: the flag has to thread through the proxied
  // WebSocket code path too (CONNECT tunnel → upgrade). The proxy server
  // accepts CONNECT, bridges it to the upgrade server, and the upgrade server
  // captures the tunneled upgrade request bytes — which must match what the
  // direct path produces.
  it("suppresses Sec-WebSocket-Extensions through an HTTP CONNECT proxy", async () => {
    const { promise, resolve, reject } = Promise.withResolvers<string>();
    let acceptedUpstream: import("net").Socket | undefined;
    let acceptedDownstream: import("net").Socket | undefined;

    // Upgrade server: same handshake logic as captureUpgradeRequest.
    const upgrade = createNetServer(socket => {
      acceptedUpstream = socket;
      let buf = Buffer.alloc(0);
      socket.on("data", chunk => {
        buf = Buffer.concat([buf, chunk]);
        const end = buf.indexOf("\r\n\r\n");
        if (end === -1) return;
        const request = buf.subarray(0, end).toString("utf8");
        const keyLine = request.split("\r\n").find(l => l.toLowerCase().startsWith("sec-websocket-key:"))!;
        const key = keyLine.slice(keyLine.indexOf(":") + 1).trim();
        const accept = crypto
          .createHash("sha1")
          .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
          .digest("base64");
        socket.write(
          "HTTP/1.1 101 Switching Protocols\r\n" +
            "Upgrade: websocket\r\n" +
            "Connection: Upgrade\r\n" +
            `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
        );
        resolve(request);
      });
      socket.on("error", reject);
    });
    await new Promise<void>(r => upgrade.listen(0, "127.0.0.1", r));
    const upgradePort = (upgrade.address() as AddressInfo).port;

    // CONNECT proxy: accept `CONNECT host:port HTTP/1.1`, reply 200, then pipe
    // the client socket to a fresh TCP connection to the upgrade server. Any
    // WebSocket upgrade bytes the client writes after the 200 response flow
    // through the pipe and hit `upgrade`'s data handler above.
    const proxy = createNetServer(socket => {
      acceptedDownstream = socket;
      let head = Buffer.alloc(0);
      socket.on("data", chunk => {
        head = Buffer.concat([head, chunk]);
        const end = head.indexOf("\r\n\r\n");
        if (end === -1) return;
        const connectLine = head.subarray(0, end).toString("utf8").split("\r\n")[0];
        if (!connectLine.startsWith("CONNECT ")) {
          socket.destroy();
          reject(new Error(`expected CONNECT, got ${connectLine}`));
          return;
        }
        const upstream = connect(upgradePort, "127.0.0.1", () => {
          socket.write("HTTP/1.1 200 OK\r\n\r\n");
          const leftover = head.subarray(end + 4);
          if (leftover.length > 0) upstream.write(leftover);
          socket.pipe(upstream);
          upstream.pipe(socket);
        });
        upstream.on("error", err => socket.destroy(err));
        socket.on("error", err => upstream.destroy(err));
      });
    });
    await new Promise<void>(r => proxy.listen(0, "127.0.0.1", r));
    const proxyPort = (proxy.address() as AddressInfo).port;

    try {
      const ws = new WebSocket(`ws://127.0.0.1:${upgradePort}/`, {
        proxy: `http://127.0.0.1:${proxyPort}`,
        perMessageDeflate: false,
      });
      ws.on("open", () => ws.close());
      ws.on("error", () => {});
      const request = await promise;
      expect(request.toLowerCase()).not.toContain("sec-websocket-extensions");
    } finally {
      acceptedUpstream?.destroy();
      acceptedDownstream?.destroy();
      upgrade.close();
      proxy.close();
    }
  });
});
