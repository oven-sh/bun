// Usage: bun tls-refused-client-hello-fixture.ts <peer-closed | ECONNRESET | EPIPE>
//
// The kernel refuses the send() of a TLS client's ClientHello. With "peer-closed" a real peer causes that: it closes
// the connection as it accepts it, over a unix socket (TLS_FIXTURE_UNIX_PATH). With an errno that send() is made to
// fail.
//
// The engine ends the write side at once and reports the failed handshake from the next writable event of the socket.
// The first row is left to that event. Each other row gets to the engine before it: a write in `open` (the engine
// runs the handshake for it and comes back to report on it), or a close by the owner in the turn of the event loop of
// that send(). Prints what the owner of each row hears.
import { socketFaultInjection as fault } from "bun:internal-for-testing";
import tls from "node:tls";

const refusal = process.argv[2];
const peerCloses = refusal === "peer-closed";
const refuseNextSend = () => {
  if (!peerCloses) fault.set({ syscall: "send", action: "errno", errno: refusal as "ECONNRESET" | "EPIPE" });
};
const unix = process.env.TLS_FIXTURE_UNIX_PATH!;
let accepted = () => {};
// The ClientHello never leaves, so no peer has to speak TLS.
const peer = {
  open(socket: Bun.Socket) {
    if (peerCloses) socket.terminate();
    accepted();
  },
  data() {},
};
// A unix listener is readable before the socket of its client is registered, so its `open` always runs first, in the
// same turn of the event loop.
const unixListener = Bun.listen({ unix, socket: peer });
const tcpListener = peerCloses ? undefined : Bun.listen({ hostname: "127.0.0.1", port: 0, socket: peer });

for (const writes of [false, true]) {
  for (const then of ["nothing", "terminate", "end"] as const) {
    refuseNextSend();
    const events: string[] = [];
    const closed = Promise.withResolvers<void>();
    Bun.connect({
      ...(tcpListener ? { hostname: "127.0.0.1", port: tcpListener.port } : { unix }),
      tls: { rejectUnauthorized: false },
      socket: {
        open(socket) {
          if (writes) socket.write("x");
          if (then !== "nothing") setImmediate(() => socket[then]());
        },
        handshake(_socket, success, error) {
          events.push(`handshake(${success}, ${error ? error.code : error})`);
        },
        data() {},
        close(_socket, error) {
          events.push(`close(${error ? error.code : ""})`);
          closed.resolve();
        },
        connectError(_socket, error) {
          events.push(`connectError(${error.code})`);
          closed.resolve();
        },
      },
    }).catch(() => {});
    await closed.promise;
    console.log(`Bun.connect, ${writes ? "write in open" : "no write"}, then ${then}: ${events.join(" ")}`);
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

// node:tls sends a write that was queued ahead of the connection in `open`.
{
  refuseNextSend();
  const socket = tls.connect({
    ...(tcpListener ? { host: "127.0.0.1", port: tcpListener.port } : { path: unix }),
    rejectUnauthorized: false,
  });
  const events: string[] = [];
  socket.write("x", error => events.push(`write callback(${(error as NodeJS.ErrnoException | undefined)?.code})`));
  socket.on("secureConnect", () => events.push("secureConnect"));
  socket.on("error", (error: NodeJS.ErrnoException) => events.push(`error(${error.code}, ${error.message})`));
  await new Promise(resolve => socket.on("close", resolve));
  console.log(`node:tls, write before connect: ${events.join(" ")}`);
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
}

if (!peerCloses) fault.clear();
unixListener.stop(true);
tcpListener?.stop(true);
