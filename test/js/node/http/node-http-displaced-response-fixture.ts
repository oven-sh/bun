// A connection gives its current response slot to the next response while the response in
// the slot is still in use. The server socket tells only its current response and its queued
// responses about a close, so the displaced response used to keep a pointer to the freed socket.
//
// usage: <suite> <tcp|tls> [trigger]
// Prints one JSON line per scenario. The process has to exit by itself.
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

function attempt(use: () => void) {
  try {
    use();
    return "returned";
  } catch (e: any) {
    return `threw ${e?.code ?? e?.message}`;
  }
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
  return { trigger, use, secondRequest, displacedBeforeClose, result };
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

// The client stays. Response 2 has the connection, so response 1 cannot write into its place,
// and request 3 waits behind response 2.
async function connected(trigger: string) {
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

  const late = attempt(() => responses[0].end("first-body"));
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
  const received_bodies = received
    .split("\r\n\r\n")
    .slice(1)
    .map(part => part.split("HTTP/1.1")[0]);
  return { trigger, late, regranted, thirdQueued, bodies: received_bodies, errors };
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
  return { completed, secondBody: received.includes("second-body") };
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
  const opened = Promise.withResolvers<import("ws").WebSocket>();
  wss.handleUpgrade(upgradeRequest, upgradeRequest.socket, Buffer.alloc(0), ws => opened.resolve(ws));
  const ws = await opened.promise;
  ws.on("error", () => {});
  await switched.promise;

  const result = attempt(() => uses[use](req, res));
  await turn();
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
  return { use, queued, switched: received.startsWith("HTTP/1.1 101 "), open, result };
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
// loses the connection. The tail has to go out before response 2, and the drain handler of the
// socket must not call a response that is gone.
async function draining() {
  const size = 8 * 1024 * 1024;
  const second = Promise.withResolvers<http.ServerResponse>();
  const server = createServer((req, res) => {
    req.on("error", () => {});
    res.on("error", () => {});
    if (req.url === "/second") {
      second.resolve(res);
      return;
    }
    res.write(Buffer.alloc(size, "a"));
    res.detachSocket(req.socket);
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const client = await connect(server);
  client.pause();
  let received = 0;
  let tail = "";
  const bodies = Promise.withResolvers<void>();
  client.on("data", chunk => {
    received += chunk.length;
    tail = (tail + chunk.toString("latin1")).slice(-64);
    if (tail.includes("second-body")) bodies.resolve();
  });
  client.write(request("/first") + request("/second"));
  const res = await second.promise;
  await turn();
  const displaced = res.socket !== null;
  // Nothing in JS holds response 1 now.
  Bun.gc(true);
  await turn();
  Bun.gc(true);
  client.resume();
  res.end("second-body");
  await bodies.promise;

  const closed = once(client, "close");
  client.destroy();
  await closed;
  server.close();
  server.closeAllConnections();
  return { displaced, receivedAtLeastTheWrite: received >= size };
}

const results: unknown[] = [];
if (suite === "displaced") {
  for (const secondRequest of ["same read", "later read"] as const) {
    for (const use of Object.keys(uses)) {
      results.push(await displaced(triggerName, use, secondRequest));
    }
  }
} else if (suite === "finished") {
  for (const call of [
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
  ]) {
    results.push(await finished(call));
  }
} else if (suite === "connected") {
  for (const trigger of Object.keys(triggers)) {
    results.push(await connected(trigger));
  }
} else if (suite === "completed-but-pending") {
  results.push(await completedButPending());
} else if (suite === "adopted") {
  for (const use of Object.keys(uses)) {
    results.push(await adopted(use));
  }
} else if (suite === "queued") {
  for (const call of ["write", "end", "writeHead", "flushHeaders", "writeContinue", "writeInformational", "cork"]) {
    results.push(await queued(call));
  }
} else if (suite === "draining") {
  results.push(await draining());
}
for (const result of results) console.log(JSON.stringify(result));
