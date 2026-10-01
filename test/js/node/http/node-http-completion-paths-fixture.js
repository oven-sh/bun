// The ways a node:http exchange ends. For each one: the order of the 'finish', 'close' and
// 'aborted' events, the event loop refs that are left once the server closed, and the native
// responses that a full GC leaves.
//
// usage: <paths|emitted>. Prints one JSON line per path.
//   paths:   the ways that need no help from user code.
//   emitted: user code emits 'close' by hand on the way.
"use strict";
const { once } = require("node:events");
const http = require("node:http");
const net = require("node:net");
const { getEventLoopStats } = require("bun:internal-for-testing");
const { heapStats } = require("bun:jsc");
const { WebSocketServer } = require("ws");

const turn = () => new Promise(resolve => setImmediate(resolve));
const closeOf = emitter => new Promise(resolve => emitter.once("close", resolve));
const activeTasks = () => getEventLoopStats().activeTasks;
// heapStats() counts the prototype object of the class under the same name.
const prototypeObjects = 1;
// A closed connection frees its native objects some turns of the event loop later. Resolves
// with the native responses that a full GC leaves, at once when it leaves none.
async function nativeResponsesLeft() {
  let left = Infinity;
  for (let i = 0; i < 64 && left > 0; i++) {
    await turn();
    Bun.gc(true);
    left = Math.min(left, Math.max(0, (heapStats().objectTypeCounts.NodeHTTPResponse ?? 0) - prototypeObjects));
  }
  return left;
}

const get = (url, headers = "") => `GET ${url} HTTP/1.1\r\nHost: localhost\r\n${headers}\r\n`;
const post = (url, declared, sent) =>
  `POST ${url} HTTP/1.1\r\nHost: localhost\r\nContent-Length: ${declared}\r\n\r\n${sent}`;
const upgradeRequest = get("/", "Connection: Upgrade\r\nUpgrade: custom\r\n");
const connectRequest = "CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n";
const switchingProtocols = "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: custom\r\n\r\n";
const established = "HTTP/1.1 200 Connection Established\r\n\r\n";

// Records the events of an exchange as "<url> <event>". Calls `onClose` at the 'close' of the response.
function record(events, req, res, onClose) {
  req.on("error", () => {});
  res.on("error", () => {});
  req.on("aborted", () => events.push(`${req.url} aborted`));
  res.on("finish", () => events.push(`${req.url} finish`));
  res.on("close", () => {
    events.push(`${req.url} close`);
    onClose();
  });
}

// The server side of a tunnel: it answers with `head`, echoes what it gets, and ends when the client ends.
function echoTunnel(events, socket, head, onClose) {
  socket.on("error", () => {});
  socket.on("data", chunk => socket.write(chunk));
  socket.on("end", () => socket.end());
  socket.on("close", () => {
    events.push("socket close");
    onClose();
  });
  socket.write(head);
}
// The client side: it sends "ping" when the tunnel is open, and ends when the echo is back.
function useTunnel(client, request) {
  let received = "";
  let sent = false;
  client.on("data", chunk => {
    received += chunk.toString("latin1");
    if (!sent && received.includes("\r\n\r\n")) {
      sent = true;
      client.write("ping");
    }
    if (received.includes("ping")) client.end();
  });
  client.write(request);
}

class ResponseWithAssignSocket extends http.ServerResponse {
  assignSocket(socket) {
    super.assignSocket(socket);
  }
}

