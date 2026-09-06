import { afterAll, describe, expect, test } from "bun:test";
import { tls as tlsCerts } from "harness";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import tls from "node:tls";
import { clientEvents, startRecordingProxy } from "./proxy-test-utils";

// NO_PROXY applies to explicit proxies too. An ambient
// NO_PROXY=localhost,127.0.0.1,... would bypass the proxy tests below.
const prevNoProxy = process.env.NO_PROXY;
const prevNoProxyLower = process.env.no_proxy;
process.env.NO_PROXY = "";
process.env.no_proxy = "";
afterAll(() => {
  if (prevNoProxy === undefined) delete process.env.NO_PROXY;
  else process.env.NO_PROXY = prevNoProxy;
  if (prevNoProxyLower === undefined) delete process.env.no_proxy;
  else process.env.no_proxy = prevNoProxyLower;
});

// A TLS server that records the SNI of every handshake and answers one
// WebSocket upgrade per connection. The harness certificate has CN=server-bun
// and SAN DNS:localhost, IP:127.0.0.1, IP:::1.
function startSniServer() {
  const sni: (string | null)[] = [];
  const server = tls.createServer(
    {
      key: tlsCerts.key,
      cert: tlsCerts.cert,
      SNICallback(servername, cb) {
        sni.push(servername);
        cb(null, tls.createSecureContext({ key: tlsCerts.key, cert: tlsCerts.cert }));
      },
    },
    socket => {
      let buffered = "";
      socket.on("data", chunk => {
        buffered += chunk.toString("latin1");
        const end = buffered.indexOf("\r\n\r\n");
        if (end === -1) return;
        const key = buffered
          .slice(0, end)
          .split("\r\n")
          .find(line => line.toLowerCase().startsWith("sec-websocket-key:"))
          ?.split(":", 2)[1]
          .trim();
        if (!key) {
          socket.end("HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n");
          return;
        }
        const accept = createHash("sha1")
          .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
          .digest("base64");
        socket.write(
          "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
            `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
        );
        buffered = "";
      });
      socket.on("error", () => {});
    },
  );
  // A handshake with no server_name extension never reaches SNICallback.
  server.on("secureConnection", socket => {
    if (!socket.servername) sni.push(null);
  });
  const { promise, resolve } = Promise.withResolvers<number>();
  server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
  return {
    port: promise,
    sni,
    [Symbol.dispose]() {
      server.close();
    },
  };
}

function openSession(ws: WebSocket) {
  ws.addEventListener("open", () => ws.close(1000));
  return clientEvents(ws);
}

const opened = [{ code: 1000, reason: "", wasClean: true }];
const tlsFailed = (url: string) => [
  { error: `WebSocket connection to '${url}' failed: TLS handshake failed` },
  { code: 1015, reason: "TLS handshake failed", wasClean: false },
];

describe.concurrent("WebSocket tls.serverName", () => {
  // `servername` is the node spelling of the same option.
  test.each(["serverName", "servername"] as const)(
    "%s is sent as SNI when the URL host is an IP address",
    async key => {
      using server = startSniServer();
      const url = `wss://127.0.0.1:${await server.port}/`;
      const ws = new WebSocket(url, { tls: { ca: tlsCerts.cert, [key]: "localhost" } });
      expect(await openSession(ws)).toEqual(opened);
      expect(server.sni).toEqual(["localhost"]);
    },
  );

  test("is the name the certificate is verified against", async () => {
    using server = startSniServer();
    const url = `wss://127.0.0.1:${await server.port}/`;
    // 127.0.0.1 is in the SAN, evil.test is not. Without serverName this would open.
    const ws = new WebSocket(url, { tls: { ca: tlsCerts.cert, serverName: "evil.test" } });
    expect(await openSession(ws)).toEqual(tlsFailed(url));
    expect(server.sni).toEqual(["evil.test"]);
  });

  test("is used for the tunnel handshake through an HTTP proxy", async () => {
    using server = startSniServer();
    using proxy = await startRecordingProxy();
    const url = `wss://127.0.0.1:${await server.port}/`;
    const ws = new WebSocket(url, {
      proxy: `http://127.0.0.1:${proxy.port}`,
      tls: { ca: tlsCerts.cert, serverName: "localhost" },
    });
    expect(await openSession(ws)).toEqual(opened);
    expect(server.sni).toEqual(["localhost"]);
    expect(proxy.requests).toHaveLength(1);
  });
});

describe.concurrent("WebSocket tls.checkServerIdentity", () => {
  test("is called with the hostname and the peer certificate", async () => {
    using server = startSniServer();
    const url = `wss://localhost:${await server.port}/`;
    const calls: { hostname: string; subject: string; altnames: string }[] = [];
    const ws = new WebSocket(url, {
      tls: {
        ca: tlsCerts.cert,
        checkServerIdentity(hostname: string, cert: tls.PeerCertificate) {
          calls.push({ hostname, subject: cert.subject.CN, altnames: cert.subjectaltname });
          return undefined;
        },
      },
    });
    expect(await openSession(ws)).toEqual(opened);
    expect(calls).toEqual([
      {
        hostname: "localhost",
        subject: "server-bun",
        altnames: "DNS:localhost, IP Address:127.0.0.1, IP Address:0:0:0:0:0:0:0:1",
      },
    ]);
  });

  test("rejects the connection when it returns an Error", async () => {
    using server = startSniServer();
    const url = `wss://localhost:${await server.port}/`;
    let calls = 0;
    const ws = new WebSocket(url, {
      tls: {
        ca: tlsCerts.cert,
        checkServerIdentity() {
          calls++;
          return new Error("PIN-REJECT");
        },
      },
    });
    expect(await openSession(ws)).toEqual(tlsFailed(url));
    expect(calls).toBe(1);
  });

  test("rejects the connection when it throws", async () => {
    using server = startSniServer();
    const url = `wss://localhost:${await server.port}/`;
    const ws = new WebSocket(url, {
      tls: {
        ca: tlsCerts.cert,
        checkServerIdentity() {
          throw new Error("PIN-REJECT");
        },
      },
    });
    expect(await openSession(ws)).toEqual(tlsFailed(url));
  });

  test("may close the WebSocket from inside the callback", async () => {
    using server = startSniServer();
    const url = `wss://localhost:${await server.port}/`;
    const ws = new WebSocket(url, {
      tls: {
        ca: tlsCerts.cert,
        checkServerIdentity() {
          ws.close(1000, "pinned out");
          return undefined;
        },
      },
    });
    const reason = "WebSocket is closed before the connection is established";
    expect(await clientEvents(ws)).toEqual([
      { error: `WebSocket connection to '${url}' failed: ${reason}` },
      { code: 1006, reason, wasClean: false },
    ]);
  });

  test("replaces the built-in hostname check, like fetch", async () => {
    using server = startSniServer();
    const url = `wss://127.0.0.1:${await server.port}/`;
    const calls: string[] = [];
    // evil.test is not in the SAN. The callback approves it anyway.
    const ws = new WebSocket(url, {
      tls: {
        ca: tlsCerts.cert,
        serverName: "evil.test",
        checkServerIdentity(hostname: string) {
          calls.push(hostname);
          return undefined;
        },
      },
    });
    expect(await openSession(ws)).toEqual(opened);
    expect(calls).toEqual(["evil.test"]);
  });

  test("is called for the target certificate through an HTTP proxy", async () => {
    using server = startSniServer();
    using proxy = await startRecordingProxy();
    const url = `wss://localhost:${await server.port}/`;
    const calls: string[] = [];
    const ws = new WebSocket(url, {
      proxy: `http://127.0.0.1:${proxy.port}`,
      tls: {
        ca: tlsCerts.cert,
        checkServerIdentity(hostname: string) {
          calls.push(hostname);
          return new Error("PIN-REJECT");
        },
      },
    });
    expect(await openSession(ws)).toEqual(tlsFailed(url));
    expect(calls).toEqual(["localhost"]);
    expect(proxy.requests).toHaveLength(1);
  });

  test("is not called for the certificate of an HTTPS proxy", async () => {
    using server = startSniServer();
    using proxy = await startRecordingProxy({ tls: true });
    const url = `wss://localhost:${await server.port}/`;
    const calls: string[] = [];
    // The proxy presents the harness certificate too. The built-in check
    // verifies it against 127.0.0.1; the callback sees only the target.
    const ws = new WebSocket(url, {
      proxy: `https://127.0.0.1:${proxy.port}`,
      tls: {
        ca: tlsCerts.cert,
        checkServerIdentity(hostname: string) {
          calls.push(hostname);
          return undefined;
        },
      },
    });
    expect(await openSession(ws)).toEqual(opened);
    expect(calls).toEqual(["localhost"]);
    expect(proxy.requests).toHaveLength(1);
  });
});
