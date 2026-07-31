import { expect, test } from "bun:test";
import { tls as tlsCert } from "harness";
import { once } from "node:events";
import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";

// https://github.com/oven-sh/bun/issues/23452
// postman-request checks `response.hasOwnProperty('socket')` and
// `response.socket.authorized` for strictSSL. Node assigns socket as an own
// data property in IncomingMessage; Bun stored it behind a prototype accessor
// so hasOwnProperty('socket') was false.

test("HTTPS client response exposes socket as own property with authorized=true", async () => {
  const server = https.createServer({ cert: tlsCert.cert, key: tlsCert.key }, (_req, res) => res.end("OK"));
  server.listen(0);
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  try {
    const result = await new Promise<{
      ownSocket: boolean;
      ownConnection: boolean;
      encrypted: unknown;
      authorized: unknown;
    }>((resolve, reject) => {
      const req = https.get(
        { port, host: "localhost", ca: tlsCert.cert, servername: "localhost", rejectUnauthorized: true },
        res => {
          resolve({
            ownSocket: Object.prototype.hasOwnProperty.call(res, "socket"),
            ownConnection: Object.prototype.hasOwnProperty.call(res, "connection"),
            encrypted: (res.socket as any).encrypted,
            authorized: (res.socket as any).authorized,
          });
          res.resume();
        },
      );
      req.on("error", reject);
    });
    expect(result).toEqual({ ownSocket: true, ownConnection: false, encrypted: true, authorized: true });
  } finally {
    server.close();
  }
});

test("HTTPS client response reports authorized=false when certificate is not verified", async () => {
  const server = https.createServer({ cert: tlsCert.cert, key: tlsCert.key }, (_req, res) => res.end("OK"));
  server.listen(0);
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  try {
    const result = await new Promise<{ ownSocket: boolean; encrypted: unknown; authorized: unknown }>(
      (resolve, reject) => {
        const req = https.get({ port, host: "localhost", rejectUnauthorized: false }, res => {
          resolve({
            ownSocket: Object.prototype.hasOwnProperty.call(res, "socket"),
            encrypted: (res.socket as any).encrypted,
            authorized: (res.socket as any).authorized,
          });
          res.resume();
        });
        req.on("error", reject);
      },
    );
    expect(result).toEqual({ ownSocket: true, encrypted: true, authorized: false });
  } finally {
    server.close();
  }
});

test("plain HTTP client response exposes socket as own property without TLS fields", async () => {
  const server = http.createServer((_req, res) => res.end("OK"));
  server.listen(0);
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  try {
    const result = await new Promise<{ ownSocket: boolean; encrypted: unknown; authorized: unknown }>(
      (resolve, reject) => {
        const req = http.get({ port, host: "127.0.0.1" }, res => {
          resolve({
            ownSocket: Object.prototype.hasOwnProperty.call(res, "socket"),
            encrypted: (res.socket as any).encrypted,
            authorized: (res.socket as any).authorized,
          });
          res.resume();
        });
        req.on("error", reject);
      },
    );
    expect(result).toEqual({ ownSocket: true, encrypted: undefined, authorized: undefined });
  } finally {
    server.close();
  }
});

test("new http.IncomingMessage() has socket as an own property like Node", () => {
  const msg = new http.IncomingMessage(undefined as any);
  expect(Object.prototype.hasOwnProperty.call(msg, "socket")).toBe(true);
  expect(msg.socket).toBeUndefined();
  // Assigning should keep it an own property.
  const fake = {} as any;
  msg.socket = fake;
  expect(Object.prototype.hasOwnProperty.call(msg, "socket")).toBe(true);
  expect(msg.socket).toBe(fake);
});