const paths = {
  "end in the listener": async ({ server, connect, events }) => {
    const closed = Promise.withResolvers();
    server.on("request", (req, res) => {
      record(events, req, res, closed.resolve);
      res.end("body");
    });
    (await connect()).write(get("/"));
    await closed.promise;
  },
  "end after an await": async ({ server, connect, events }) => {
    const closed = Promise.withResolvers();
    server.on("request", async (req, res) => {
      record(events, req, res, closed.resolve);
      await null;
      res.end("body");
    });
    (await connect()).write(get("/"));
    await closed.promise;
  },
  "end in a later turn": async ({ server, connect, events }) => {
    const closed = Promise.withResolvers();
    server.on("request", (req, res) => {
      record(events, req, res, closed.resolve);
      setImmediate(() => res.end("body"));
    });
    (await connect()).write(get("/"));
    await closed.promise;
  },
  "a body that drains while the client does not read": async ({ server, connect, events }) => {
    const ended = Promise.withResolvers();
    const closed = Promise.withResolvers();
    server.on("request", (req, res) => {
      record(events, req, res, closed.resolve);
      res.end(Buffer.alloc(32 * 1024 * 1024, "a"));
      setImmediate(ended.resolve);
    });
    const client = await connect();
    client.pause();
    client.write(get("/"));
    await ended.promise;
    client.resume();
    await closed.promise;
  },
  "the client leaves": async ({ server, connect, events }) => {
    const arrived = Promise.withResolvers();
    const closed = Promise.withResolvers();
    server.on("request", (req, res) => {
      record(events, req, res, closed.resolve);
      arrived.resolve();
    });
    const client = await connect();
    client.write(get("/"));
    await arrived.promise;
    client.destroy();
    await closed.promise;
  },
  "res.destroy()": async ({ server, connect, events }) => {
    const closed = Promise.withResolvers();
    server.on("request", (req, res) => {
      record(events, req, res, closed.resolve);
      setImmediate(() => res.destroy());
    });
    (await connect()).write(get("/"));
    await closed.promise;
  },
  "a body that nothing reads": async ({ server, connect, events }) => {
    const closed = Promise.withResolvers();
    server.on("request", (req, res) => {
      record(events, req, res, closed.resolve);
      setImmediate(() => res.end("body"));
    });
    (await connect()).write(post("/", 5, "hello"));
    await closed.promise;
  },
  "half of a body, then the end of the response": async ({ server, connect, events }) => {
    const closed = Promise.withResolvers();
    server.on("request", (req, res) => {
      record(events, req, res, closed.resolve);
      setImmediate(() => res.end("body"));
    });
    (await connect()).write(post("/", 10, "hello"));
    await closed.promise;
  },
  "half of a body, then the client leaves": async ({ server, connect, events }) => {
    const arrived = Promise.withResolvers();
    const closed = Promise.withResolvers();
    server.on("request", (req, res) => {
      record(events, req, res, closed.resolve);
      arrived.resolve();
    });
    const client = await connect();
    client.write(post("/", 10, "hello"));
    await arrived.promise;
    client.destroy();
    await closed.promise;
  },
  "two pipelined requests": async ({ server, connect, events }) => {
    const closed = [Promise.withResolvers(), Promise.withResolvers()];
    let first;
    server.on("request", (req, res) => {
      if (req.url === "/first") {
        first = res;
        record(events, req, res, closed[0].resolve);
        return;
      }
      record(events, req, res, closed[1].resolve);
      res.end("second");
      setImmediate(() => {
        first.end("first");
        // The server keeps this listener, and with it this variable, for a while after its close.
        first = undefined;
      });
    });
    (await connect()).write(get("/first") + get("/second"));
    await closed[0].promise;
    await closed[1].promise;
  },
  "a 'connect' listener takes the socket": async ({ server, connect, events }) => {
    const closed = Promise.withResolvers();
    server.on("connect", (req, socket) => echoTunnel(events, socket, established, closed.resolve));
    useTunnel(await connect(), connectRequest);
    await closed.promise;
  },
  "an 'upgrade' listener takes the socket": async ({ server, connect, events }) => {
    const closed = Promise.withResolvers();
    server.on("upgrade", (req, socket) => echoTunnel(events, socket, switchingProtocols, closed.resolve));
    useTunnel(await connect(), upgradeRequest);
    await closed.promise;
  },
  "ws takes the socket of an 'upgrade'": async ({ server, events }) => {
    const wss = new WebSocketServer({ noServer: true });
    const serverSideClosed = Promise.withResolvers();
    server.on("upgrade", (req, socket, head) => {
      wss.handleUpgrade(req, socket, head, ws => {
        ws.on("message", message => ws.send(String(message)));
        ws.on("close", () => {
          events.push("ws close");
          serverSideClosed.resolve();
        });
      });
    });
    const client = new WebSocket(`ws://127.0.0.1:${server.address().port}/`);
    const clientSideClosed = Promise.withResolvers();
    client.onopen = () => client.send("ping");
    client.onmessage = () => client.close();
    client.onclose = clientSideClosed.resolve;
    await clientSideClosed.promise;
    await serverSideClosed.promise;
    wss.close();
  },
};

