// Prints the AsyncLocalStorage store that the process reads while it handles a throw of a callback that
// native code delivers: { [observer]: { [source]: { [how the callback throws]: store } } }.
//
//   node uncaught-exception-store-fixture.cjs <empty directory> [listener|capture] [source...]
//
// "listener" observes with 'uncaughtException' and 'uncaughtExceptionMonitor' listeners, "capture" with
// process.setUncaughtExceptionCaptureCallback(). It runs the same under Node.js, without the sources of Bun's own APIs.
const { AsyncLocalStorage } = require("node:async_hooks");
const fs = require("node:fs");
const path = require("node:path");

const [directory, observer = "listener", ...only] = process.argv.slice(2);
const als = new AsyncLocalStorage();
const swallow = () => {};

// A directory of its own for each watcher.
let subdirectories = 0;
function subdirectory() {
  const made = path.join(directory, String(++subdirectories));
  fs.mkdirSync(made);
  return made;
}

// Writes to `file` until `stop()`: a watcher reports a write that follows its start, and how soon it starts differs.
function keepWriting(file) {
  let size = 0;
  const write = () => fs.writeFileSync(file, Buffer.alloc(++size, "x"));
  write();
  const timer = setInterval(write, 10);
  return () => clearInterval(timer);
}

function request(server, options, body) {
  const { port } = server.address();
  const outgoing = require("node:http").request({ port, host: "127.0.0.1", agent: false, ...options }, response =>
    response.resume(),
  );
  outgoing.on("error", swallow);
  outgoing.end(body);
}

// An HTTP/2 server that answers every stream, and a client session of it.
function http2Pair(step, connected) {
  const http2 = require("node:http2");
  const server = http2.createServer();
  server.on("stream", stream => {
    stream.respond({ ":status": 200 });
    stream.end("ok");
  });
  server.listen(0, "127.0.0.1", () => {
    const client = step("connect()", () => http2.connect("http://127.0.0.1:" + server.address().port));
    client.on("error", swallow);
    connected(client, () => {
      client.destroy();
      server.close();
    });
  });
}

// An HTTP/2 server that `listening(server, close)` adds its listeners to, and a client session of it.
function http2Server(step, listening, connected = swallow) {
  const http2 = require("node:http2");
  const server = step("createServer()", () => http2.createServer());
  let client;
  step("the server's listeners", () =>
    listening(server, () => {
      client.destroy();
      server.close();
    }),
  );
  step("listen()", () =>
    server.listen(0, "127.0.0.1", () =>
      step("the client", () => {
        client = http2.connect("http://127.0.0.1:" + server.address().port);
        client.on("error", swallow);
        connected(client);
      }),
    ),
  );
}

