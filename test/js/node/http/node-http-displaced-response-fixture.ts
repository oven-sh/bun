// A connection gives its current response slot to the next response while the response in
// the slot is still in use. The server socket tells only its current response and its queued
// responses about a close, so the displaced response used to keep a pointer to the freed socket.
//
// usage: <suite> <tcp|tls> [trigger]
// Prints one JSON line per scenario. The process has to exit by itself. When a response still
// holds its refs, no exit comes, so the process exits with code 1 then.
import { heapStats } from "bun:jsc";
import { once } from "node:events";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import tls from "node:tls";
import { WebSocketServer } from "ws";

const [suite, transport, triggerName] = process.argv.slice(2);
const isTLS = transport === "tls";
const keys = path.join(import.meta.dir, "..", "test", "fixtures", "keys");

function createServer(listener: http.RequestListener) {
  return isTLS
    ? https.createServer(
        {
          key: fs.readFileSync(path.join(keys, "agent1-key.pem")),
          cert: fs.readFileSync(path.join(keys, "agent1-cert.pem")),
        },
        listener,
      )
    : http.createServer(listener);
}

async function connect(server: http.Server) {
  const { port } = server.address() as net.AddressInfo;
  const client = isTLS
    ? tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false })
    : net.connect(port, "127.0.0.1");
  client.on("error", () => {});
  await once(client, isTLS ? "secureConnect" : "connect");
  return client;
}

const request = (url: string) => `GET ${url} HTTP/1.1\r\nHost: localhost\r\n\r\n`;
const turn = () => new Promise<void>(resolve => setImmediate(resolve));

// The native handle of a response or of a socket. Both use the same symbol.
function handleOf(object: object) {
  const symbol = Object.getOwnPropertySymbols(object).find(s => s.description === "handle");
  return symbol === undefined ? undefined : (object as any)[symbol];
}

const triggers: Record<string, (req: http.IncomingMessage, res: http.ServerResponse) => void> = {
  "detachSocket": (req, res) => res.detachSocket(req.socket),
  "emit-close": (_req, res) => void res.emit("close"),
  "emit-finish": (_req, res) => void res.emit("finish"),
  "clear-httpMessage": req => void ((req.socket as any)._httpMessage = null),
};

const uses: Record<string, (req: http.IncomingMessage, res: http.ServerResponse) => void> = {
  "end": (_req, res) => void res.end("late"),
  "write": (_req, res) => void res.write("late"),
  "flushHeaders": (_req, res) => res.flushHeaders(),
  "writeContinue": (_req, res) => res.writeContinue(),
  "writeProcessing": (_req, res) => res.writeProcessing(),
  "writeHead+end": (_req, res) => void res.writeHead(200).end(),
  "destroy": (_req, res) => void res.destroy(),
  "req.destroy": req => void req.destroy(),
  "getters": (_req, res) => void [res.writableLength, res.writableNeedDrain, res.writableFinished],
  "emit-close": (_req, res) => void res.emit("close"),
  "nothing": () => {},
};

// For a callback that an unfixed build never makes. The time limit only bounds that failure.
async function within<T>(promise: Promise<T>, fallback: T) {
  let timer: Timer | undefined;
  try {
    return await Promise.race([promise, new Promise<T>(resolve => (timer = setTimeout(resolve, 10_000, fallback)))]);
  } finally {
    clearTimeout(timer);
  }
}

function attempt(use: () => void) {
  try {
    use();
    return "returned";
  } catch (e: any) {
    return `threw ${e?.code ?? e?.message}`;
  }
}

// Flags::IS_REQUEST_PENDING of src/runtime/server/NodeHTTPResponse.rs: the response holds its refs, which keep the process alive.
const IS_REQUEST_PENDING = 1 << 5;
const hasPendingBit = (handle: any) => (handle.flags & IS_REQUEST_PENDING) !== 0;
let held = false;
function isPending(handle: any) {
  const pending = hasPendingBit(handle);
  held ||= pending;
  return pending;
}

