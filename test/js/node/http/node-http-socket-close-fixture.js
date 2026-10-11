// Every row closes one connection of a node:http server and records, in order, what its
// connection socket (req.socket) and its response emit. SECURE=1 runs the rows over https.
// The rows run at the same time. The only line of stdout is the result as JSON, printed when
// the process exits: a 'close' that never comes is a missing entry.
// Under Node.js (`node <this file>`) every row prints the same entries.
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
const tls = require("node:tls");
const { Duplex, finished, pipeline, Readable } = require("node:stream");
const fs = require("node:fs");
const path = require("node:path");

const secure = process.env.SECURE === "1";
const keys = path.join(__dirname, "..", "test", "fixtures", "keys");
const tlsOptions = secure
  ? {
      key: fs.readFileSync(path.join(keys, "agent1-key.pem")),
      cert: fs.readFileSync(path.join(keys, "agent1-cert.pem")),
    }
  : {};

const seen = {};
const atExit = [];
process.on("exit", () => {
  for (const record of atExit) record();
  console.log(JSON.stringify(seen));
});
// The message of every error that a row creates is "<name of the row> | <what>".
const what = err => err.code ?? String(err.message).split(" | ")[1];
process.on("uncaughtException", err => {
  const [name] = String(err.message).split(" | ");
  (seen[name] ?? (seen["no row"] ??= [])).push(`uncaught: ${what(err) ?? err.message}`);
});

const get = "GET / HTTP/1.1\r\nHost: x\r\n\r\n";
const upgrade = "GET / HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: x\r\n\r\n";
const connect = "CONNECT x:80 HTTP/1.1\r\nHost: x:80\r\n\r\n";

// `on` holds the listeners of the row's server. Each gets the context of the row first.
// `wire` is what the client sends. `serverClose` records, as the last entry, whether the
// callback of server.close() ran: Node and Bun call it at different points.
function row(name, on, { wire = get, clientReads = true, overTls = true, serverClose = false } = {}) {
  if (secure && !overTls) return;
  const events = (seen[name] = []);
  const server = secure ? https.createServer(tlsOptions) : http.createServer();
  let serverClosed = false;
  if (serverClose) atExit.push(() => events.push(serverClosed ? "server close" : "server open"));
  const context = {
    events,
    server,
    // The client, and the TCP socket under it.
    client: undefined,
    tcp: undefined,
    error: reason => new Error(`${name} | ${reason}`),
    // Records the 'error' and the 'close' of the connection socket, and the 'close' of the
    // response when there is one. 'error' is recorded at the emit: that adds no listener.
    watch(socket, res) {
      const emit = socket.emit;
      socket.emit = function (event, err) {
        if (event === "error") events.push(`socket error: ${what(err)}`);
        return emit.apply(this, arguments);
      };
      socket.on("close", (...args) => events.push(`socket close ${args.join()}`));
      res?.on("close", () => events.push("response close"));
    },
  };
  for (const event in on) server.on(event, on[event].bind(undefined, context));
  server.listen(0, "127.0.0.1", () => {
    const tcp = (context.tcp = net.connect(server.address().port, "127.0.0.1"));
    tcp.on("error", () => {});
    tcp.on("close", () => server.close(() => (serverClosed = true)));
    const client = (context.client = secure ? tls.connect({ socket: tcp, rejectUnauthorized: false }) : tcp);
    client.on("error", () => {});
    if (clientReads) client.resume();
    else client.pause();
    client.write(wire);
  });
}

// Over TLS, Node reports a reset that comes inside the server's own read as the end of the stream.
const reset = tcp => setImmediate(() => tcp.resetAndDestroy());

