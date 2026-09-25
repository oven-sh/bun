// new tls.TLSSocket(stream) without isServer, the STARTTLS client shape. Each export
// returns one report. node-tls-connect.test.ts calls them in its own process, and runs
// this file under node as a script, so it asserts the same report for both.
import { once } from "node:events";
import { readFileSync } from "node:fs";
import net from "node:net";
import { Duplex, Stream } from "node:stream";
import tls, { TLSSocket } from "node:tls";

const fixture = name => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const nextTurn = () => new Promise(resolve => setImmediate(resolve));

async function listening(server) {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return server.address().port;
}

// end(), end(cb), destroySoon() and destroy() on a wrap that nothing has written to, over
// each kind of stream. A cell reports what the TLS socket threw or emitted as 'error', and
// whether it closed. Each cell ends with destroy(): with a peer that keeps its side open,
// end() alone leaves a wrap open.
export async function shutdown() {
  // Accepts, reads and never answers. allowHalfOpen keeps it from closing on a FIN.
  const accepted = [];
  const peer = net.createServer({ allowHalfOpen: true }, socket => {
    accepted.push(socket);
    socket.on("data", () => {});
    socket.on("error", () => {});
  });
  const port = await listening(peer);

  const transports = {
    "connected": async () => {
      const raw = net.connect(port, "127.0.0.1");
      await once(raw, "connect");
      return { raw };
    },
    "connecting": async () => {
      const raw = net.connect(port, "127.0.0.1");
      // 'connect', or 'close' when the call destroys the socket first (node's destroy() does).
      const settled = new Promise(resolve => raw.once("connect", resolve).once("close", resolve));
      return { raw, settled };
    },
    "never connected": async () => ({ raw: new net.Socket() }),
    "duplex": async () => ({
      raw: new Duplex({
        read() {},
        write(chunk, encoding, callback) {
          callback();
        },
      }),
    }),
  };
  const methods = {
    "end()": socket => socket.end(),
    "end(cb)": socket => socket.end(() => {}),
    "destroySoon()": socket => socket.destroySoon(),
    "destroy()": socket => socket.destroy(),
  };

  const report = {};
  try {
    for (const [transportName, makeTransport] of Object.entries(transports)) {
      for (const [methodName, call] of Object.entries(methods)) {
        const { raw, settled } = await makeTransport();
        raw.on("error", () => {});
        const errors = [];
        let closed = false;
        // Settled by 'close', or by the 'error' that takes its place when destroy() fails.
        const done = Promise.withResolvers();
        const socket = new TLSSocket(raw, { rejectUnauthorized: false });
        socket.on("error", error => {
          errors.push(`error ${error.code ?? error.message}`);
          done.resolve();
        });
        socket.on("close", () => {
          closed = true;
          done.resolve();
        });
        try {
          call(socket);
          await settled;
          // The shutdown runs from process.nextTick, so it is over when a setImmediate runs.
          await nextTurn();
          socket.destroy();
          await done.promise;
        } catch (error) {
          errors.push(`threw ${error.message}`);
        }
        report[`${transportName}: ${methodName}`] = { errors, closed };
        raw.destroy();
      }
    }
  } finally {
    for (const socket of accepted) socket.destroy();
    peer.close();
  }
  return report;
}

