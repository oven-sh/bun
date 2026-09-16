// Closes paused client WebSockets and reports how many file descriptors the
// process is left with. A closed WebSocket's socket is only closed once a read
// sees the peer's FIN, so one that stays paused keeps its fd forever.
//
// usage: websocket-pause-close-fixture.ts <mode> <scenario>
//   mode:     ws | wss | wss-via-http | wss-via-https | ws-via-https
//   scenario: pause-close                 pause(), then close()
//             peer-close                  the message handler pauses; the peer's Close is in the same read
//             pause-close-backpressure    pause(), then a close() whose Close frame has to wait to be written
//             close-pause-backpressure    the same close(), then pause()
//
// The servers run in this process on purpose. The plain-TCP client shuts both
// directions down after its Close frame, which raises EPOLLHUP at once. A peer
// in another process can answer before the client polls again, and data that
// arrives after shutdown(SHUT_RD) resets the connection: the socket then
// closes on the error, paused or not.
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import nodeTls from "node:tls";
import { tls } from "../../../harness";

const [mode, scenario] = process.argv.slice(2);
const secure = mode.startsWith("wss");
const proxyKind = mode.includes("-via-") ? mode.split("-via-")[1] : null;
const backpressure = scenario.endsWith("-backpressure");
const ITERATIONS = backpressure ? 2 : 8;
const CHUNK = new Uint8Array(64 * 1024);

const fdCount = () => fs.readdirSync(process.platform === "darwin" ? "/dev/fd" : "/proc/self/fd").length;

// Echoes. With `peer-close` it sends one message and a Close as soon as a
// connection opens, except on the connection that holds the baseline.
function echoOrigin(): number {
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    ...(secure ? { tls } : {}),
    fetch(req, server) {
      if (server.upgrade(req, { data: { held: new URL(req.url).pathname === "/held" } })) return;
      return new Response();
    },
    websocket: {
      open(ws: Bun.ServerWebSocket<{ held: boolean }>) {
        if (scenario !== "peer-close" || ws.data.held) return;
        ws.send("message");
        ws.close(1000, "bye");
      },
      message(ws, message) {
        ws.send(message);
      },
    },
  });
  return server.port!;
}

// Completes the upgrade and then reads nothing until resumed, so the client's
// send side backs up.
const rawOriginSockets: net.Socket[] = [];
function rawOrigin(): Promise<number> {
  const server = net.createServer(sock => {
    sock.once("data", head => {
      const key = /Sec-WebSocket-Key: (.+)\r\n/.exec(head.toString("latin1"))![1].trim();
      const accept = crypto
        .createHash("sha1")
        .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
        .digest("base64");
      sock.write(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
          `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
      );
      sock.pause();
      sock.on("data", () => {});
      rawOriginSockets.push(sock);
    });
    sock.on("error", () => {});
  });
  return new Promise<number>(resolve =>
    server.listen(0, "127.0.0.1", () => resolve((server.address() as net.AddressInfo).port)),
  );
}

// A CONNECT proxy that pipes both directions.
function pipingConnectProxy(secureProxy: boolean): Promise<number> {
  function onConnection(client: net.Socket) {
    client.once("data", head => {
      const match = /^CONNECT ([^:]+):(\d+) /.exec(head.toString("latin1"));
      if (!match) {
        client.destroy();
        return;
      }
      const upstream = net.connect(Number(match[2]), match[1], () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        client.pipe(upstream);
        upstream.pipe(client);
      });
      upstream.on("error", () => client.destroy());
      client.on("error", () => upstream.destroy());
    });
  }
  const server = secureProxy
    ? nodeTls.createServer({ key: tls.key, cert: tls.cert }, onConnection)
    : net.createServer(onConnection);
  return new Promise<number>(resolve =>
    server.listen(0, "127.0.0.1", () => resolve((server.address() as net.AddressInfo).port)),
  );
}

const originPort = backpressure ? await rawOrigin() : echoOrigin();
const proxyPort = proxyKind ? await pipingConnectProxy(proxyKind === "https") : undefined;
const options = {
  tls: { rejectUnauthorized: false },
  ...(proxyPort ? { proxy: `${proxyKind}://127.0.0.1:${proxyPort}` } : {}),
};

function connect(pathname: string) {
  const ws = new WebSocket(`${secure ? "wss" : "ws"}://127.0.0.1:${originPort}${pathname}`, options);
  const opened = Promise.withResolvers<void>();
  const closed = Promise.withResolvers<CloseEvent>();
  ws.onopen = () => opened.resolve();
  ws.onclose = event => {
    opened.reject(new Error(`closed before open: ${event.code}`));
    closed.resolve(event);
  };
  return { ws, opened: opened.promise, closed: closed.promise };
}

// This connection stays open for the whole run. Whatever the first connection
// creates lazily is part of the baseline with it, so that only the connections
// below can move the count.
const held = connect("/held");
await held.opened;
const before = fdCount();

let cleanCloses = 0;
// close-pause-backpressure: how many pause() calls after close() returned true.
let pausesAfterClose = 0;
for (let i = 0; i < ITERATIONS; i++) {
  const { ws, opened, closed } = connect("/");
  if (scenario === "peer-close") {
    ws.onmessage = () => ws.pause();
  } else {
    await opened;
    if (scenario === "pause-close") {
      ws.pause();
      ws.close();
    } else {
      // Fill the socket until the client has to queue. The Close frame then
      // queues behind the data, and the close is dispatched once it drains.
      for (let sent = 0; ws.bufferedAmount === 0; sent++) {
        if (sent === 1024) throw new Error("the socket never filled up");
        ws.send(CHUNK);
      }
      if (scenario === "pause-close-backpressure") {
        ws.pause();
        ws.close();
      } else {
        ws.close();
        if (ws.pause()) pausesAfterClose++;
      }
      if (ws.bufferedAmount === 0) throw new Error("the Close frame did not have to wait");
      rawOriginSockets.at(-1)!.resume();
    }
  }
  const event = await closed;
  if (event.wasClean && event.code === 1000) cleanCloses++;
}

// Every socket of the closed connections (client, origin and proxy side)
// closes within a few turns of the event loop. A leaked one never does.
const deadline = performance.now() + 10_000;
while (fdCount() > before && performance.now() < deadline) {
  await new Promise(resolve => setImmediate(resolve));
}

console.log(
  JSON.stringify({
    cleanCloses,
    leakedFds: fdCount() - before,
    ...(scenario === "close-pause-backpressure" ? { pausesAfterClose } : {}),
  }),
);
process.exit(0);