// No listener throws: 'close' has the hadError argument of net.Socket.
row("destroy()", {
  request({ watch }, req, res) {
    watch(req.socket, res);
    req.socket.destroy();
  },
});
row("destroy(err)", {
  request({ watch, error, events }, req, res) {
    watch(req.socket, res);
    const { _writableState: writable, _readableState: readable } = req.socket;
    req.socket.on("close", () => events.push(`closeEmitted ${writable.closeEmitted} ${readable.closeEmitted}`));
    req.socket.destroy(error("destroyed"));
  },
});
row("destroy(err) twice", {
  request({ watch, error }, req, res) {
    watch(req.socket, res);
    req.socket.destroy(error("first"));
    req.socket.destroy(error("second"));
  },
});
row("res.destroy(err)", {
  request({ watch, error }, req, res) {
    watch(req.socket, res);
    res.destroy(error("destroyed"));
  },
});
row("destroySoon()", {
  request({ watch }, req, res) {
    watch(req.socket, res);
    req.socket.destroySoon();
  },
});
// Node's TLSSocket has no resetAndDestroy().
row(
  "resetAndDestroy()",
  {
    request({ watch }, req, res) {
      watch(req.socket, res);
      req.socket.resetAndDestroy();
    },
  },
  { overTls: false },
);
row("response with Connection: close", {
  request({ watch }, req, res) {
    watch(req.socket, res);
    res.setHeader("Connection", "close");
    res.end("ok");
  },
});
row("closeAllConnections()", {
  request({ watch, server }, req, res) {
    watch(req.socket, res);
    server.closeAllConnections();
  },
});
row("closeIdleConnections()", {
  request({ watch, server }, req, res) {
    watch(req.socket, res);
    res.end("ok", () => server.closeIdleConnections());
  },
});
row("socket timeout", {
  request({ watch }, req, res) {
    watch(req.socket, res);
    req.socket.setTimeout(1);
  },
});
row("client FIN", {
  request({ watch, client }, req, res) {
    watch(req.socket, res);
    client.end();
  },
});
row("client RST", {
  request({ watch, tcp }, req, res) {
    watch(req.socket, res);
    reset(tcp);
  },
});

// The 'error' emit of the socket throws. 'close' still comes, after the uncaught exception.
row("destroy(err), no 'error' listener", {
  request({ watch, error }, req, res) {
    watch(req.socket, res);
    req.socket.removeAllListeners("error");
    req.socket.destroy(error("destroyed"));
  },
});
row("destroy(err), 'error' listener throws", {
  request({ watch, error }, req, res) {
    watch(req.socket, res);
    req.socket.on("error", () => {
      throw error("thrown by 'error'");
    });
    req.socket.destroy(error("destroyed"));
  },
});
for (const [call, destroy] of [
  ["destroy(err)", (req, res, err) => req.socket.destroy(err)],
  ["res.destroy(err)", (req, res, err) => res.destroy(err)],
  ["req.destroy(err)", (req, res, err) => req.destroy(err)],
]) {
  row(`${call}, 'clientError' listener throws`, {
    request({ watch, error }, req, res) {
      watch(req.socket, res);
      destroy(req, res, error("destroyed"));
    },
    clientError({ error }) {
      throw error("thrown by 'clientError'");
    },
  });
}
row("pipeline() to the response fails, 'clientError' listener throws", {
  request({ watch, error, events }, req, res) {
    watch(req.socket, res);
    const source = new Readable({ read() {} });
    pipeline(source, res, err => events.push(`pipeline callback: ${what(err)}`));
    source.destroy(error("destroyed"));
  },
  clientError({ error }) {
    throw error("thrown by 'clientError'");
  },
});
row("client RST, 'clientError' listener throws", {
  request({ watch, tcp }, req, res) {
    watch(req.socket, res);
    reset(tcp);
  },
  clientError({ error }) {
    throw error("thrown by 'clientError'");
  },
});
row("destroy(err) in 'connection', no 'error' listener", {
  [secure ? "secureConnection" : "connection"]({ watch, error }, socket) {
    watch(socket);
    socket.removeAllListeners("error");
    socket.destroy(error("destroyed"));
  },
});
// A handed-off socket has no 'error' listener. Node's TLSSocket keeps one of its own.
for (const [event, wire] of [
  ["upgrade", upgrade],
  ["connect", connect],
]) {
  row(
    `destroy(err) of the '${event}' socket`,
    {
      [event]({ watch, error }, req, socket) {
        watch(socket);
        if (secure) socket.removeAllListeners("error");
        socket.destroy(error("destroyed"));
      },
    },
    { wire },
  );
  row(
    `destroy(err) of the '${event}' socket, server.close() pending`,
    {
      [event]({ watch, error, server }, req, socket) {
        watch(socket);
        if (secure) socket.removeAllListeners("error");
        server.close();
        socket.destroy(error("destroyed"));
      },
    },
    { wire },
  );
}

