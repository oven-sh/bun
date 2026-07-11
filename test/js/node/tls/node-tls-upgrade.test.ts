import { expect, test } from "bun:test";
import { once } from "events";
import { tls as certs } from "harness";
import net from "net";
import tls from "tls";

test("should be able to upgrade a paused socket and also have backpressure on it #15438", async () => {
  // enought to trigger backpressure
  const payload = Buffer.alloc(16 * 1024 * 4, "b").toString("utf8");

  const server = tls.createServer(certs, socket => {
    // echo
    socket.on("data", data => {
      socket.write(data);
    });
  });

  await once(server.listen(0, "127.0.0.1"), "listening");

  const socket = net.connect({
    port: (server.address() as net.AddressInfo).port,
    host: "127.0.0.1",
  });
  await once(socket, "connect");

  // pause raw socket
  socket.pause();

  const tlsSocket = tls.connect({
    ca: certs.cert,
    servername: "localhost",
    socket,
  });
  await once(tlsSocket, "secureConnect");

  // do http request using tls socket
  async function doWrite(socket: net.Socket) {
    let downloadedBody = 0;
    const { promise, resolve, reject } = Promise.withResolvers();
    function onData(data: Buffer) {
      downloadedBody += data.byteLength;
      if (downloadedBody === payload.length * 2) {
        resolve();
      }
    }
    socket.pause();
    socket.write(payload);
    socket.write(payload, () => {
      socket.on("data", onData);
      socket.resume();
    });

    await promise;
    socket.off("data", onData);
  }
  for (let i = 0; i < 100; i++) {
    // upgrade the tlsSocket
    await doWrite(tlsSocket);
  }

  expect().pass();
});

test("new TLSSocket({ isServer, requestCert }) without ca requests a client certificate", async () => {
  // https://github.com/oven-sh/bun/issues/33954
  const { promise: securePromise, resolve: resolveSecure, reject } = Promise.withResolvers<tls.PeerCertificate>();
  const rawServer = net.createServer(raw => {
    const socket = new tls.TLSSocket(raw, {
      isServer: true,
      key: certs.key,
      cert: certs.cert,
      requestCert: true,
    });
    socket.on("secure", () => resolveSecure(socket.getPeerCertificate()));
    socket.on("data", data => socket.write(data));
    socket.on("error", reject);
  });
  rawServer.listen(0, "127.0.0.1");
  await once(rawServer, "listening");
  const { port } = rawServer.address() as net.AddressInfo;

  const client = tls.connect({
    host: "127.0.0.1",
    port,
    key: certs.key,
    cert: certs.cert,
    rejectUnauthorized: false,
  });
  client.on("error", reject);
  const echoPromise = new Promise<string>(resolveEcho => client.on("data", data => resolveEcho(data.toString())));
  try {
    const peerCert = await securePromise;
    expect(peerCert.subject).toMatchObject({ CN: "server-bun" });
    // The presented certificate is untrusted, but a standalone server-side
    // TLSSocket must not auto-reject the connection: Node applies that policy
    // only in tls.createServer's connection listener.
    client.write("ping");
    expect(await echoPromise).toBe("ping");
  } finally {
    client.end();
    rawServer.close();
  }
});

test("new TLSSocket({ isServer }) without requestCert does not request a client certificate", async () => {
  const { promise: securePromise, resolve: resolveSecure, reject } = Promise.withResolvers<tls.PeerCertificate>();
  const rawServer = net.createServer(raw => {
    const socket = new tls.TLSSocket(raw, {
      isServer: true,
      key: certs.key,
      cert: certs.cert,
    });
    socket.on("secure", () => resolveSecure(socket.getPeerCertificate()));
    socket.on("error", reject);
  });
  rawServer.listen(0, "127.0.0.1");
  await once(rawServer, "listening");
  const { port } = rawServer.address() as net.AddressInfo;

  const client = tls.connect({
    host: "127.0.0.1",
    port,
    key: certs.key,
    cert: certs.cert,
    rejectUnauthorized: false,
  });
  client.on("error", reject);
  try {
    const peerCert = await securePromise;
    expect(Object.keys(peerCert ?? {})).toHaveLength(0);
  } finally {
    client.end();
    rawServer.close();
  }
});