// How each callback is scheduled. Every source calls `boom` one time, from the callback that native code calls.
// A source that takes more than one call to schedule gives each of them to `step`, with a name.
const sources = {
  "crypto.randomBytes": boom => require("node:crypto").randomBytes(8, boom),
  "crypto.randomFill": boom => require("node:crypto").randomFill(Buffer.alloc(8), boom),
  "crypto.pbkdf2": boom => require("node:crypto").pbkdf2("password", "salt", 1, 8, "sha1", boom),
  "crypto.scrypt": boom => require("node:crypto").scrypt("password", "salt", 8, boom),
  "crypto.hkdf": boom => require("node:crypto").hkdf("sha256", "key", "salt", "info", 8, boom),
  "crypto.generateKeyPair": boom => require("node:crypto").generateKeyPair("ec", { namedCurve: "P-256" }, boom),
  "crypto.generatePrime": boom => require("node:crypto").generatePrime(32, boom),
  "crypto.checkPrime": boom => require("node:crypto").checkPrime(7n, boom),
  "zlib stream 'data'": (boom, step) => {
    const gzip = step("createGzip()", () => require("node:zlib").createGzip());
    step("once('data')", () => gzip.once("data", boom));
    step("end()", () => gzip.end("x"));
  },
  "fs.watch listener": boom => {
    const watched = subdirectory();
    let stop;
    const watcher = fs.watch(watched, () => {
      if (!stop) return;
      stop();
      stop = undefined;
      watcher.close();
      boom();
    });
    stop = keepWriting(path.join(watched, "file"));
  },
  "fs.watchFile listener, file that does not exist": boom => {
    const file = path.join(subdirectory(), "missing");
    fs.watchFile(file, { interval: 5 }, function listener() {
      fs.unwatchFile(file, listener);
      boom();
    });
  },
  "fs.watchFile listener, file that changes": boom => {
    const file = path.join(subdirectory(), "file");
    const stop = keepWriting(file);
    fs.watchFile(file, { interval: 5 }, function listener() {
      stop();
      fs.unwatchFile(file, listener);
      boom();
    });
  },
  // The child has a channel to its parent, sends one message over it, and exits.
  "child_process 'message'": (boom, step) => {
    const child = step("spawn()", () =>
      require("node:child_process").spawn(process.execPath, ["-e", "process.send('x')"], {
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      }),
    );
    step("once('message')", () => child.once("message", boom));
  },
  // One step makes the socket and binds it. A socket that another store binds is a matter of node:dgram, not of the
  // report: there Bun runs 'message' in the store of the call that binds, and node in the store of createSocket().
  "dgram 'message'": (boom, step) => {
    const socket = step("createSocket() and bind()", () => {
      const socket = require("node:dgram").createSocket("udp4");
      socket.bind(0, "127.0.0.1", () => step("send()", () => socket.send("x", socket.address().port, "127.0.0.1")));
      return socket;
    });
    step("on('message')", () =>
      socket.on("message", () => {
        socket.close();
        boom();
      }),
    );
  },
  "http server 'request'": (boom, step) => {
    const server = step("createServer()", () =>
      require("node:http").createServer((incoming, response) => {
        response.end("ok");
        server.close();
        boom();
      }),
    );
    step("listen()", () => server.listen(0, "127.0.0.1", () => step("the client", () => request(server))));
  },
  "http server request 'data'": (boom, step) => {
    const server = step("createServer()", () =>
      require("node:http").createServer((incoming, response) => {
        step("once('data')", () =>
          incoming.once("data", () => {
            response.end("ok");
            server.close();
            boom();
          }),
        );
      }),
    );
    step("listen()", () =>
      server.listen(0, "127.0.0.1", () => step("the client", () => request(server, { method: "POST" }, "body"))),
    );
  },
  "http server 'connection'": (boom, step) => {
    const server = step("createServer()", () =>
      require("node:http").createServer((incoming, response) => response.end("ok")),
    );
    step("once('connection')", () =>
      server.once("connection", () => {
        server.close();
        boom();
      }),
    );
    step("listen()", () => server.listen(0, "127.0.0.1", () => step("the client", () => request(server))));
  },
  "http server 'clientError'": (boom, step) => {
    const server = step("createServer()", () => require("node:http").createServer(swallow));
    step("once('clientError')", () =>
      server.once("clientError", (error, socket) => {
        socket.destroy();
        server.close();
        boom();
      }),
    );
    step("listen()", () =>
      server.listen(0, "127.0.0.1", () =>
        step("the client", () => {
          const socket = require("node:net").connect(server.address().port, "127.0.0.1", () =>
            socket.write("not http\r\n\r\n"),
          );
          socket.on("error", swallow);
          socket.resume();
        }),
      ),
    );
  },
  "http2 server 'stream'": (boom, step) =>
    http2Server(
      step,
      (server, close) =>
        server.once("stream", stream => {
          stream.respond({ ":status": 200 });
          stream.end("ok");
          close();
          boom();
        }),
      client => {
        const stream = client.request({ ":path": "/" });
        stream.on("error", swallow);
        stream.resume();
        stream.end();
      },
    ),
  "http2 client 'response'": (boom, step) =>
    http2Pair(step, (client, close) => {
      const stream = step("request()", () => client.request({ ":path": "/" }));
      stream.on("error", swallow);
      step("once('response')", () =>
        stream.once("response", () => {
          close();
          boom();
        }),
      );
      stream.end();
    }),
  "http2 client ping() callback": (boom, step) =>
    http2Pair(step, (client, close) =>
      client.once("connect", () =>
        step("ping()", () =>
          client.ping(() => {
            close();
            boom();
          }),
        ),
      ),
    ),
  "http2 client settings() callback": (boom, step) =>
    http2Pair(step, (client, close) =>
      client.once("connect", () =>
        step("settings()", () =>
          client.settings({ enablePush: false }, () => {
            close();
            boom();
          }),
        ),
      ),
    ),
  "http2 server settings() callback": (boom, step) =>
    http2Server(step, (server, close) =>
      server.once("session", session => {
        session.on("error", swallow);
        step("settings()", () =>
          session.settings({ enablePush: false }, () => {
            close();
            boom();
          }),
        );
      }),
    ),
  "http2 server ping() callback": (boom, step) =>
    http2Server(step, (server, close) =>
      server.once("session", session => {
        session.on("error", swallow);
        step("ping()", () =>
          session.ping(() => {
            close();
            boom();
          }),
        );
      }),
    ),
  "queueMicrotask": boom => queueMicrotask(boom),
  // These two were right before the native callbacks were: they show what the others are compared with.
  "setTimeout": boom => setTimeout(boom, 1),
  "process.nextTick": boom => process.nextTick(boom),
};

