// Usage: bun tls-refused-client-hello-fixture.ts <peer-closed | ECONNRESET | EPIPE>
//
// The kernel refuses the send() of a TLS client's ClientHello. With "peer-closed" a real peer causes that: it closes
// the connection as it accepts it, over a unix socket (TLS_FIXTURE_UNIX_PATH). With an errno that send() is made to
// fail. TLS_FIXTURE_KEY and TLS_FIXTURE_CERT are for the one peer that speaks TLS.
//
// The engine ends the write side at once and reports the failed handshake from the next writable event of the socket.
// The first row is left to that event. Each other row gets to the engine before it: a write in `open` (the engine
// runs the handshake for it and comes back to report on it), or a close by the owner in the turn of the event loop of
// that send(). Prints what the owner of each row hears.
//
// For the "paused" rows the peer first says something that is not TLS, and the owner pauses its socket in `open`. The
// engine reads what the peer said before it reports, and a pause is no reason to wait with that: it holds back data,
// and this handshake has none to deliver. The last row is the session that does: its owner paused after the handshake.
import { socketFaultInjection as fault } from "bun:internal-for-testing";
import tls from "node:tls";

const refusal = process.argv[2];
const peerCloses = refusal === "peer-closed";
const refuseNextSend = () => {
  if (!peerCloses) fault.set({ syscall: "send", action: "errno", errno: refusal as "ECONNRESET" | "EPIPE" });
};
const turns = async (count: number) => {
  for (let turn = 0; turn < count; turn++) await new Promise(resolve => setImmediate(resolve));
};
const unix = process.env.TLS_FIXTURE_UNIX_PATH!;
let speaksFirst = false;
let accepted = () => {};
// The ClientHello never leaves, so this peer does not have to speak TLS.
const peer = {
  open(socket: Bun.Socket) {
    if (speaksFirst) {
      socket.write("not TLS\n");
      // Armed behind that write, the rule refuses the next send(), which is the ClientHello.
      refuseNextSend();
    }
    if (peerCloses) socket.terminate();
    accepted();
  },
  data() {},
};
// A unix listener is readable before the socket of its client is registered, so its `open` always runs first, in the
// same turn of the event loop.
const unixListener = Bun.listen({ unix, socket: peer });
const tcpListener = peerCloses ? undefined : Bun.listen({ hostname: "127.0.0.1", port: 0, socket: peer });
const tcpOrUnix = tcpListener ? { hostname: "127.0.0.1", port: tcpListener.port } : { unix };

// `patience` is for a row whose owner does nothing: a socket that is still open after that many turns of the event
// loop is closed, so the row ends whatever the engine did.
async function heardByBunConnect(
  target: { unix: string } | { hostname: string; port: number },
  open: (socket: Bun.Socket) => void,
  patience = 0,
) {
  const events: string[] = [];
  const closed = Promise.withResolvers<void>();
  let over = false;
  Bun.connect({
    ...target,
    tls: { rejectUnauthorized: false },
    socket: {
      open(socket) {
        open(socket);
        if (!patience) return;
        void turns(patience).then(() => {
          if (over) return;
          events.push("terminate()");
          socket.terminate();
        });
      },
      handshake(_socket, success, error) {
        events.push(`handshake(${success}, ${error ? error.code : error})`);
      },
      data(_socket, chunk) {
        events.push(`data(${chunk})`);
      },
      close(_socket, error) {
        over = true;
        events.push(`close(${error ? error.code : ""})`);
        closed.resolve();
      },
      connectError(_socket, error) {
        over = true;
        events.push(`connectError(${error.code})`);
        closed.resolve();
      },
    },
  }).catch(() => {});
  await closed.promise;
  return events.join(" ");
}

for (const writes of [false, true]) {
  for (const then of ["nothing", "terminate", "end"] as const) {
    refuseNextSend();
    const heard = await heardByBunConnect(tcpOrUnix, socket => {
      if (writes) socket.write("x");
      if (then !== "nothing") setImmediate(() => socket[then]());
    });
    console.log(`Bun.connect, ${writes ? "write in open" : "no write"}, then ${then}: ${heard}`);
  }
}

// A WebSocket client writes its upgrade request in `open`.
if (tcpListener) {
  refuseNextSend();
  const url = `wss://127.0.0.1:${tcpListener.port}/`;
  const ws = new WebSocket(url, { tls: { rejectUnauthorized: false } });
  const events: string[] = [];
  ws.onopen = () => events.push("open");
  ws.onerror = event =>
    events.push(`error(${(event as ErrorEvent).error?.code}, ${event.message.replace(url, "URL")})`);
  await new Promise(resolve => (ws.onclose = resolve));
  console.log(`WebSocket: ${events.join(" ")}`);
}

