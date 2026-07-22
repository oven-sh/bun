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

  const { promise, resolve } = Promise.withResolvers<{ upgrades: number; message: string }>();

  let upgrades = 0;
  let upgraded = false;

  const socket = net.connect(port, "127.0.0.1");
  try {
    // Errors are an expected outcome here: OpenSSL rejects the mock handshake
    // bytes (the TLS socket emits `error`) and the underlying socket may reset
    // during teardown. Every terminal event settles `promise`, so a regression
    // surfaces as a failed assertion on the resolved values rather than a hang.
    socket.on("error", () => {});
    socket.on("close", () => resolve({ upgrades, message: "" }));

    socket.on("data", data => {
      if (!upgraded && data.toString("latin1").includes("SERVER_GREETING")) {
        socket.write("STARTTLS");
        return;
      }
      // The legitimate upgrade (on PROCEED) and the buggy re-entry (on
      // re-emitted ciphertext) both land here, mirroring the issue's handler.
      upgraded = true;
      upgrades++;
      const tlsSocket = tls.connect({ socket, host: "127.0.0.1", rejectUnauthorized: false });
      tlsSocket.on("error", err => resolve({ upgrades, message: err.message }));
      tlsSocket.on("secureConnect", () => resolve({ upgrades, message: "" }));
      tlsSocket.on("close", () => resolve({ upgrades, message: "" }));
    });

    const result = await promise;

    // The original socket must go quiet after the upgrade: once TLS owns the
    // stream no further `data` event re-enters the handler, so exactly one
    // upgrade is attempted and it never fails with "Invalid socket". (A
    // re-emitted post-upgrade chunk would land in the upgrade branch and push
    // `upgrades` past 1.)
    expect(result.message).not.toContain("Invalid socket");
    expect(result.upgrades).toBe(1);
  } finally {
    socket.destroy();
    server.close();
  }
});

test("new tls.TLSSocket(socket, { isServer: true }) does not re-emit post-upgrade bytes on the accepted socket (server STARTTLS) #32239", async () => {
  // Server-side STARTTLS (SMTP/IMAP/FTPS pattern): after the plaintext
  // negotiation the server wraps the accepted socket with an isServer TLSSocket.
  // The client's ClientHello (ciphertext) must reach the TLS layer, not resurface
  // as cleartext `data` on the accepted socket and re-enter the server's handler.
  const { promise, resolve } = Promise.withResolvers<{
    wrapped: boolean;
    dataAfterUpgrade: boolean;
    message: string;
  }>();

  let dataAfterUpgrade = false;
  let wrapped = false;

  const server = net.createServer(accepted => {
    let upgraded = false;
    accepted.on("error", () => {});
    accepted.write("SERVER_GREETING");
    accepted.on("data", data => {
      if (upgraded) {
        // Post-upgrade ciphertext must not resurface here.
        dataAfterUpgrade = true;
        return;
      }
      if (data.toString("latin1").includes("STARTTLS")) {
        upgraded = true;
        accepted.write("PROCEED");
        const tlsSock = new tls.TLSSocket(accepted, { isServer: true, key: certs.key, cert: certs.cert });
        wrapped = true;
        tlsSock.on("error", () => resolve({ wrapped, dataAfterUpgrade, message: "" }));
        tlsSock.on("secure", () => resolve({ wrapped, dataAfterUpgrade, message: "" }));
      }
    });
  });

  await once(server.listen(0, "127.0.0.1"), "listening");
  const { port } = server.address() as net.AddressInfo;

  const socket = net.connect(port, "127.0.0.1");
  try {
    socket.on("error", () => {});
    socket.on("close", () => resolve({ wrapped, dataAfterUpgrade, message: "" }));
    socket.on("data", data => {
      const text = data.toString("latin1");
      if (text.includes("SERVER_GREETING")) {
        socket.write("STARTTLS");
      } else if (text.includes("PROCEED")) {
        const tlsSocket = tls.connect({ socket, servername: "localhost", rejectUnauthorized: false });
        tlsSocket.on("error", err => resolve({ wrapped, dataAfterUpgrade, message: err.message }));
        tlsSocket.on("secureConnect", () => resolve({ wrapped, dataAfterUpgrade, message: "" }));
      }
    });

    const result = await promise;

    // The server must actually have wrapped the accepted socket (guards against
    // an early close settling the promise before the upgrade ran).
    expect(result.wrapped).toBe(true);
    // The accepted socket must go quiet once the server TLS layer owns the stream.
    expect(result.dataAfterUpgrade).toBe(false);
    expect(result.message).not.toContain("Invalid socket");
  } finally {
    socket.destroy();
    server.close();
  }
});

test("server-side TLS upgrade does not re-inject buffered ClientHello (initialData) #32239", async () => {
  // When the ClientHello is already buffered on the accepted socket at wrap time
  // (readable/paused-mode STARTTLS with an async gap before the wrap), the native
  // side feeds it synchronously during upgradeTLS and fires the raw tap before
  // upgradeTLS returns. The flag must be set before that call so the buffered
  // bytes are not re-pushed back into the accepted socket's readable buffer.
  const { promise, resolve } = Promise.withResolvers<{ wrapped: boolean; reinjected: boolean }>();

  const server = net.createServer(accepted => {
    accepted.on("error", () => {});
    accepted.write("SERVER_GREETING");
    let negotiated = false;
    accepted.on("data", function onData(chunk) {
      if (negotiated || !chunk.toString("latin1").includes("STARTTLS")) return;
      negotiated = true;
      accepted.write("PROCEED");
      // Switch to paused mode so the client's ClientHello buffers instead of
      // flowing; the wrap then sees it as non-empty initialData.
      accepted.removeListener("data", onData);
      accepted.pause();
      accepted.once("readable", () => {
        const tlsSock = new tls.TLSSocket(accepted, { isServer: true, key: certs.key, cert: certs.cert });
        tlsSock.on("error", () => {});
        // On the unfixed build the buffered ClientHello is synchronously
        // re-pushed into the accepted socket's readable buffer during the wrap.
        resolve({ wrapped: true, reinjected: accepted.readableLength > 0 });
      });
    });
  });

  await once(server.listen(0, "127.0.0.1"), "listening");
  const { port } = server.address() as net.AddressInfo;

  const socket = net.connect(port, "127.0.0.1");
  try {
    socket.on("error", () => {});
    // An early close resolves wrapped:false so the assertion fails rather than
    // vacuously passing before the wrap ran.
    socket.on("close", () => resolve({ wrapped: false, reinjected: false }));
    socket.on("data", data => {
      const text = data.toString("latin1");
      if (text.includes("SERVER_GREETING")) {
        socket.write("STARTTLS");
      } else if (text.includes("PROCEED")) {
        const tlsSocket = tls.connect({ socket, servername: "localhost", rejectUnauthorized: false });
        tlsSocket.on("error", () => {});
      }
    });

    const result = await promise;

    // The wrap must have actually run (guards against an early close settling
    // the promise with the passing default).
    expect(result.wrapped).toBe(true);
    // The buffered ClientHello must reach the TLS engine, not resurface as
    // readable bytes on the accepted socket.
    expect(result.reinjected).toBe(false);
  } finally {
    socket.destroy();
    server.close();
  }
});
