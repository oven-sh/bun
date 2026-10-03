// A raw wss:// server that completes the closing handshake and then keeps the
// TCP connection open, plus the client under test, which connects directly or
// through a CONNECT proxy. Prints one JSON line once the client has its close
// event and its TCP connection (to the server, or to the proxy) is gone. Only
// the client can cause that: the server and the proxy are half-open and never
// end or close a connection.
//
// Scenarios: "client-closes" (close() after the open event), "server-closes"
// (the server sends the first Close frame), "both-close" (the server's Close
// frame arrives in the same read as a message whose handler calls close()).
import type { Socket } from "bun";

const [scenario, via] = process.argv.slice(2);
const tls = { cert: process.env.TLS_CERT!, key: process.env.TLS_KEY! };
const direct = via === "direct";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const TEXT_X = new Uint8Array([0x81, 0x01, 0x78]);
const PING = new Uint8Array([0x89, 0x00]);
const CLOSE_1000 = new Uint8Array([0x88, 0x02, 0x03, 0xe8]);

let close: { code: number; wasClean: boolean } | undefined;
let closeFramesFromClient = 0;
let fin = false;
let clientConnectionGone = false;
let reported = false;

function report() {
  if (reported || !close || !clientConnectionGone) return;
  reported = true;
  console.log(JSON.stringify({ close, closeFramesFromClient, fin }));
  server.stop(true);
  proxy?.stop(true);
}

// For the socket that the client is connected to. Every socket here has an
// `end` handler: without one, Bun closes it on `end`. A plain `end` is the
// client's FIN. A TLS `end` can be the close_notify of a client that keeps its
// socket open, so the server writes to the client: only a closed socket
// answers that with a reset, which is the `close` that counts.
function watchClientConnection(isTls: boolean) {
  const gone = () => {
    clientConnectionGone = true;
    report();
  };
  return {
    end(socket: Socket<unknown>) {
      fin = true;
      if (isTls) socket.write(PING);
      else gone();
    },
    close: gone,
  };
}

const server = Bun.listen<{ head: string; upgraded: boolean; frames: Buffer }>({
  hostname: "127.0.0.1",
  port: 0,
  tls,
  allowHalfOpen: true,
  socket: {
    open(socket) {
      socket.data = { head: "", upgraded: false, frames: Buffer.alloc(0) };
    },
    data(socket, chunk) {
      const state = socket.data;
      if (!state.upgraded) {
        state.head += chunk.toString("latin1");
        if (!state.head.includes("\r\n\r\n")) return;
        const key = /sec-websocket-key: *([^\r\n]+)/i.exec(state.head)![1];
        const accept = new Bun.CryptoHasher("sha1").update(key + GUID).digest("base64");
        socket.write(
          "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
            `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
        );
        state.upgraded = true;
        if (scenario === "server-closes") socket.write(CLOSE_1000);
        if (scenario === "both-close") socket.write(Buffer.concat([TEXT_X, CLOSE_1000]));
        return;
      }
      // The client sends nothing but Close frames: 2 header bytes, 4 mask bytes, a short payload.
      // A frame can arrive in pieces, so an incomplete tail stays buffered.
      let frames = Buffer.concat([state.frames, chunk]);
      while (frames.length >= 2 && frames.length >= 6 + (frames[1] & 0x7f)) {
        const isClose = (frames[0] & 0x0f) === 0x8;
        if (isClose && ++closeFramesFromClient === 1 && scenario === "client-closes") socket.write(CLOSE_1000);
        frames = frames.subarray(6 + (frames[1] & 0x7f));
      }
      state.frames = frames;
    },
    // Through a proxy, the client's connection is the one the proxy accepted.
    ...(direct ? watchClientConnection(true) : { end() {} }),
    error() {},
  },
});

const proxy = direct
  ? undefined
  : Bun.listen<{ upstream?: Socket }>({
      hostname: "127.0.0.1",
      port: 0,
      tls: via === "https-proxy" ? tls : undefined,
      allowHalfOpen: true,
      socket: {
        open(client) {
          client.data = {};
        },
        async data(client, chunk) {
          if (client.data.upstream) {
            client.data.upstream.write(chunk);
            return;
          }
          // The CONNECT request. The client sends nothing more before the 200.
          client.data.upstream = await Bun.connect({
            hostname: "127.0.0.1",
            port: server.port,
            allowHalfOpen: true,
            socket: {
              data(_, bytes) {
                client.write(bytes);
              },
              end() {},
              error() {},
            },
          });
          client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        },
        ...watchClientConnection(via === "https-proxy"),
        error() {},
      },
    });

const ws = new WebSocket(`wss://127.0.0.1:${server.port}/`, {
  proxy: proxy && `${via === "https-proxy" ? "https" : "http"}://127.0.0.1:${proxy.port}`,
  tls: { rejectUnauthorized: false },
});
let opened = false;
ws.onopen = () => {
  opened = true;
  // Not inside the open event: there a proxy tunnel is not attached to the
  // client yet, and close() tears it down through the upgrade client.
  if (scenario === "client-closes") setImmediate(() => ws.close());
};
ws.onmessage = () => ws.close();
ws.onclose = event => {
  if (!opened) {
    // A client that never connected leaves no connection to watch, so nothing else ends this process.
    console.error(`the client did not connect: ${event.code} ${event.reason}`);
    process.exit(1);
  }
  close = { code: event.code, wasClean: event.wasClean };
  report();
};