// The calls of Connection.prototype._startTLS in mysql 2.18.1 (lib/Connection.js), in its
// order and at its time: the driver writes the SSLRequest and starts TLS in the same turn,
// and the server sends no reply in between. So the ClientHello can reach the server in one
// chunk with the request. The server reads the request bytes only.
export async function mysql() {
  const key = fixture("agent1-key.pem");
  const cert = fixture("agent1-cert.pem");
  const ca = fixture("ca1-cert.pem");

  const serverContext = tls.createSecureContext({ key, cert });
  const server = net.createServer(socket => {
    socket.on("error", () => {});
    socket.write("greeting");
    const request = "SSLRequest";
    socket.on("readable", function onReadable() {
      const bytes = socket.read(request.length);
      if (bytes === null) return;
      socket.removeListener("readable", onReadable);
      if (String(bytes) !== request) return socket.destroy();
      const secure = new TLSSocket(socket, { isServer: true, secureContext: serverContext });
      secure.on("error", () => {});
      secure.on("data", data => secure.write(`result of ${data}`));
    });
  });
  const port = await listening(server);

  // mysql's Protocol is a legacy Stream: pipe() writes the server's bytes into it,
  // and it emits the client's packets as 'data'.
  class Protocol extends Stream {
    writable = true;
    received = Promise.withResolvers();
    write(chunk) {
      this.received.resolve(String(chunk));
      return true;
    }
    end() {}
  }

  async function connect(ssl) {
    const config = { ssl: { ...ssl, rejectUnauthorized: ssl.rejectUnauthorized !== false } };
    const connection = { _socket: net.connect(port, "127.0.0.1"), _protocol: new Protocol(), config };
    const log = [];
    const secured = Promise.withResolvers();
    const onSecure = error => {
      log.push(`onSecure ${error ? error.code : null}`);
      secured.resolve();
    };
    // A connection that closes first settles each wait below, so a failure is a report and not a hang.
    const closedEarly = Promise.withResolvers();
    closedEarly.promise.catch(() => {});
    connection._socket.on("error", () => {});
    connection._socket.once("close", () => closedEarly.reject(new Error("the connection closed early")));

    try {
      await once(connection._socket, "connect");
      const plaintext = [];
      connection._socket.on("data", data => {
        plaintext.push(String(data));
        if (plaintext.join("") !== "greeting") return;
        connection._socket.write("SSLRequest");
        try {
          startTLS();
        } catch (error) {
          secured.reject(error);
        }
      });

      function startTLS() {
        const secureContext = tls.createSecureContext({
          ca: config.ssl.ca,
          cert: config.ssl.cert,
          ciphers: config.ssl.ciphers,
          key: config.ssl.key,
          passphrase: config.ssl.passphrase,
        });

        // "unpipe"
        connection._socket.removeAllListeners("data");
        connection._protocol.removeAllListeners("data");

        // socket <-> encrypted
        const rejectUnauthorized = config.ssl.rejectUnauthorized;
        let secureEstablished = false;
        const secureSocket = new tls.TLSSocket(connection._socket, {
          rejectUnauthorized,
          requestCert: true,
          secureContext,
          isServer: false,
        });
        connection._secureSocket = secureSocket;

        // error handler for secure socket
        secureSocket.on("_tlsError", error => {
          if (secureEstablished) {
            log.push(`network error ${error.code}`);
          } else {
            onSecure(error);
          }
        });

        // cleartext <-> protocol
        secureSocket.pipe(connection._protocol);
        connection._protocol.on("data", data => {
          secureSocket.write(data);
        });

        secureSocket.on("secure", function () {
          secureEstablished = true;
          onSecure(rejectUnauthorized ? this.ssl.verifyError() : null);
        });

        // start TLS communications
        secureSocket._start();
      }

      await Promise.race([secured.promise, closedEarly.promise]);
      let result = null;
      if (log[0] === "onSecure null") {
        connection._protocol.emit("data", Buffer.from("query"));
        result = await Promise.race([connection._protocol.received.promise, closedEarly.promise]);
      }
      // Only tls.connect() sets `authorized`. On a wrap the verdict is ssl.verifyError().
      return { log, result, authorized: connection._secureSocket.authorized };
    } finally {
      connection._secureSocket?.destroy();
      connection._socket.destroy();
    }
  }

  try {
    return {
      "rejectUnauthorized: false": await connect({ rejectUnauthorized: false }),
      "ca of the server": await connect({ ca }),
      "no ca": await connect({}),
    };
  } finally {
    server.close();
  }
}

// The peer closes the connection when the ClientHello arrives. Only tls.connect() reports
// that as ECONNRESET: a wrap ends like a stream whose peer ended.
export async function peerCloses() {
  const server = net.createServer(socket => {
    socket.on("error", () => {});
    socket.once("data", () => socket.end());
  });
  const port = await listening(server);

  async function closedByPeer(via) {
    const raw = net.connect(port, "127.0.0.1");
    raw.on("error", () => {});
    try {
      await once(raw, "connect");
      const options = { rejectUnauthorized: false };
      const socket = via === "wrap" ? new TLSSocket(raw, options) : tls.connect({ socket: raw, ...options });
      const log = [];
      socket.on("error", error => log.push(`error ${error.code}`));
      for (const event of ["secure", "end", "finish"]) socket.on(event, () => log.push(event));
      const closed = new Promise(resolve => socket.once("close", resolve));
      if (via === "wrap") socket._start();
      await closed;
      return log;
    } finally {
      raw.destroy();
    }
  }

  try {
    return { wrap: await closedByPeer("wrap"), connect: await closedByPeer("connect") };
  } finally {
    server.close();
  }
}

