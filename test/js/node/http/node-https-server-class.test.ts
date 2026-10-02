import { afterEach, describe, expect, test } from "bun:test";
import http from "node:http";
import https from "node:https";
import { tls } from "harness";

describe("https.Server", () => {
  const servers: http.Server[] = [];
  afterEach(() => {
    for (const server of servers.splice(0)) {
      server.close();
    }
  });

  test("is a distinct class that extends http.Server", () => {
    expect(https.Server).not.toBe(http.Server);
    expect(Object.getPrototypeOf(https.Server.prototype)).toBe(http.Server.prototype);
    expect(Object.getPrototypeOf(https.Server)).toBe(http.Server);
  });

  test("createServer returns an https.Server that is also an http.Server", () => {
    const server = https.createServer({ ...tls }, () => {});
    servers.push(server);
    expect(server).toBeInstanceOf(https.Server);
    expect(server).toBeInstanceOf(http.Server);
    expect(server.constructor).toBe(https.Server);
    // the ALPN default that tls.Server applies
    expect(server.ALPNProtocols).toBeDefined();
  });

  test("a plain http.Server is not an https.Server", () => {
    const server = http.createServer(() => {});
    servers.push(server);
    expect(server).toBeInstanceOf(http.Server);
    expect(server).not.toBeInstanceOf(https.Server);
    expect(server.constructor).toBe(http.Server);
  });

  test("new https.Server() and https.Server() both construct", () => {
    const a = new https.Server({ ...tls });
    // Node's https.Server can be called without `new`, like tls.Server.
    const b = (https.Server as any)({ ...tls });
    servers.push(a, b);
    expect(a).toBeInstanceOf(https.Server);
    expect(b).toBeInstanceOf(https.Server);
  });
});