// emitClose is off, as for net.Socket: finished() does not wait for 'close'.
row(
  "finished() of a tunnel that both sides end",
  {
    connect({ watch, events, client }, req, socket) {
      watch(socket);
      finished(socket, err => events.push(`finished ${err?.code}`));
      socket.write("HTTP/1.1 200 OK\r\n\r\n");
      socket.resume();
      socket.on("end", () => socket.end());
      client.end();
    },
  },
  { wire: connect },
);

// A 'readable' listener throws while the closed connection is released. The release still
// completes: the socket closes, the server no longer counts it, and server.close() calls back.
// Node closes this socket when its keep-alive timeout ends, so the row takes 5 seconds there.
// Bun closes it at the FIN, and its keep-alive timer must not come first on a slow machine.
row(
  "idle connection, 'readable' listener throws at the client's FIN",
  {
    request({ watch, error, events, client, server }, req, res) {
      if (process.versions.bun) server.keepAliveTimeout = 0;
      watch(req.socket, res);
      req.socket.on("close", () => server.getConnections((err, count) => events.push(`connections ${count}`)));
      req.socket.on("readable", () => {
        throw error("thrown by 'readable'");
      });
      client.once("data", () => client.end());
      res.end("ok");
    },
  },
  { serverClose: true },
);

// The callback of destroy() throws. Node drops what it throws, and emits no 'error': https://github.com/nodejs/node/blob/v26.3.0/lib/internal/streams/destroy.js#L121-L125
row("destroy(err, callback), callback throws", {
  request({ watch, error }, req, res) {
    watch(req.socket, res);
    req.socket.destroy(error("destroyed"), () => {
      throw error("thrown by the callback");
    });
  },
});
row("destroy(undefined, callback), callback throws", {
  request({ watch, error }, req, res) {
    watch(req.socket, res);
    req.socket.destroy(undefined, () => {
      throw error("thrown by the callback");
    });
  },
});

// A write to a tunnel waits for the client, which does not read. Its callback throws when the connection goes.
const unread = Buffer.alloc(32 * 1024 * 1024, "x");
row(
  "tunnel write callback throws, destroy()",
  {
    connect({ watch, error, tcp }, req, socket) {
      watch(socket);
      socket.write("HTTP/1.1 200 OK\r\n\r\n");
      socket.write(unread, () => {
        throw error("thrown by the write callback");
      });
      socket.destroy();
      // The client does not read, so it does not see that the server went away.
      tcp.destroy();
    },
  },
  { wire: connect, clientReads: false },
);
row(
  "tunnel write callback throws, client RST",
  {
    connect({ events, error, tcp }, req, socket) {
      // Without watch(): Bun does not report the reset of a tunnel as an error yet, Node does.
      socket.on("close", () => events.push("socket close"));
      socket.on("error", () => {});
      socket.write("HTTP/1.1 200 OK\r\n\r\n");
      socket.write(unread, () => {
        throw error("thrown by the write callback");
      });
      reset(tcp);
    },
  },
  { wire: connect, clientReads: false },
);

// A stream that is not a connection socket keeps the rule of the stream layer, as in Node:
// what throws inside destroy() skips its 'close'.
if (!secure) {
  const stream = (name, run) => run((seen[name] = []), reason => new Error(`${name} | ${reason}`));
  stream("Readable: destroy(err), 'error' listener throws", (events, error) => {
    const readable = new Readable({ read() {} });
    readable.on("close", () => events.push("close"));
    readable.on("error", () => {
      throw error("thrown by 'error'");
    });
    readable.destroy(error("destroyed"));
  });
  stream("Duplex with an asynchronous _destroy(): destroy(undefined, callback), callback throws", (events, error) => {
    const duplex = new Duplex({
      read() {},
      write(chunk, encoding, callback) {
        callback();
      },
      destroy(err, callback) {
        setImmediate(callback, err);
      },
    });
    duplex.on("close", () => events.push("close"));
    duplex.destroy(undefined, () => {
      throw error("thrown by the callback");
    });
  });
}
