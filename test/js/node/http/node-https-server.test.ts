import { describe, expect, test } from "bun:test";
import { tls as validCert } from "harness";
import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import net from "node:net";
import tls from "node:tls";

function listen(server: http.Server): Promise<number> {
  const { promise, resolve, reject } = Promise.withResolvers<number>();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
  return promise;
}

// Speaks bare HTTP/1.1 at `port` and resolves with everything the server wrote
// back before the connection ended.
function plaintextRequest(port: number): Promise<string> {
  const { promise, resolve } = Promise.withResolvers<string>();
  let received = "";
  const socket = net.connect(port, "127.0.0.1", () => {
    socket.write("GET /secret HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
  });
  socket.on("data", chunk => (received += chunk));
  // A TLS listener answers cleartext bytes with an alert and hangs up, so an
  // 'error' (ECONNRESET) is as valid an outcome here as a clean 'close'.
  socket.on("error", () => resolve(received));
  socket.on("close", () => resolve(received));
  return promise;
}

function tlsHandshake(port: number): Promise<{ connected: boolean; code?: string }> {
  const { promise, resolve } = Promise.withResolvers<{ connected: boolean; code?: string }>();
  const socket = tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false }, () => {
    socket.destroy();
    resolve({ connected: true });
  });
  socket.on("error", (err: NodeJS.ErrnoException) => resolve({ connected: false, code: err.code }));
  return promise;
}

// An https.Server with no key/cert must still be a TLS listener, never a cleartext one.
describe("https.Server with no key and no cert", () => {
  const shapes: Array<[string, (handler: http.RequestListener) => http.Server]> = [
    ["createServer(requestListener)", handler => https.createServer(handler)],
    ["createServer({}, requestListener)", handler => https.createServer({}, handler)],
    ["createServer(undefined, requestListener)", handler => https.createServer(undefined, handler)],
    ["new https.Server({}, requestListener)", handler => new https.Server({}, handler)],
  ];

  describe.each(shapes)("%s", (_label, createServer) => {
    test("never answers a cleartext HTTP request", async () => {
      let requestHandlerRan = false;
      await using server = createServer((_req, res) => {
        requestHandlerRan = true;
        res.end("SECRET");
      });
      const port = await listen(server);

      expect(await plaintextRequest(port)).toBe("");
      expect(requestHandlerRan).toBe(false);
    });

    test("is a TLS listener, so every handshake fails", async () => {
      await using server = createServer((_req, res) => res.end("SECRET"));
      const port = await listen(server);

      const result = await tlsHandshake(port);
      expect(result.connected).toBe(false);
      // A cleartext listener would yield ERR_SSL_WRONG_VERSION_NUMBER here.
      expect(result.code).toContain("_ALERT_");
    });
  });
});

test("https.createServer() with a key and cert still serves over TLS", async () => {
  await using server = https.createServer({ ...validCert }, (_req, res) => res.end("ok"));
  const port = await listen(server);

  const response = await fetch(`https://127.0.0.1:${port}/`, { tls: { rejectUnauthorized: false } });
  expect(await response.text()).toBe("ok");
  expect(response.status).toBe(200);
});

test("https.createServer() with a key and cert does not answer cleartext", async () => {
  await using server = https.createServer({ ...validCert }, (_req, res) => res.end("SECRET"));
  const port = await listen(server);

  expect(await plaintextRequest(port)).toBe("");
});

// Only node:https forces the TLS path on. http.createServer() without cert
// material stays a plain HTTP listener.
test("http.createServer({}) still serves cleartext", async () => {
  await using server = http.createServer({}, (_req, res) => res.end("PLAINTEXT"));
  const port = await listen(server);

  expect(await plaintextRequest(port)).toContain("PLAINTEXT");
});

test("https.Server is its own class, not http.Server", () => {
  expect(https.Server).not.toBe(http.Server);
  expect(https.createServer({})).toBeInstanceOf(https.Server);
  expect(new https.Server({})).toBeInstanceOf(https.Server);
  expect(new https.Server({})).toBeInstanceOf(http.Server);
});

describe("https.Server ALPN defaults apply to new Server() as well as createServer()", () => {
  const defaultALPN = {} as { ALPNProtocols: Buffer };
  tls.convertALPNProtocols(["http/1.1"], defaultALPN);

  test.each([
    ["https.createServer()", () => https.createServer()],
    ["new https.Server()", () => new https.Server()],
  ])("%s defaults ALPNProtocols to http/1.1", (_label, create) => {
    const server = create();
    expect(Buffer.isBuffer(server.ALPNProtocols)).toBe(true);
    expect(server.ALPNProtocols.equals(defaultALPN.ALPNProtocols)).toBe(true);
    expect(server.ALPNCallback).toBeUndefined();
  });

  test("new https.Server() keeps an explicit ALPNProtocols", () => {
    const explicit = {} as { ALPNProtocols: Buffer };
    tls.convertALPNProtocols(["h2", "http/1.1"], explicit);
    const server = new https.Server({ ALPNProtocols: ["h2", "http/1.1"] });
    expect(server.ALPNProtocols.equals(explicit.ALPNProtocols)).toBe(true);
  });

  test("new https.Server() stores ALPNCallback and skips the default protocol list", () => {
    const ALPNCallback = () => "http/1.1";
    const server = new https.Server({ ALPNCallback });
    expect(server.ALPNCallback).toBe(ALPNCallback);
    expect(server.ALPNProtocols).toBeUndefined();
  });

  test("new https.Server(requestListener) registers the listener", () => {
    const requestListener = () => {};
    const server = new https.Server(requestListener);
    expect(server.listeners("request")).toEqual([requestListener]);
  });
});
