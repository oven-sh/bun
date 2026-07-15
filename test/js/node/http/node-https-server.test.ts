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

// Node's https.Server extends tls.Server, so an options object carrying no key
// and no cert still produces a TLS listener: every handshake fails and nothing
// is ever written in the clear. Bun handed the same options to Bun.serve(),
// which saw no cert material and started a plain HTTP listener, so a typo'd
// option name or an `undefined` from a failed file read silently turned an
// https endpoint into a working cleartext http endpoint.
describe("https.createServer() with no key and no cert", () => {
  const shapes: Array<[string, (handler: http.RequestListener) => http.Server]> = [
    ["createServer(requestListener)", handler => https.createServer(handler)],
    ["createServer({}, requestListener)", handler => https.createServer({}, handler)],
    ["createServer(undefined, requestListener)", handler => https.createServer(undefined, handler)],
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
      // A cleartext listener answers a ClientHello with ASCII HTTP bytes, which
      // the client misreads as a TLS record: ERR_SSL_WRONG_VERSION_NUMBER. A
      // certificate-less TLS listener sends a handshake alert instead.
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
});