// Callbacks of Bun's own APIs. A socket gives what its handler throws to its `error` handler. What that one
// throws is uncaught. With no `error` handler, the throw of the first handler is.
if (typeof Bun !== "undefined") {
  const connectAndWrite = port =>
    Bun.connect({
      hostname: "127.0.0.1",
      port,
      socket: { open: socket => void socket.write("x"), data: swallow, error: swallow, connectError: swallow },
    });
  const listen = socket => {
    const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket });
    connectAndWrite(listener.port);
    return listener;
  };
  const udp = async handlers => {
    const socket = await Bun.udpSocket({ hostname: "127.0.0.1", port: 0, socket: handlers(() => socket.close()) });
    socket.send("x", socket.port, "127.0.0.1");
  };
  const serveWebSocket = websocket => {
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: (incoming, server) => (server.upgrade(incoming) ? undefined : new Response("not a websocket")),
      websocket,
    });
    const client = new WebSocket("ws://127.0.0.1:" + server.port);
    client.onopen = () => client.send("x");
    client.onerror = swallow;
    return () => {
      client.close();
      server.stop(true);
    };
  };
  const given = () => {
    throw new Error("given to the `error` handler");
  };
  Object.assign(sources, {
    "Bun.spawn onExit": boom => {
      Bun.spawn({ cmd: [process.execPath, "-e", ""], stdio: ["ignore", "ignore", "ignore"], onExit: boom });
    },
    // A tick is a minute away, so the clock is a fake one. That makes the tick run inside advanceTimersByTime(),
    // which is called in no store here: the store the handler reads is not the caller's.
    "Bun.cron tick": boom => {
      const { jest } = require("bun:test");
      jest.useFakeTimers();
      try {
        const job = Bun.cron("* * * * *", () => {
          job.stop();
          boom();
        });
        als.exit(() => jest.advanceTimersByTime(60_000));
      } finally {
        jest.useRealTimers();
      }
    },
    // close() calls `exit` before it returns. It is called in no store here, as advanceTimersByTime() is above.
    "Bun.Terminal `exit` callback": boom => {
      const terminal = new Bun.Terminal({ cols: 80, rows: 24, data: swallow, exit: boom });
      als.exit(() => terminal.close());
    },
    "Bun.listen socket `error` handler": boom => {
      const listener = listen({
        data: given,
        error(socket) {
          socket.end();
          listener.stop();
          boom();
        },
      });
    },
    "Bun.udpSocket `error` handler": boom => {
      udp(close => ({
        data: given,
        error() {
          close();
          boom();
        },
      }));
    },
    "Bun.serve websocket `error` handler": boom => {
      const close = serveWebSocket({
        message: given,
        error() {
          close();
          boom();
        },
      });
    },
    "Bun.listen socket `data` handler, no `error` handler": boom => {
      const listener = listen({
        data(socket) {
          socket.end();
          listener.stop();
          boom();
        },
      });
    },
    "Bun.udpSocket `data` handler, no `error` handler": boom => {
      udp(close => ({
        data() {
          close();
          boom();
        },
      }));
    },
    "Bun.serve websocket `message` handler, no `error` handler": boom => {
      const close = serveWebSocket({
        message() {
          close();
          boom();
        },
      });
    },
  });
}

// How the callback throws. Every one but "scheduled with no store" is scheduled inside als.run("outer").
const inline = (name, call) => call();
const ways = {
  "throws": (schedule, error) =>
    als.run("outer", () =>
      schedule(() => {
        throw error;
      }, inline),
    ),
  "throws inside its own run()": (schedule, error) =>
    als.run("outer", () =>
      schedule(
        () =>
          als.run("inner", () => {
            throw error;
          }),
        inline,
      ),
    ),
  "throws after its own enterWith()": (schedule, error) =>
    als.run("outer", () =>
      schedule(() => {
        als.enterWith("entered");
        throw error;
      }, inline),
    ),
  "scheduled with no store, throws inside its own run()": (schedule, error) =>
    schedule(
      () =>
        als.run("inner", () => {
          throw error;
        }),
      inline,
    ),
  // Which of the calls that schedule the callback gives it its store: each step runs in a store that has its name.
  "every step in its own store": (schedule, error) =>
    als.run("outer", () =>
      schedule(
        () => {
          throw error;
        },
        (name, call) => als.run(name, call),
      ),
    ),
};

const names = only.length ? only : Object.keys(sources);
const rows = new Map();
const seen = {};
let left = names.length * Object.keys(ways).length;

function record(observedBy, error) {
  const row = rows.get(error);
  if (!row) throw error;
  ((seen[observedBy] ??= {})[row.source] ??= {})[row.way] = String(als.getStore());
}
function handled() {
  if (--left > 0) return;
  console.log(JSON.stringify(seen));
  process.exit(0);
}

if (observer === "capture") {
  process.setUncaughtExceptionCaptureCallback(error => {
    record("capture", error);
    handled();
  });
} else {
  process.on("uncaughtExceptionMonitor", error => record("monitor", error));
  process.on("uncaughtException", error => {
    record("listener", error);
    handled();
  });
}

for (const source of names) {
  for (const way of Object.keys(ways)) {
    const error = new Error(source + ": " + way);
    rows.set(error, { source, way });
    ways[way](sources[source], error);
  }
}