// Response 1 is displaced by response 2, the client leaves, then response 1 is used.
async function displaced(trigger: string, use: string, secondRequest: "same read" | "later read") {
  const first = Promise.withResolvers<{ req: http.IncomingMessage; res: http.ServerResponse; handle: any }>();
  const second = Promise.withResolvers<void>();
  const server = createServer((req, res) => {
    req.on("error", () => {});
    res.on("error", () => {});
    if (req.url === "/second") {
      // Left without an answer.
      second.resolve();
      return;
    }
    const handle = handleOf(res);
    triggers[trigger](req, res);
    first.resolve({ req, res, handle });
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const client = await connect(server);
  if (secondRequest === "same read") {
    client.write(request("/first") + request("/second"));
  } else {
    client.write(request("/first"));
    await first.promise;
    client.write(request("/second"));
  }
  const { req, res, handle } = await first.promise;
  await second.promise;
  const socket = req.socket;
  // The dispatcher starts the queued response from a tick.
  await turn();
  const displacedBeforeClose = handleOf(socket)?.response !== handle;

  const closed = once(socket, "close");
  client.destroy();
  await closed;
  // uSockets frees a closed socket when the loop iteration that closed it ends.
  await turn();
  await turn();

  const result = attempt(() => uses[use](req, res));
  await turn();
  server.close();
  server.closeAllConnections();
  // "nothing" stays without a call on the response.
  if (use === "nothing") return { trigger, use, secondRequest, displacedBeforeClose, result };
  return { trigger, use, secondRequest, displacedBeforeClose, result, pending: isPending(handle) };
}

// A response that finished, replaced by the next keep-alive request. After the close its native
// handle is called. JS reaches these calls with a request or response that it kept.
async function finished(call: string) {
  const handles: any[] = [];
  const sockets: net.Socket[] = [];
  const server = createServer((req, res) => {
    sockets.push(req.socket);
    handles.push(handleOf(res));
    res.end(req.url);
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const client = await connect(server);
  let received = "";
  let sentSecond = false;
  const responses = Promise.withResolvers<void>();
  client.on("data", chunk => {
    received += chunk.toString("latin1");
    // The body of a response is the URL of its request, so it ends the response.
    if (!sentSecond && received.endsWith("/first")) {
      sentSecond = true;
      client.write(request("/second"));
    }
    if (received.endsWith("/second")) responses.resolve();
  });
  client.write(request("/first"));
  await responses.promise;
  const socket = sockets[0];
  const replaced = sockets[1] === socket && handleOf(socket)?.response === handles[1];

  const closed = once(socket, "close");
  client.destroy();
  await closed;
  await turn();
  await turn();

  const handle = handles[0];
  const result = attempt(() => {
    if (call === "bufferedAmount") return void handle.bufferedAmount;
    if (call === "cork") return void handle.cork(() => {});
    handle[call](call === "end" || call === "write" ? "late" : undefined);
  });
  server.close();
  server.closeAllConnections();
  return { call, replaced, result };
}

const lateUses: Record<string, (res: http.ServerResponse) => void> = {
  "end": res => void res.end("first-body"),
  "writeContinue": res => res.writeContinue(),
  "addTrailers+end": res => {
    res.addTrailers({ "x-late": "from-first" });
    res.end("first-body");
  },
};

// The client stays. Response 2 has the connection, so response 1 cannot write into its place,
// and request 3 waits behind response 2.
async function connected(trigger: string, use: string) {
  const responses: http.ServerResponse[] = [];
  const errors: string[] = [];
  const third = Promise.withResolvers<void>();
  const server = createServer((req, res) => {
    res.on("error", () => {});
    responses.push(res);
    if (req.url === "/first") {
      triggers[trigger](req, res);
    } else if (req.url === "/third") {
      third.resolve();
    }
  });
  server.on("clientError", error => errors.push(String(error?.code ?? error)));
  process.on("uncaughtException", error => errors.push(String((error as any)?.code ?? error)));
  await once(server.listen(0, "127.0.0.1"), "listening");
  const client = await connect(server);
  let received = "";
  const bodies = Promise.withResolvers<void>();
  client.on("data", chunk => {
    received += chunk.toString("latin1");
    if (received.includes("third-body")) bodies.resolve();
  });
  client.write(request("/first") + request("/second"));
  while (responses.length < 2) await turn();
  await turn();

  const late = attempt(() => lateUses[use](responses[0]));
  const pending = isPending(handleOf(responses[0]));
  // The connection did not queue response 1, so it does not give it the connection again.
  const socketHandle = handleOf(responses[1].socket!);
  const regranted = socketHandle.startPipelinedResponse(handleOf(responses[0]), false, false);
  client.write(request("/third"));
  await third.promise;
  const thirdQueued = responses[2].socket === null;
  responses[1].end("second-body");
  responses[2].end("third-body");
  await bodies.promise;

  const closed = once(client, "close");
  client.destroy();
  await closed;
  server.close();
  server.closeAllConnections();
  return { trigger, use, late, pending, regranted, thirdQueued, received: received.replace(/Date: [^\r]+\r\n/g, ""), errors };
}

// A response that native code completed because its dispatch settled, and that did not end in
// JS: it still waits for a close. The next request is not pipelined and takes its slot.
async function completedButPending() {
  const first = Promise.withResolvers<http.ServerResponse>();
  const server = createServer((req, res) => {
    res.on("error", () => {});
    if (req.url === "/first") {
      res.detachSocket(req.socket);
      first.resolve(res);
      return;
    }
    res.end("second-body");
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const client = await connect(server);
  let received = "";
  const firstAnswer = Promise.withResolvers<void>();
  const secondBody = Promise.withResolvers<void>();
  client.on("data", chunk => {
    received += chunk.toString("latin1");
    firstAnswer.resolve();
    if (received.includes("second-body")) secondBody.resolve();
  });
  client.write(request("/first"));
  const res = await first.promise;
  const handle = handleOf(res);
  await turn();
  // The dispatch settles here.
  res.emit("close");
  await firstAnswer.promise;
  const completed = handle.finished === true;
  client.write(request("/second"));
  await secondBody.promise;

  const closed = once(client, "close");
  client.destroy();
  await closed;
  server.close();
  server.closeAllConnections();
  return { completed, secondBody: received.includes("second-body"), pending: isPending(handle) };
}

// Request 1 upgrades to a WebSocket while response 2 is queued behind it. The socket of the
// connection is a WebSocket then, and response 2 is used.
async function adopted(use: string) {
  const wss = new WebSocketServer({ noServer: true });
  const first = Promise.withResolvers<http.IncomingMessage>();
  const second = Promise.withResolvers<{ req: http.IncomingMessage; res: http.ServerResponse }>();
  const server = createServer((req, res) => {
    req.on("error", () => {});
    res.on("error", () => {});
    if (req.url === "/second") second.resolve({ req, res });
    else first.resolve(req);
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const client = await connect(server);
  let received = "";
  const switched = Promise.withResolvers<void>();
  const greeted = Promise.withResolvers<void>();
  client.on("data", chunk => {
    received += chunk.toString("latin1");
    if (received.includes("\r\n\r\n")) switched.resolve();
    if (received.includes("hello")) greeted.resolve();
  });
  client.write(
    "GET /first HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n" +
      "Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n" +
      request("/second"),
  );
  const upgradeRequest = await first.promise;
  const { req, res } = await second.promise;
  const queued = res.socket === null;
  const handle = handleOf(res);
  // The bit is set for a response that waits, so a later `pending: false` says that it was cleared.
  const pendingWhileQueued = hasPendingBit(handle);
  const opened = Promise.withResolvers<import("ws").WebSocket>();
  wss.handleUpgrade(upgradeRequest, upgradeRequest.socket, Buffer.alloc(0), ws => opened.resolve(ws));
  const ws = await opened.promise;
  ws.on("error", () => {});
  await switched.promise;

  const result = attempt(() => uses[use](req, res));
  await turn();
  const pending = isPending(handle);
  // A use that destroys the socket of the request closes the WebSocket with it.
  const open = ws.readyState === ws.OPEN;
  if (open) {
    ws.send("hello");
    await greeted.promise;
  }
  const closed = once(client, "close");
  client.destroy();
  await closed;
  ws.terminate();
  wss.close();
  server.close();
  server.closeAllConnections();
  return { use, queued, pendingWhileQueued, switched: received.startsWith("HTTP/1.1 101 "), open, result, pending };
}

// The same, and request 2 has a body that still arrives: 3 of its 10 bytes are here when the
// WebSocket adopts the connection. The rest never comes, so nothing but the take-back ends the
// read of that body. An unfixed build keeps the request pending: server.close() never calls back.
async function adoptedWithBody(use: string) {
  const wss = new WebSocketServer({ noServer: true });
  const first = Promise.withResolvers<http.IncomingMessage>();
  const second = Promise.withResolvers<{ req: http.IncomingMessage; res: http.ServerResponse }>();
  const firstChunk = Promise.withResolvers<number>();
  const server = createServer((req, res) => {
    req.on("error", () => {});
    res.on("error", () => {});
    if (req.url === "/second") {
      req.on("data", chunk => firstChunk.resolve(chunk.length));
      second.resolve({ req, res });
    } else {
      first.resolve(req);
    }
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const client = await connect(server);
  let received = "";
  const switched = Promise.withResolvers<void>();
  const greeted = Promise.withResolvers<void>();
  client.on("data", chunk => {
    received += chunk.toString("latin1");
    if (received.includes("\r\n\r\n")) switched.resolve();
    if (received.includes("hello")) greeted.resolve();
  });
  client.write(
    "GET /first HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n" +
      "Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n" +
      "POST /second HTTP/1.1\r\nHost: localhost\r\nContent-Length: 10\r\n\r\nabc",
  );
  const upgradeRequest = await first.promise;
  const { req, res } = await second.promise;
  const queued = res.socket === null;
  const bodyBytes = await firstChunk.promise;
  const opened = Promise.withResolvers<import("ws").WebSocket>();
  wss.handleUpgrade(upgradeRequest, upgradeRequest.socket, Buffer.alloc(0), ws => opened.resolve(ws));
  const ws = await opened.promise;
  ws.on("error", () => {});
  await switched.promise;

  const result = attempt(() => uses[use](req, res));
  await turn();
  const open = ws.readyState === ws.OPEN;
  if (open) {
    ws.send("hello");
    await greeted.promise;
  }
  const closed = once(client, "close");
  client.destroy();
  await closed;
  ws.terminate();
  wss.close();
  const serverClosed = Promise.withResolvers<boolean>();
  server.close(() => serverClosed.resolve(true));
  server.closeAllConnections();
  const didClose = await within(serverClosed.promise, false);
  // A server that cannot close keeps the process alive.
  held ||= !didClose;
  return { use, queued, bodyBytes, switched: received.startsWith("HTTP/1.1 101 "), open, result, serverClosed: didClose };
}

// Response 2 waits in the queue behind response 1. Its native handle is called directly: the
// connection is not its own yet, so nothing of the call reaches the wire.
async function queued(call: string) {
  const responses: http.ServerResponse[] = [];
  const server = createServer((req, res) => {
    res.on("error", () => {});
    responses.push(res);
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const client = await connect(server);
  let received = "";
  const bodies = Promise.withResolvers<void>();
  client.on("data", chunk => {
    received += chunk.toString("latin1");
    if (received.includes("second-body")) bodies.resolve();
  });
  client.write(request("/first") + request("/second"));
  while (responses.length < 2) await turn();
  await turn();

  const isQueued = responses[1].socket === null;
  const handle = handleOf(responses[1]);
  const result = attempt(() => {
    if (call === "cork") return void handle.cork(() => {});
    if (call === "writeHead") return void handle.writeHead(201, "Created", ["x-early", "yes"]);
    handle[call](call === "flushHeaders" || call === "writeContinue" ? undefined : "early");
  });
  responses[0].end("first-body");
  responses[1].end("second-body");
  await bodies.promise;

  const closed = once(client, "close");
  client.destroy();
  await closed;
  server.close();
  server.closeAllConnections();
  return { call, queued: isQueued, result, received: received.replace(/Date: [^\r]+\r\n/g, "") };
}

// Response 1 leaves a large write in the socket buffer, with its tail held by reference, and
// loses the connection. The tail has to go out before response 2. Response 1 armed the drain
// handler of the socket for that write, and the socket drains after response 1 is collected, so
// that handler must be gone by then.
async function draining() {
  const size = 8 * 1024 * 1024;
  const second = Promise.withResolvers<http.ServerResponse>();
  let firstHandle: any;
  let wroteAll: boolean | undefined;
  let heldTail: boolean | undefined;
  const server = createServer((req, res) => {
    req.on("error", () => {});
    res.on("error", () => {});
    if (req.url === "/second") {
      second.resolve(res);
      return;
    }
    firstHandle = handleOf(res);
    wroteAll = res.write(Buffer.alloc(size, "a"));
    heldTail = firstHandle.bufferedAmount > 0;
    res.detachSocket(req.socket);
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const client = await connect(server);
  client.pause();
  let received = 0;
  let tail = "";
  const bodies = Promise.withResolvers<void>();
  const wholeWrite = Promise.withResolvers<void>();
  client.on("data", chunk => {
    received += chunk.length;
    tail = (tail + chunk.toString("latin1")).slice(-64);
    if (received >= size) wholeWrite.resolve();
    if (tail.includes("second-body")) bodies.resolve();
  });
  client.write(request("/first") + request("/second"));
  const res = await second.promise;
  await turn();
  const displaced = res.socket !== null;
  const pending = isPending(firstHandle);
  // Nothing in JS holds response 1 from here on.
  firstHandle = undefined;
  const cells = () => heapStats().objectTypeCounts.NodeHTTPResponse ?? 0;
  const cellsBefore = cells();
  Bun.gc(true);
  await turn();
  Bun.gc(true);
  const collected = cellsBefore - cells();
  client.resume();
  // The client has the whole write, so the socket buffer of the server is empty: uWS has called the drain handler that was armed.
  await wholeWrite.promise;
  await turn();
  res.end("second-body");
  await bodies.promise;

  const closed = once(client, "close");
  client.destroy();
  await closed;
  server.close();
  server.closeAllConnections();
  return { displaced, pending, wroteAll, heldTail, collected, receivedAtLeastTheWrite: received >= size };
}

// Request 2 waits in the queue behind response 1, which has written nothing. req.destroy() on it
// closes the connection, like in Node.js. It must not end the response in flight: before the
// connection had an owner, it wrote an empty "200 OK" with "Connection: close" in its place.
async function queuedDestroyed(secondRequest: "same read" | "later read") {
  const first = Promise.withResolvers<void>();
  const second = Promise.withResolvers<{ req: http.IncomingMessage; res: http.ServerResponse }>();
  const server = createServer((req, res) => {
    req.on("error", () => {});
    res.on("error", () => {});
    if (req.url === "/second") second.resolve({ req, res });
    else first.resolve();
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const client = await connect(server);
  let received = "";
  client.on("data", chunk => (received += chunk.toString("latin1")));
  const closed = once(client, "close");
  if (secondRequest === "same read") {
    client.write(request("/first") + request("/second"));
  } else {
    client.write(request("/first"));
    await first.promise;
    client.write(request("/second"));
  }
  const { req, res } = await second.promise;
  const isQueued = res.socket === null;
  // The read that carried the request is parsed by now.
  await turn();
  const result = attempt(() => req.destroy());
  await closed;
  server.close();
  server.closeAllConnections();
  return { secondRequest, queued: isQueued, result, received };
}

// A 'connection' listener leaves a raw write in the socket buffer, so the first request of the
// connection is dispatched like a pipelined one: its response waits in the queue, and the socket
// has no current response yet. Its 'request' listener throws.
async function thrownWhileQueued() {
  const size = 8 * 1024 * 1024;
  const uncaught: string[] = [];
  process.on("uncaughtException", error => uncaught.push(String((error as any)?.message ?? error)));
  const dispatched = Promise.withResolvers<boolean>();
  const server = createServer((_req, res) => {
    dispatched.resolve(res.socket === null);
    throw new Error("boom");
  });
  server.on("connection", socket => {
    socket.on("error", () => {});
    socket.write(Buffer.alloc(size, "x"));
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const client = await connect(server);
  client.pause();
  let received = 0;
  let afterRawWrite = "";
  const closed = once(client, "close").then(() => true);
  client.on("data", chunk => {
    received += chunk.length;
    if (received > size) afterRawWrite += chunk.subarray(Math.max(0, chunk.length - (received - size))).toString("latin1");
  });
  client.write(request("/first"));
  const queued = await dispatched.promise;
  await turn();
  client.resume();
  // No response can come for the request, so the server closes the connection when the raw write has left.
  const closedByServer = await within(closed, false);
  server.close();
  server.closeAllConnections();
  return { queued, uncaught, rawWrite: received >= size, afterRawWrite, closedByServer };
}

// The scenarios of a suite have a server and a connection each, so they run side by side.
const all = <T>(items: T[], scenario: (item: T) => Promise<object>) => Promise.all(items.map(scenario));
let results: object[] = [];
if (suite === "displaced") {
  results = await all(
    (["same read", "later read"] as const).flatMap(secondRequest =>
      Object.keys(uses).map(use => ({ use, secondRequest })),
    ),
    ({ use, secondRequest }) => displaced(triggerName, use, secondRequest),
  );
} else if (suite === "finished") {
  results = await all(
    [
      "resume",
      "pause",
      "pauseReads",
      "notifyWhenReadParsed",
      "flushHeaders",
      "end",
      "write",
      "abort",
      "writeContinue",
      "bufferedAmount",
      "cork",
    ],
    finished,
  );
} else if (suite === "connected") {
  // One after the other: each one listens for the uncaught exceptions of the process.
  for (const trigger of Object.keys(triggers)) {
    for (const use of Object.keys(lateUses)) results.push(await connected(trigger, use));
  }
} else if (suite === "completed-but-pending") {
  results.push(await completedButPending());
} else if (suite === "adopted") {
  // One after the other: side by side, the unfixed build shows no sanitizer report for the read of the old socket.
  for (const use of Object.keys(uses)) results.push(await adopted(use));
} else if (suite === "queued") {
  results = await all(
    ["write", "end", "writeHead", "flushHeaders", "writeContinue", "writeInformational", "cork"],
    queued,
  );
} else if (suite === "draining") {
  results.push(await draining());
} else if (suite === "adopted-with-body") {
  for (const use of ["req.destroy", "destroy", "nothing"]) results.push(await adoptedWithBody(use));
} else if (suite === "thrown-while-queued") {
  results.push(await thrownWhileQueued());
} else if (suite === "queued-destroyed") {
  results = await all(["same read", "later read"] as const, queuedDestroyed);
}
for (const result of results) console.log(JSON.stringify(result));
if (held) process.exit(1);