// node:tls sends a write that was queued ahead of the connection in `open`. That write is cancelled behind the error
// of the socket, which is the one of a socket with no write: the engine's own close carries the reset, and the close
// of a client that rejects what it cannot verify is a clean one that 'end' reports. A callback that throws is the
// caller's own error.
for (const [rejectUnauthorized, throws] of [
  [false, false],
  [true, false],
  [true, true],
]) {
  refuseNextSend();
  const socket = tls.connect({
    ...(tcpListener ? { host: "127.0.0.1", port: tcpListener.port } : { path: unix }),
    rejectUnauthorized,
  });
  const events: string[] = [];
  const uncaught = (error: Error) => events.push(`uncaughtException(${error.message})`);
  process.on("uncaughtException", uncaught);
  socket.write("x", error => {
    events.push(`write callback(${(error as NodeJS.ErrnoException | undefined)?.code})`);
    if (throws) throw new Error("from the write callback");
  });
  socket.on("secureConnect", () => events.push("secureConnect"));
  socket.on("end", () => events.push("end"));
  socket.on("error", (error: NodeJS.ErrnoException) => events.push(`error(${error.code}, ${error.message})`));
  await new Promise(resolve => socket.on("close", resolve));
  process.off("uncaughtException", uncaught);
  const row = `rejectUnauthorized ${rejectUnauthorized}${throws ? ", a callback that throws" : ""}`;
  console.log(`node:tls, write before connect, ${row}: ${events.join(" ")}`);
}

// A RedisClient has no `open` to close from. The peer's `open` is in the turn in which the client sends: a close()
// that came any later would be behind the rejection of the command.
{
  refuseNextSend();
  const events: string[] = [];
  accepted = () =>
    setImmediate(() => {
      events.push("close()");
      client.close();
    });
  const client = new Bun.RedisClient(`redis+tls+unix://${unix}`, {
    tls: { rejectUnauthorized: false },
    autoReconnect: false,
  });
  client.onclose = error => events.push(`onclose(${error.code})`);
  await client.set("key", "value").catch(error => events.push(`set rejected(${error.code}, ${error.message})`));
  console.log(`RedisClient: ${events.join(" ")}`);
  accepted = () => {};
}

// The report of these two is two turns away: one for the writable event, one for the read of what the peer said.
speaksFirst = true;
for (const writes of [false, true]) {
  const heard = await heardByBunConnect(
    { unix },
    socket => {
      socket.pause();
      if (writes) socket.write("x");
    },
    8,
  );
  console.log(`Bun.connect, paused, ${writes ? "write in open" : "no write"}: ${heard}`);
}
speaksFirst = false;

// What the peer of a session sent before the refused send() is data, which the pause of its owner holds back.
{
  const events: string[] = [];
  const closed = Promise.withResolvers<void>();
  const secure = { server: Promise.withResolvers<Bun.Socket>(), client: Promise.withResolvers<Bun.Socket>() };
  const tlsListener = Bun.listen({
    unix: `${unix}.tls`,
    tls: { key: process.env.TLS_FIXTURE_KEY, cert: process.env.TLS_FIXTURE_CERT },
    socket: { handshake: socket => secure.server.resolve(socket), data() {}, error() {} },
  });
  Bun.connect({
    unix: `${unix}.tls`,
    tls: { rejectUnauthorized: false },
    socket: {
      handshake(socket) {
        socket.pause();
        secure.client.resolve(socket);
      },
      data(_socket, chunk) {
        events.push(`data(${chunk})`);
      },
      // With or without a reset: a peer that is still there answers the FIN of the refused send() with its own.
      close() {
        events.push("close");
        closed.resolve();
      },
      error() {},
    },
  }).catch(() => {});
  const [server, client] = await Promise.all([secure.server.promise, secure.client.promise]);
  server.write("late");
  if (peerCloses) server.terminate();
  else refuseNextSend();
  client.write("x");
  // More than the two turns in which a socket that was not paused would get that data.
  await turns(4);
  events.push("resume()");
  client.resume();
  await closed.promise;
  console.log(`Bun.connect, paused after the handshake: ${events.join(" ")}`);
  tlsListener.stop(true);
}

if (!peerCloses) fault.clear();
unixListener.stop(true);
tcpListener?.stop(true);
