// Regression fixture: the peer's FIN for a TLS socket that is parked in the low-priority handshake
// queue.
//
// uSockets runs at most 5 TLS handshake reads per loop iteration. A handshaking socket that
// becomes readable after the budget is spent is PARKED: unlinked from its group, linked into
// loop->data.low_prio_head, and its readable poll is switched off. The start of every later
// iteration takes 5 sockets out of the queue and switches their readable poll back on.
//
// On kqueue a socket that does not poll for reads keeps an edge-triggered read knote, so that the
// peer's FIN or reset still reaches the dispatcher (epoll reports those with no registration). The
// dispatcher left that FIN for later on a paused socket, but on a parked one it took it as the end
// of the stream, with everything the peer sent before the FIN still unread in the kernel. It
// failed the handshake and closed the socket, and the close of a socket with unread data is a
// reset: a client that wrote its request and shut its write side down right after its handshake
// got ECONNRESET in place of the reply.
//
// Server and clients share this process, so a loop iteration is one step for both sides:
//   1. N clients connect. When a client's handshake completes, it pauses its server socket (found
//      by port), writes a ping and shuts its write side down. The client's Finished, the ping,
//      the close_notify and the FIN stay unread in the server's kernel buffer.
//   2. One round trip on a plain TCP connection. Loopback delivers in order, so after it the
//      bytes of every client are in the server's receive queues.
//   3. The server resumes all N at once. The next iteration reads 5 of them and parks the other
//      N - 5, each with the FIN behind its unread bytes. The iteration after that takes 5 out of
//      the queue, so N - 10 are still parked when the event for their FIN is dispatched.
//   4. Every client gets its pong and a clean close.
import type { Socket } from "bun";
import { tls as certs } from "harness";

const N = 32;
// Well inside the test's own timeout, so a stalled step still prints the summary.
const STEP_DEADLINE_MS = 20_000;

const summary = {
  opened: 0,
  serverHandshakes: 0,
  serverHandshakeFailures: 0,
  serverData: 0,
  pongs: 0,
  // Clients whose close carried an error (the reset).
  resets: 0,
  errors: 0,
};

function report(extra: Record<string, unknown> = {}): never {
  console.log(JSON.stringify({ ...summary, ...extra }));
  process.exit(extra.error ? 1 : 0);
}

// One turn of the immediate queue is one loop iteration. The turns also keep the low-priority
// queue moving, which drains only when the loop iterates.
async function until(step: string, done: () => boolean) {
  const deadline = Date.now() + STEP_DEADLINE_MS;
  while (!done()) {
    if (Date.now() > deadline) report({ error: `timed out waiting for ${step}` });
    await new Promise(r => setImmediate(r));
  }
}

// Step 2's connection: the server end echoes.
let echoed = 0;
const echoServer = Bun.listen({
  hostname: "127.0.0.1",
  port: 0,
  socket: {
    data(s, chunk) {
      s.write(chunk);
    },
  },
});
const echo = await Bun.connect({
  hostname: "127.0.0.1",
  port: echoServer.port,
  socket: {
    data(_s, chunk) {
      echoed += chunk.length;
    },
  },
});

const accepted = new Map<number, Socket>();
let clientHandshakes = 0;
let clientCloses = 0;

const server = Bun.listen({
  hostname: "127.0.0.1",
  port: 0,
  tls: { key: certs.key, cert: certs.cert },
  socket: {
    open(s) {
      summary.opened++;
      accepted.set(s.remotePort, s);
    },
    handshake(_s, success) {
      if (success) summary.serverHandshakes++;
      else summary.serverHandshakeFailures++;
    },
    data(s) {
      summary.serverData++;
      s.write("pong");
    },
    error() {
      summary.errors++;
    },
  },
});

type Reply = { reply: string };
const clients: Socket<Reply>[] = [];
try {
  for (let i = 0; i < N; i++) {
    clients.push(
      await Bun.connect<Reply>({
        hostname: "127.0.0.1",
        port: server.port,
        tls: { rejectUnauthorized: false },
        data: { reply: "" },
        socket: {
          // Step 1. The handshake's last flight leaves with the ping, so the pause comes first.
          handshake(c, success) {
            if (!success) return;
            accepted.get(c.localPort)!.pause();
            c.write("ping");
            c.shutdown();
            clientHandshakes++;
          },
          data(c, chunk) {
            c.data.reply += chunk.toString();
          },
          close(c, err) {
            clientCloses++;
            if (c.data.reply === "pong") summary.pongs++;
            if (err) summary.resets++;
          },
          error() {},
        },
      }),
    );
  }
  await until(`${N} client handshakes`, () => clientHandshakes === N);

  // Step 2.
  echo.write("x");
  await until("the echo", () => echoed === 1);

  // Step 3.
  for (const s of accepted.values()) s.resume();

  // Step 4.
  await until(`${N} client closes`, () => clientCloses === N);
} catch (e) {
  report({ error: String(e) });
} finally {
  for (const c of clients) c.terminate();
  echo.terminate();
  echoServer.stop(true);
  server.stop(true);
}
report();
