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

test("tls.connect({ socket }) does not re-emit post-upgrade bytes on the original socket (STARTTLS) #32239", async () => {
  // Mock STARTTLS server: greet, reply PROCEED to STARTTLS, then send mock TLS
  // bytes in reply to the client's ClientHello. Those mock bytes must reach
  // the TLS layer (OpenSSL rejects them) rather than re-surface as cleartext
  // `data` on the original socket, which in the issue re-entered the handler
  // and threw "Invalid socket".
  const server = net.createServer(serverSocket => {
    serverSocket.on("error", () => {});
    serverSocket.write("SERVER_GREETING");
    let phase = "greeting";
    serverSocket.on("data", data => {
      if (phase === "greeting" && data.toString().includes("STARTTLS")) {
        phase = "proceed";
        serverSocket.write("PROCEED");
      } else if (phase === "proceed") {
        phase = "done";
        serverSocket.write(Buffer.alloc(50, 0x16));
      }
    });
  });

  await once(server.listen(0, "127.0.0.1"), "listening");
  const { port } = server.address() as net.AddressInfo;

  const { promise, resolve } = Promise.withResolvers<{ upgrades: number; dataEvents: number; message: string }>();

  let dataEvents = 0;
  let upgrades = 0;
  let upgraded = false;

  const socket = net.connect(port, "127.0.0.1");
  socket.on("error", () => {});
  socket.on("close", () => resolve({ upgrades, dataEvents, message: "" }));

  socket.on("data", data => {
    dataEvents++;
    if (!upgraded && data.toString("latin1").includes("SERVER_GREETING")) {
      socket.write("STARTTLS");
      return;
    }
    // The legitimate upgrade (on PROCEED) and the buggy re-entry (on
    // re-emitted ciphertext) both land here, mirroring the issue's handler.
    upgraded = true;
    upgrades++;
    const tlsSocket = tls.connect({ socket, host: "127.0.0.1", rejectUnauthorized: false });
    tlsSocket.on("error", err => resolve({ upgrades, dataEvents, message: err.message }));
    tlsSocket.on("secureConnect", () => resolve({ upgrades, dataEvents, message: "" }));
    tlsSocket.on("close", () => resolve({ upgrades, dataEvents, message: "" }));
  });

  const result = await promise;
  server.close();
  socket.destroy();

  // The original socket must go quiet after the upgrade: the upgrade is
  // attempted exactly once and never fails with "Invalid socket".
  expect(result.message).not.toContain("Invalid socket");
  expect(result.upgrades).toBe(1);
  expect(result.dataEvents).toBe(2);
});