// 'close' is emitted by hand first. The listeners that record come after it, so they record
// what node:http emits.
const emitted = {
  "res.emit('close'), then end()": async ({ server, connect, events }) => {
    const closed = Promise.withResolvers();
    server.on("request", (req, res) => {
      setImmediate(() => {
        res.emit("close");
        record(events, req, res, closed.resolve);
        setImmediate(() => res.end("body"));
      });
    });
    (await connect()).write(get("/"));
    await closed.promise;
  },
  "res.emit('close'), then the client leaves": async ({ server, connect, events }) => {
    const emittedByHand = Promise.withResolvers();
    const closed = Promise.withResolvers();
    server.on("request", (req, res) => {
      setImmediate(() => {
        res.emit("close");
        record(events, req, res, closed.resolve);
        emittedByHand.resolve();
      });
    });
    const client = await connect();
    client.write(get("/"));
    await emittedByHand.promise;
    client.destroy();
    await closed.promise;
  },
  "res.emit('close'), then res.destroy()": async ({ server, connect, events }) => {
    const closed = Promise.withResolvers();
    server.on("request", (req, res) => {
      setImmediate(() => {
        res.emit("close");
        record(events, req, res, closed.resolve);
        setImmediate(() => res.destroy());
      });
    });
    (await connect()).write(get("/"));
    await closed.promise;
  },
  "socket.emit('close') with an own assignSocket()": {
    options: { ServerResponse: ResponseWithAssignSocket },
    run: async ({ server, connect, events }) => {
      const closed = Promise.withResolvers();
      server.on("request", (req, res) => {
        record(events, req, res, closed.resolve);
        res.flushHeaders();
        setImmediate(() => req.socket.emit("close"));
      });
      (await connect()).write(get("/"));
      await closed.promise;
    },
  },
  "socket.emit('close') in a 'connect' tunnel": async ({ server, connect, events }) => {
    const closed = Promise.withResolvers();
    server.on("connect", (req, socket) => {
      setImmediate(() => {
        socket.emit("close");
        echoTunnel(events, socket, established, closed.resolve);
      });
    });
    useTunnel(await connect(), connectRequest);
    await closed.promise;
  },
  "socket.emit('close') in an 'upgrade' tunnel": async ({ server, connect, events }) => {
    const closed = Promise.withResolvers();
    server.on("upgrade", (req, socket) => {
      setImmediate(() => {
        socket.emit("close");
        echoTunnel(events, socket, switchingProtocols, closed.resolve);
      });
    });
    useTunnel(await connect(), upgradeRequest);
    await closed.promise;
  },
};

async function measure(path, entry) {
  const { options = {}, run } = typeof entry === "function" ? { run: entry } : entry;
  const events = [];
  const before = activeTasks();
  const server = http.createServer(options);
  await once(server.listen(0, "127.0.0.1"), "listening");
  const clients = [];
  async function connect() {
    const client = net.connect(server.address().port, "127.0.0.1");
    client.on("error", () => {});
    clients.push({ client, closed: closeOf(client) });
    await once(client, "connect");
    return client;
  }
  await run({ server, connect, events });
  for (const { client, closed } of clients) {
    client.destroy();
    await closed;
  }
  // Calls back when every connection of the server has closed.
  await new Promise(resolve => server.close(resolve));
  return { path, events, eventLoopRefsLeft: activeTasks() - before };
}

(async () => {
  const table = process.argv[2] === "emitted" ? emitted : paths;
  let leaked = false;
  for (const [path, entry] of Object.entries(table)) {
    const result = await measure(path, entry);
    // Not on Windows: on the aarch64 machines of CI, the native response of a connection that the
    // client destroyed was still counted after these turns. A later connection freed it.
    if (process.platform !== "win32") result.nativeResponsesLeft = await nativeResponsesLeft();
    leaked ||= result.eventLoopRefsLeft !== 0;
    console.log(JSON.stringify(result));
  }
  // A ref that is left keeps the process alive: do not wait for an exit that does not come.
  if (leaked) process.exit(1);
})();
