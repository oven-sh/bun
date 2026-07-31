import { expect, test } from "bun:test";
import { once } from "events";
import { tls as certs } from "harness";
import net from "net";
import tls from "tls";

// https://github.com/oven-sh/bun/issues/32242
test("tls.connect({ socket }) via the stream-level engine does not re-emit post-upgrade bytes on the original socket", async () => {
  // A net.Socket with a buffered write takes the upgradeDuplexToTLS path
  // (hasUnflushedWrites). Its native handle keeps delivering raw bytes after
  // the upgrade, and before the fix those bytes were pushed onto the original
  // socket's readable (re-emitted as `data`) as well as being fed to the TLS
  // engine. Node silences the original socket once TLS owns the stream.
  const { promise: done, resolve, reject } = Promise.withResolvers<number>();

  const server = net.createServer(s => {
    s.on("error", () => {});
    // Reply to any inbound bytes with a TLS handshake_failure alert. The
    // client's TLS engine must receive this via the feeder (and error on it);
    // the client's pre-existing raw `data` listener must not.
    s.on("data", () => s.write(Buffer.from([0x15, 0x03, 0x03, 0x00, 0x02, 0x02, 0x28])));
  });
  server.on("error", reject);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const raw = net.connect((server.address() as net.AddressInfo).port, "127.0.0.1");
  raw.on("error", () => {});
  try {
    await once(raw, "connect");

    let leaked = 0;
    raw.on("data", chunk => {
      leaked += chunk.length;
    });

    // Force the stream-level TLS engine (upgradeDuplex) by buffering a write:
    // writableLength > 0 at tls.connect time makes hasUnflushedWrites true on
    // every platform, so this exercises the same code path as a Windows named
    // pipe.
    raw.cork();
    raw.write("S");
    expect(raw.writableLength).toBeGreaterThan(0);
    const tlsSocket = tls.connect({ socket: raw, rejectUnauthorized: false });
    raw.uncork();

    // Any terminal outcome on the TLS socket is acceptable here; the server is
    // not a real TLS peer. What matters is that the alert bytes reached the TLS
    // engine (via the feeder) and never re-surfaced on raw.
    tlsSocket.on("error", () => resolve(leaked));
    tlsSocket.on("secureConnect", () => resolve(leaked));
    tlsSocket.on("close", () => resolve(leaked));

    expect(await done).toBe(0);
  } finally {
    raw.destroy();
    server.close();
  }
});

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
