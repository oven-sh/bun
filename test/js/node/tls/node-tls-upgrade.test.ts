import { expect, test } from "bun:test";
import { once } from "events";
import { tls as certs } from "harness";
import net from "net";
import tls from "tls";

// https://github.com/oven-sh/bun/issues/32242
test("tls.connect({ socket }) via the stream-level engine does not re-emit post-upgrade bytes on the original socket", async () => {
  const { promise: done, resolve, reject } = Promise.withResolvers<number>();

  const server = net.createServer(s => {
    s.on("error", () => {});
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

    // cork+write so writableLength > 0 forces the upgradeDuplexToTLS path.
    raw.cork();
    raw.write("S");
    expect(raw.writableLength).toBeGreaterThan(0);
    const tlsSocket = tls.connect({ socket: raw, rejectUnauthorized: false });
    tlsSocket.on("error", () => resolve(leaked));
    tlsSocket.on("secureConnect", () => resolve(leaked));
    tlsSocket.on("close", () => resolve(leaked));
    raw.uncork();

    expect(await done).toBe(0);
  } finally {
    raw.destroy();
    server.close();
  }
});

// https://github.com/oven-sh/bun/issues/32242
test("tls.connect({ socket }) drains every buffered chunk into the stream-level engine", async () => {
  const { promise: done, resolve, reject } = Promise.withResolvers<void>();
  const alert = Buffer.from([0x15, 0x03, 0x03, 0x00, 0x02, 0x02, 0x28]);

  const server = net.createServer(s => {
    s.on("error", () => {});
    s.write(alert);
  });
  server.on("error", reject);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const raw = net.connect((server.address() as net.AddressInfo).port, "127.0.0.1");
  raw.on("error", () => {});
  try {
    raw.pause();
    await once(raw, "connect");
    await once(raw, "readable");
    raw.unshift(Buffer.from(alert));
    expect(raw.readableLength).toBe(alert.length * 2);

    raw.cork();
    raw.write("S");
    const tlsSocket = tls.connect({ socket: raw, rejectUnauthorized: false });
    tlsSocket.on("error", () => resolve());
    tlsSocket.on("secureConnect", () => resolve());
    tlsSocket.on("close", () => resolve());
    raw.uncork();

    expect(raw.readableLength).toBe(0);
    await done;
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
