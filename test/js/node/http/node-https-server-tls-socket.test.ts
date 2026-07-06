// An accepted https.Server connection must hand the request handler a
// tls.TLSSocket, not a bare Socket: `req.socket instanceof tls.TLSSocket`, the
// getPeerCertificate/getCipher/getProtocol/... TLS methods, the
// authorized/authorizationError/servername/encrypted fields, and the
// 'secureConnection' event are how mTLS (requestCert + client certificate) auth
// and TLS-aware routing are done on a Node https server.

import { expect, test } from "bun:test";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { AddressInfo } from "node:net";
import { join } from "node:path";
import tls from "node:tls";

const keys = join(import.meta.dir, "..", "test", "fixtures", "keys");
const agent1 = {
  key: readFileSync(join(keys, "agent1-key.pem"), "utf8"), // CN=agent1, signed by ca1
  cert: readFileSync(join(keys, "agent1-cert.pem"), "utf8"),
};
const ca1 = readFileSync(join(keys, "ca1-cert.pem"), "utf8");

// The cert CN is "agent1", not the connection host, so skip the client-side
// hostname check - it is irrelevant to the server-side surface under test.
const skipServerIdentity = () => undefined;

test("https server: req.socket is a TLSSocket exposing the mTLS surface", async () => {
  const secureConnectionSockets: unknown[] = [];

  await using server = https.createServer(
    { key: agent1.key, cert: agent1.cert, ca: [ca1], requestCert: true, rejectUnauthorized: false },
    (req, res) => {
      const s = req.socket as tls.TLSSocket;
      res.end(
        JSON.stringify({
          isTLSSocket: s instanceof tls.TLSSocket,
          ctor: s.constructor.name,
          encrypted: s.encrypted,
          authorized: s.authorized,
          authorizationError: s.authorizationError ?? null,
          peerCN: s.getPeerCertificate()?.subject?.CN ?? null,
          cipherName: s.getCipher()?.name ?? null,
          protocol: s.getProtocol(),
          isSessionReused: s.isSessionReused(),
          hasMethods: ["getPeerCertificate", "getCipher", "getProtocol", "getSession", "exportKeyingMaterial"].every(
            m => typeof s[m] === "function",
          ),
        }),
      );
    },
  );
  server.on("secureConnection", s => secureConnectionSockets.push(s.constructor.name));

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;

  const body = await new Promise<string>((resolve, reject) => {
    let buf = "";
    const req = https.request(
      {
        host: "127.0.0.1",
        port,
        method: "GET",
        key: agent1.key, // present a client certificate for mTLS
        cert: agent1.cert,
        ca: [ca1],
        checkServerIdentity: skipServerIdentity,
      },
      res => {
        res.setEncoding("utf8");
        res.on("data", d => (buf += d));
        res.on("end", () => resolve(buf));
      },
    );
    req.on("error", reject);
    req.end();
  });

  expect(JSON.parse(body)).toEqual({
    isTLSSocket: true,
    ctor: "TLSSocket",
    encrypted: true,
    authorized: true,
    authorizationError: null,
    peerCN: "agent1",
    cipherName: expect.any(String),
    protocol: expect.stringMatching(/^TLSv/),
    isSessionReused: false,
    hasMethods: true,
  });
  expect(secureConnectionSockets).toEqual(["TLSSocket"]);
});

test("https server: requestCert without a client certificate leaves authorized false", async () => {
  await using server = https.createServer(
    { key: agent1.key, cert: agent1.cert, ca: [ca1], requestCert: true, rejectUnauthorized: false },
    (req, res) => {
      const s = req.socket as tls.TLSSocket;
      res.end(
        JSON.stringify({
          authorized: s.authorized,
          // With requestCert and no client cert, the verify result is an
          // issuer-lookup failure, like Node.
          hasAuthorizationError: typeof s.authorizationError === "string",
          peerEmpty: JSON.stringify(s.getPeerCertificate()) === "{}",
        }),
      );
    },
  );

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;

  const body = await new Promise<string>((resolve, reject) => {
    let buf = "";
    const req = https.request(
      { host: "127.0.0.1", port, method: "GET", ca: [ca1], checkServerIdentity: skipServerIdentity },
      res => {
        res.setEncoding("utf8");
        res.on("data", d => (buf += d));
        res.on("end", () => resolve(buf));
      },
    );
    req.on("error", reject);
    req.end();
  });

  expect(JSON.parse(body)).toEqual({
    authorized: false,
    hasAuthorizationError: true,
    peerEmpty: true,
  });
});

test("http server: req.socket is a plain Socket, not a TLSSocket", async () => {
  await using server = http.createServer((req, res) => {
    res.end(
      JSON.stringify({
        isTLSSocket: req.socket instanceof tls.TLSSocket,
        hasGetPeerCertificate: typeof (req.socket as any).getPeerCertificate,
      }),
    );
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;

  const body = await new Promise<string>((resolve, reject) => {
    let buf = "";
    const req = http.request({ host: "127.0.0.1", port, method: "GET" }, res => {
      res.setEncoding("utf8");
      res.on("data", d => (buf += d));
      res.on("end", () => resolve(buf));
    });
    req.on("error", reject);
    req.end();
  });

  expect(JSON.parse(body)).toEqual({
    isTLSSocket: false,
    hasGetPeerCertificate: "undefined",
  });
});
