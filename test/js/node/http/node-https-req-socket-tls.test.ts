import { expect, it } from "bun:test";
import { readFileSync } from "fs";
import https from "https";
import net, { AddressInfo } from "net";
import { once } from "node:events";
import { join } from "path";
import tls, { TLSSocket } from "tls";

// https://github.com/oven-sh/bun/issues/37251: the socket node:https hands
// the request handler must be a tls.TLSSocket so mTLS servers can read the
// client identity via req.socket.getPeerCertificate().
it("https req.socket is a TLSSocket that exposes the client certificate", async () => {
  const fixtures = join(import.meta.dir, "../tls/fixtures");
  const serverOptions = {
    key: readFileSync(join(fixtures, "agent10-key.pem"), "utf8"),
    cert: readFileSync(join(fixtures, "agent10-cert.pem"), "utf8"),
    ca: readFileSync(join(fixtures, "ca5-cert.pem"), "utf8"),
    requestCert: true,
    rejectUnauthorized: false,
  };
  const { promise, resolve, reject } = Promise.withResolvers<Record<string, unknown>>();
  const server = https.createServer(serverOptions, (req, res) => {
    try {
      const s = req.socket as TLSSocket;
      resolve({
        ctor: s.constructor.name,
        isTLSSocket: s instanceof TLSSocket,
        isNetSocket: s instanceof net.Socket,
        isServer: s.isServer,
        authorized: s.authorized,
        peerCN: s.getPeerCertificate()?.subject?.CN,
        detailedCN: s.getPeerCertificate(true)?.subject?.CN,
        x509Subject: s.getPeerX509Certificate()?.subject,
        cipherName: s.getCipher()?.name,
        protocol: s.getProtocol(),
      });
    } catch (err) {
      reject(err);
    }
    res.end("ok");
  });
  server.on("error", reject);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  const clientRequest = https.request({
    port,
    host: "127.0.0.1",
    rejectUnauthorized: false,
    key: readFileSync(join(fixtures, "ec10-key.pem"), "utf8"),
    cert: readFileSync(join(fixtures, "ec10-cert.pem"), "utf8"),
    agent: false,
  });
  clientRequest.on("error", reject);
  clientRequest.end();
  try {
    const got = await promise;
    expect(got).toEqual({
      ctor: "TLSSocket",
      isTLSSocket: true,
      isNetSocket: true,
      isServer: true,
      authorized: true,
      peerCN: "agent10.example.com",
      detailedCN: "agent10.example.com",
      x509Subject: expect.stringContaining("CN=agent10.example.com"),
      cipherName: expect.any(String),
      protocol: expect.stringMatching(/^TLSv/),
    });
  } finally {
    clientRequest.destroy();
    server.close();
  }
});

// tls.createServer was already fine (the issue is specific to node:https);
// keep it covered so the two server paths stay in sync.
it("tls.createServer connection sockets expose the client certificate the same way", async () => {
  const fixtures = join(import.meta.dir, "../tls/fixtures");
  const serverOptions = {
    key: readFileSync(join(fixtures, "agent10-key.pem"), "utf8"),
    cert: readFileSync(join(fixtures, "agent10-cert.pem"), "utf8"),
    ca: readFileSync(join(fixtures, "ca5-cert.pem"), "utf8"),
    requestCert: true,
    rejectUnauthorized: false,
  };
  const { promise, resolve, reject } = Promise.withResolvers<Record<string, unknown>>();
  const server = tls.createServer(serverOptions, socket => {
    try {
      resolve({
        isTLSSocket: socket instanceof TLSSocket,
        authorized: socket.authorized,
        peerCN: socket.getPeerCertificate()?.subject?.CN,
      });
    } catch (err) {
      reject(err);
    }
    socket.end();
  });
  server.on("error", reject);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  const client = tls.connect({
    port,
    host: "127.0.0.1",
    rejectUnauthorized: false,
    key: readFileSync(join(fixtures, "ec10-key.pem"), "utf8"),
    cert: readFileSync(join(fixtures, "ec10-cert.pem"), "utf8"),
  });
  client.on("error", reject);
  try {
    expect(await promise).toEqual({
      isTLSSocket: true,
      authorized: true,
      peerCN: "agent10.example.com",
    });
  } finally {
    client.end();
    server.close();
  }
});
