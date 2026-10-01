// The ways a node:http exchange ends. For each one: the order of the 'finish', 'close' and
// 'aborted' events, the event loop refs that are left once the server closed, and the native
// responses that something still holds.
//
// usage: <paths|emitted>. Prints one JSON line per path.
//   paths:   the ways that need no help from user code.
//   emitted: user code emits 'close' by hand on the way.
"use strict";
const { once } = require("node:events");
const http = require("node:http");
const net = require("node:net");
const { getEventLoopStats } = require("bun:internal-for-testing");
const { generateHeapSnapshotForDebugging, heapStats } = require("bun:jsc");
const { WebSocketServer } = require("ws");

const turn = () => new Promise(resolve => setImmediate(resolve));
const closeOf = emitter => new Promise(resolve => emitter.once("close", resolve));
const activeTasks = () => getEventLoopStats().activeTasks;
// heapStats() counts the prototype object of the class under the same name.
const prototypeObjects = 1;
// The native responses that something holds. A count after a full GC does not say that:
// JavaScriptCore also marks what a word on the native stack happens to point at, and a slot that a
// live native frame never writes can still hold the listener of an earlier 'close' event, which
// holds the response. The debugging heap snapshot has every edge and every root, and no entry for
// such words. It is slow on a debug build, so it is taken only for a response that stays counted.
async function nativeResponsesLeft() {
  let held = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    for (let i = 0; i < 8; i++) {
      await turn();
      Bun.gc(true);
      if ((heapStats().objectTypeCounts.NodeHTTPResponse ?? 0) <= prototypeObjects) return 0;
    }
    held = nativeResponsesARootReaches();
    if (held.length === 0) return 0;
  }
  // The test expects an empty stderr, so its failure shows what holds each response.
  for (const path of held) console.error(path);
  return held.length;
}
// For each native response that a root reaches: a shortest path from that root.
function nativeResponsesARootReaches() {
  const { nodes, nodeClassNames, edges, edgeTypes, edgeNames, roots, labels } = generateHeapSnapshotForDebugging();
  const className = new Map();
  const nativeResponses = new Set();
  for (let i = 0; i < nodes.length; i += 7) {
    className.set(nodes[i], nodeClassNames[nodes[i + 2]]);
    // The prototype object has the same class name and wraps no native object.
    if (className.get(nodes[i]) === "NodeHTTPResponse" && BigInt(nodes[i + 6]) !== 0n) nativeResponses.add(nodes[i]);
  }
  const outgoing = new Map();
  for (let i = 0; i < edges.length; i += 4) {
    const type = edgeTypes[edges[i + 2]];
    const name = type === "Property" || type === "Variable" ? edgeNames[edges[i + 3]] : edges[i + 3];
    if (!outgoing.has(edges[i])) outgoing.set(edges[i], []);
    outgoing.get(edges[i]).push([edges[i + 1], `${type}:${name}`]);
  }
  // For each cell that a root reaches: the reason of that root, or the cell before it and the edge.
  const reachedFrom = new Map();
  const queue = [];
  for (let i = 0; i < roots.length; i += 3) {
    const reason = String(labels[roots[i + 1]] ?? roots[i + 1]);
    // What an output constraint appends is recorded as a root, but only follows from its owner being marked.
    if (reachedFrom.has(roots[i]) || reason.includes("DOMGCOutput")) continue;
    reachedFrom.set(roots[i], reason);
    queue.push(roots[i]);
  }
  for (let i = 0; i < queue.length; i++) {
    for (const [to, edge] of outgoing.get(queue[i]) ?? []) {
      if (reachedFrom.has(to)) continue;
      reachedFrom.set(to, [queue[i], edge]);
      queue.push(to);
    }
  }
  return queue
    .filter(cell => nativeResponses.has(cell))
    .map(cell => {
      const path = [];
      let step = reachedFrom.get(cell);
      for (; typeof step !== "string"; cell = step[0], step = reachedFrom.get(cell)) {
        path.unshift(`-${step[1]}-> ${className.get(cell)}`);
      }
      return [`root(${step}) ${className.get(cell)}`, ...path].join(" ");
    });
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
    result.nativeResponsesLeft = await nativeResponsesLeft();
    leaked ||= result.eventLoopRefsLeft !== 0;
    console.log(JSON.stringify(result));
  }
  // A ref that is left keeps the process alive: do not wait for an exit that does not come.
  if (leaked) process.exit(1);
})();
