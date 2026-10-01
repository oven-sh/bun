// https://github.com/oven-sh/bun/issues/40401
// Destroying a TLS socket layered over a caller-supplied socket (undici's
// SOCKS5 + requestTls flow) must tear the connection down like node: a bare
// FIN, with no close_notify written from the destroy path (node only sends
// the alert from the end() path). A destroy-time alert lands in the tunnel
// proxy's receive buffer ahead of the FIN. The proxy's socket is paused once
// its pipe target is gone, the alert is never read, and node stream
// semantics then withhold 'end'/'close' forever, so the proxy leaks one
// connection per request.
import { expect, test } from "bun:test";
import { tls as tlsCert } from "harness";
import { once } from "node:events";
import net from "node:net";
import tls from "node:tls";

const listen = (server: net.Server) =>
  new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve((server.address() as net.AddressInfo).port));
  });

test("destroying a TLS socket over a tunneled net.Socket sends a bare FIN", async () => {
  // TLS echo target. It never closes its side, so every byte the tunnel sees
  // from the client after the reply comes from the client's own teardown.
  const target = tls.createServer({ cert: tlsCert.cert, key: tlsCert.key }, socket => {
    socket.on("error", () => {});
    socket.on("data", () => socket.write("ok"));
  });

  // Byte-piping tunnel proxy, as a SOCKS5 proxy is after CONNECT.
  let countTeardownBytes = false;
  let teardownBytes = 0;
  let targetPort = 0;
  const clientEnded = Promise.withResolvers<void>();
  const clientClosed = Promise.withResolvers<void>();
  const proxy = net.createServer(client => {
    // A client error (an RST regression in the destroy path) must fail the
    // awaited 'end', not hang the test to its timeout.
    client.on("error", clientEnded.reject);
    client.on("data", chunk => {
      if (countTeardownBytes) teardownBytes += chunk.length;
    });
    client.on("end", () => clientEnded.resolve());
    client.on("close", () => clientClosed.resolve());
    const up = net.connect(targetPort, "127.0.0.1");
    up.on("error", () => {});
    client.pipe(up);
    up.pipe(client);
  });

  let raw: net.Socket | undefined;
  try {
    targetPort = await listen(target);
    const proxyPort = await listen(proxy);

    // The client: a raw socket through the tunnel, TLS layered on top.
    raw = net.connect(proxyPort, "127.0.0.1");
    await once(raw, "connect");
    const secure = tls.connect({ socket: raw, ca: tlsCert.cert, servername: "localhost" });
    secure.on("error", () => {});
    await once(secure, "secureConnect");

    secure.write("hello");
    const [reply] = await once(secure, "data");
    expect(reply.toString()).toBe("ok");

    // Destroy, as undici does when a response carries 'connection: close'.
    // Node sends nothing here, only the FIN.
    countTeardownBytes = true;
    secure.destroy();

    await clientEnded.promise;
    expect(teardownBytes).toBe(0);
    await clientClosed.promise;
  } finally {
    raw?.destroy();
    proxy.close();
    target.close();
  }
});
