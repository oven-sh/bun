import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { join } from "node:path";

const fixturesDir = join(import.meta.dirname, "..", "fixtures");
const cert = readFileSync(join(fixturesDir, "cert.pem"), "utf8");
const key = readFileSync(join(fixturesDir, "cert.key"), "utf8");

test("HTTPS response has socket as own property with authorized=true", async () => {
  await using server = Bun.serve({
    port: 0,
    tls: { cert, key },
    fetch() {
      return new Response("OK");
    },
  });

  // Read the socket synchronously in the response handler, the way
  // postman-request and similar libraries do for SSL verification. The socket
  // is detached from the response once the body ends (keep-alive returns it to
  // the pool), so capture what we need before draining the response.
  const result = await new Promise<{ hasOwnSocket: boolean; encrypted: unknown; authorized: unknown }>(
    (resolve, reject) => {
      const req = https.get(`https://localhost:${server.port}/`, { ca: cert, rejectUnauthorized: true }, res => {
        resolve({
          hasOwnSocket: Object.prototype.hasOwnProperty.call(res, "socket"),
          encrypted: res.socket.encrypted,
          authorized: res.socket.authorized,
        });
        res.resume();
      });
      req.on("error", reject);
    },
  );

  expect(result).toEqual({ hasOwnSocket: true, encrypted: true, authorized: true });
});

test("HTTPS response reports authorized=false for an unverified certificate", async () => {
  await using server = Bun.serve({
    port: 0,
    tls: { cert, key },
    fetch() {
      return new Response("OK");
    },
  });

  // Without the matching CA and with rejectUnauthorized: false, the connection
  // succeeds but the self-signed certificate is not trusted. `authorized` must
  // reflect the real TLS handshake result (false), not a hardcoded `true`.
  const result = await new Promise<{ hasOwnSocket: boolean; encrypted: unknown; authorized: unknown }>(
    (resolve, reject) => {
      const req = https.get(`https://localhost:${server.port}/`, { rejectUnauthorized: false }, res => {
        resolve({
          hasOwnSocket: Object.prototype.hasOwnProperty.call(res, "socket"),
          encrypted: res.socket.encrypted,
          authorized: res.socket.authorized,
        });
        res.resume();
      });
      req.on("error", reject);
    },
  );

  expect(result).toEqual({ hasOwnSocket: true, encrypted: true, authorized: false });
});

test("HTTP response socket has no encrypted/authorized properties", async () => {
  await using server = Bun.serve({
    port: 0,
    fetch() {
      return new Response("OK");
    },
  });

  const result = await new Promise<{ hasOwnSocket: boolean; encrypted: unknown; authorized: unknown }>(
    (resolve, reject) => {
      const req = http.get(`http://localhost:${server.port}/`, res => {
        resolve({
          hasOwnSocket: Object.prototype.hasOwnProperty.call(res, "socket"),
          encrypted: res.socket.encrypted,
          authorized: res.socket.authorized,
        });
        res.resume();
      });
      req.on("error", reject);
    },
  );

  expect(result).toEqual({ hasOwnSocket: true, encrypted: undefined, authorized: undefined });
});
