import { expect, test } from "bun:test";
import { once } from "events";
import { tls as certs } from "harness";
import net from "net";
import { Duplex, duplexPair } from "stream";
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

// The SSL engine for a TLS socket built over a generic Duplex is created by a
// deferred event-loop task. Creating the client first makes its ClientHello
// land on the server half of the pair before the server's engine exists; those
// bytes must be buffered, not dropped, or the handshake never completes.
test("server-side TLSSocket over a duplexPair handshakes when the client is created first", async () => {
  const [clientSide, serverSide] = duplexPair();

  const client = tls.connect({ socket: clientSide, ca: certs.cert, servername: "localhost" });
  const server = new tls.TLSSocket(serverSide, {
    isServer: true,
    secureContext: tls.createSecureContext(certs),
  });

  const data = Promise.withResolvers<string>();
  client.on("data", chunk => data.resolve(chunk.toString()));
  client.on("error", data.reject);
  server.on("error", data.reject);

  await Promise.all([once(server, "secure"), once(client, "secureConnect")]);
  server.end("pong");
  expect(await data.promise).toBe("pong");
  client.end();
});

// Nested TLS sessions, each layer wrapped in a generic Duplex shim. The outer
// server decrypts and pushes the inner ClientHello in the same tick its
// connection callback creates the inner server TLSSocket, so the inner server's
// engine does not exist yet when those bytes arrive.
test("TLS in TLS over a generic Duplex completes the inner handshake", async () => {
  function wrapAsDuplex(underlying: tls.TLSSocket) {
    const d = new Duplex({
      read() {},
      write(chunk, _enc, cb) {
        underlying.write(chunk, cb);
      },
      final(cb) {
        underlying.end();
        cb();
      },
    });
    underlying.on("data", chunk => d.push(chunk));
    underlying.on("end", () => d.push(null));
    underlying.on("error", e => d.destroy(e));
    return d;
  }

  const innerServerSecure = Promise.withResolvers<void>();
  const innerClientData = Promise.withResolvers<string>();

  const outerServer = tls.createServer(certs, outerSocket => {
    const innerServer = new tls.TLSSocket(wrapAsDuplex(outerSocket), {
      isServer: true,
      secureContext: tls.createSecureContext(certs),
    });
    innerServer.on("secure", () => {
      innerServerSecure.resolve();
      innerServer.end("hello from inner");
    });
    innerServer.on("error", e => {
      innerServerSecure.reject(e);
      innerClientData.reject(e);
    });
  });

  let outerClient: tls.TLSSocket | undefined;
  try {
    await once(outerServer.listen(0, "127.0.0.1"), "listening");
    const { port } = outerServer.address() as net.AddressInfo;

    outerClient = tls.connect({ port, host: "127.0.0.1", ca: certs.cert, servername: "localhost" });
    outerClient.on("error", innerClientData.reject);
    await once(outerClient, "secureConnect");

    const innerClient = tls.connect({
      socket: wrapAsDuplex(outerClient),
      ca: certs.cert,
      servername: "localhost",
    });
    innerClient.on("data", chunk => innerClientData.resolve(chunk.toString()));
    innerClient.on("error", innerClientData.reject);

    await innerServerSecure.promise;
    expect(await innerClientData.promise).toBe("hello from inner");
  } finally {
    outerClient?.destroy();
    outerServer.close();
  }
});
