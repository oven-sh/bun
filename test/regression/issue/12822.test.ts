import { expect, test } from "bun:test";
import { tls } from "harness";
import http from "http";
import https from "https";
import type { TLSSocket } from "tls";

test("HTTPS res.socket has TLS methods like getPeerCertificate", async () => {
  await using server = Bun.serve({
    port: 0,
    tls,
    fetch: () => new Response("ok"),
  });

  const result = await new Promise<{
    encrypted: boolean;
    authorized: boolean;
    hasPeerCert: boolean;
    peerCert: any;
    hasCipher: boolean;
    hasProtocol: boolean;
    hasSession: boolean;
    hasIsSessionReused: boolean;
  }>((resolve, reject) => {
    const req = https.request(
      {
        host: "localhost",
        port: server.port,
        method: "GET",
        ca: tls.cert,
      },
      (res) => {
        const socket = res.socket as TLSSocket;
        try {
          resolve({
            encrypted: socket.encrypted,
            authorized: socket.authorized,
            hasPeerCert: typeof socket.getPeerCertificate === "function",
            peerCert: socket.getPeerCertificate(),
            hasCipher: typeof socket.getCipher === "function",
            hasProtocol: typeof socket.getProtocol === "function",
            hasSession: typeof socket.getSession === "function",
            hasIsSessionReused: typeof socket.isSessionReused === "function",
          });
        } catch (e) {
          reject(e);
        } finally {
          req.destroy();
        }
      },
    );
    req.on("error", reject);
    req.end();
  });

  expect(result.encrypted).toBe(true);
  expect(result.authorized).toBe(true);
  expect(result.hasPeerCert).toBe(true);
  expect(result.peerCert).toEqual({});
  expect(result.hasCipher).toBe(true);
  expect(result.hasProtocol).toBe(true);
  expect(result.hasSession).toBe(true);
  expect(result.hasIsSessionReused).toBe(true);
});

test("HTTPS res.socket.authorized is false with rejectUnauthorized: false", async () => {
  await using server = Bun.serve({
    port: 0,
    tls,
    fetch: () => new Response("ok"),
  });

  const result = await new Promise<{
    encrypted: boolean;
    authorized: boolean;
  }>((resolve, reject) => {
    const req = https.request(
      {
        host: "localhost",
        port: server.port,
        method: "GET",
        rejectUnauthorized: false,
      },
      (res) => {
        const socket = res.socket as TLSSocket;
        try {
          resolve({
            encrypted: socket.encrypted,
            authorized: socket.authorized,
          });
        } catch (e) {
          reject(e);
        } finally {
          req.destroy();
        }
      },
    );
    req.on("error", reject);
    req.end();
  });

  expect(result.encrypted).toBe(true);
  expect(result.authorized).toBe(false);
});

test("HTTP res.socket does not report as encrypted", async () => {
  await using server = Bun.serve({
    port: 0,
    fetch: () => new Response("ok"),
  });

  const result = await new Promise<{
    encrypted: boolean;
    authorized: boolean;
    hasPeerCert: boolean;
    peerCert: any;
  }>((resolve, reject) => {
    const req = http.request(`http://localhost:${server.port}/`, (res) => {
      const socket = res.socket;
      try {
        resolve({
          encrypted: (socket as any).encrypted,
          authorized: (socket as any).authorized,
          hasPeerCert: typeof (socket as any).getPeerCertificate === "function",
          peerCert: (socket as any).getPeerCertificate(),
        });
      } catch (e) {
        reject(e);
      } finally {
        req.destroy();
      }
    });
    req.on("error", reject);
    req.end();
  });

  expect(result.encrypted).toBe(false);
  expect(result.authorized).toBe(false);
  expect(result.hasPeerCert).toBe(true);
  expect(result.peerCert).toBeNull();
});
