import { describe, expect, test } from "bun:test";
import { tls as tlsCert } from "harness";
import { once } from "node:events";
import http, { IncomingMessage } from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";

// https://github.com/oven-sh/bun/issues/23452
// postman-request (and yarn) gate strictSSL on response.hasOwnProperty('socket')
// and response.socket.authorized. Node assigns `this.socket = socket` as a
// plain own data property in IncomingMessage.
describe("IncomingMessage exposes socket as an own data property", () => {
  test.concurrent("https client response: authorized=true with a trusted CA", async () => {
    const server = https.createServer({ cert: tlsCert.cert, key: tlsCert.key }, (_req, res) => res.end("OK"));
    server.listen(0);
    await once(server, "listening");
    try {
      const result = await new Promise<Record<string, unknown>>((resolve, reject) => {
        https
          .get(
            {
              port: (server.address() as AddressInfo).port,
              host: "localhost",
              ca: tlsCert.cert,
              servername: "localhost",
              rejectUnauthorized: true,
            },
            res => {
              resolve({
                ownSocket: Object.prototype.hasOwnProperty.call(res, "socket"),
                ownConnection: Object.prototype.hasOwnProperty.call(res, "connection"),
                encrypted: (res.socket as any).encrypted,
                authorized: (res.socket as any).authorized,
              });
              res.resume();
            },
          )
          .on("error", reject);
      });
      expect(result).toEqual({ ownSocket: true, ownConnection: false, encrypted: true, authorized: true });
    } finally {
      server.close();
    }
  });

  test.concurrent("https client response: authorized=false when rejectUnauthorized is off", async () => {
    const server = https.createServer({ cert: tlsCert.cert, key: tlsCert.key }, (_req, res) => res.end("OK"));
    server.listen(0);
    await once(server, "listening");
    try {
      const result = await new Promise<Record<string, unknown>>((resolve, reject) => {
        https
          .get({ port: (server.address() as AddressInfo).port, host: "localhost", rejectUnauthorized: false }, res => {
            resolve({
              ownSocket: Object.prototype.hasOwnProperty.call(res, "socket"),
              encrypted: (res.socket as any).encrypted,
              authorized: (res.socket as any).authorized,
            });
            res.resume();
          })
          .on("error", reject);
      });
      expect(result).toEqual({ ownSocket: true, encrypted: true, authorized: false });
    } finally {
      server.close();
    }
  });

  test.concurrent("plain http: own socket on both server request and client response", async () => {
    let serverOwnSocket: unknown;
    const server = http.createServer((req, res) => {
      serverOwnSocket = Object.prototype.hasOwnProperty.call(req, "socket");
      res.end("OK");
    });
    server.listen(0);
    await once(server, "listening");
    try {
      const result = await new Promise<Record<string, unknown>>((resolve, reject) => {
        http
          .get({ port: (server.address() as AddressInfo).port, host: "127.0.0.1" }, res => {
            resolve({
              ownSocket: Object.prototype.hasOwnProperty.call(res, "socket"),
              encrypted: (res.socket as any).encrypted,
              authorized: (res.socket as any).authorized,
            });
            res.resume();
          })
          .on("error", reject);
      });
      expect({ ...result, serverOwnSocket }).toEqual({
        ownSocket: true,
        encrypted: undefined,
        authorized: undefined,
        serverOwnSocket: true,
      });
    } finally {
      server.close();
    }
  });

  test("bare new IncomingMessage() matches Node's own-property shape", () => {
    const msg = new IncomingMessage(undefined as any);
    expect(Object.prototype.hasOwnProperty.call(msg, "socket")).toBe(true);
    expect(Object.getOwnPropertyDescriptor(IncomingMessage.prototype, "socket")).toBeUndefined();
    expect(msg.socket).toBeUndefined();
    const fake = {} as any;
    msg.socket = fake;
    expect(Object.prototype.hasOwnProperty.call(msg, "socket")).toBe(true);
    expect(msg.socket).toBe(fake);
  });
});