// A TLS 1.2 server and one session from it. With TLS 1.2 the session is ready at 'secureConnect'.
async function serverWithSession() {
  const server = tls.createServer({ key: fixture("agent1-key.pem"), cert: fixture("agent1-cert.pem"), maxVersion: "TLSv1.2" });
  server.on("secureConnection", socket => socket.on("error", () => {}).resume());
  const port = await listening(server);
  const first = tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false });
  await once(first, "secureConnect");
  const session = first.getSession();
  first.destroy();
  const connected = async () => {
    const raw = net.connect(port, "127.0.0.1");
    raw.on("error", () => {});
    await once(raw, "connect");
    return raw;
  };
  return { server, port, session, connected };
}

// A session that is set before the handshake starts is offered to the server: as an option
// on each path, and through setSession() on a socket that has not connected yet.
export async function session() {
  const { server, port, session, connected } = await serverWithSession();
  const host = "127.0.0.1";
  const options = { session, rejectUnauthorized: false };
  // The listener is attached in the turn that makes the socket: a wrap starts its handshake at once.
  async function reused(socket, event, prepare) {
    try {
      const done = once(socket, event);
      prepare?.(socket);
      await done;
      return socket.isSessionReused();
    } finally {
      socket.destroy();
    }
  }
  try {
    return {
      "tls.connect({ port, session })": await reused(tls.connect({ port, host, ...options }), "secureConnect"),
      "tls.connect({ socket, session })": await reused(
        tls.connect({ socket: await connected(), ...options }),
        "secureConnect",
      ),
      "new TLSSocket(socket, { session })": await reused(new TLSSocket(await connected(), options), "secure", socket =>
        socket._start(),
      ),
      "tls.connect({ port }), then setSession()": await reused(
        tls.connect({ port, host, rejectUnauthorized: false }),
        "secureConnect",
        socket => socket.setSession(session),
      ),
    };
  } finally {
    server.close();
  }
}

// setSession() after the handshake started. Node accepts the call, with no effect on that
// handshake. BoringSSL aborts the process for it, so the test runs this one as a script.
// Node starts the handshake of a wrap in _start(), so in the first shape the session is in
// time on node, and only there.
export async function lateSetSession() {
  const { server, port, session, connected } = await serverWithSession();
  const options = { rejectUnauthorized: false };
  async function completes(socket, event, start) {
    try {
      const done = once(socket, event);
      socket.setSession(session);
      start?.(socket);
      await done;
      return { event, reused: socket.isSessionReused() };
    } finally {
      socket.destroy();
    }
  }
  async function afterSecureConnect() {
    const socket = tls.connect({ port, host: "127.0.0.1", ...options });
    try {
      await once(socket, "secureConnect");
      socket.setSession(session);
      return socket.isSessionReused();
    } finally {
      socket.destroy();
    }
  }
  try {
    return {
      "new TLSSocket(socket), then setSession() and _start()": await completes(
        new TLSSocket(await connected(), options),
        "secure",
        socket => socket._start(),
      ),
      "tls.connect({ socket }), then setSession()": await completes(
        tls.connect({ socket: await connected(), ...options }),
        "secureConnect",
      ),
      "setSession() after 'secureConnect', isSessionReused()": await afterSecureConnect(),
    };
  } finally {
    server.close();
  }
}

if (import.meta.main) {
  const reports = { shutdown, mysql, "peer-closes": peerCloses, session, "late-set-session": lateSetSession };
  // Ends the run at once, also while the await below is still pending.
  process.on("uncaughtException", error => {
    console.error(error);
    process.exit(1);
  });
  console.log(JSON.stringify(await reports[process.argv[2]]()));
  process.exit(0);
}
