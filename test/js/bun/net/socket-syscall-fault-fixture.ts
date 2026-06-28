// Fixture for socket-syscall-fault.test.ts. Exits 0 and prints one JSON line
// on success; a use-after-free (ASan) or a usockets debug assertion aborts it.
//
// uSockets keeps an accepted TLS socket in exactly one of group->head_sockets
// or loop->data.low_prio_head (the handshake back-pressure queue); the two
// lists share the socket's prev/next fields and flags.low_prio_state is the
// discriminator. A socket that was already parked (low_prio_state == 1) could
// still get a READABLE dispatch, because us_socket_raw_write re-arms
// READABLE|WRITABLE whenever a send is short/fails and parking only masks
// READABLE off. Re-running the park then unlinked the socket from
// group->head_sockets using its low_prio_head links, splicing the two lists
// into each other; a later close freed the socket while head_sockets (and the
// timer sweep, and the low-prio walk) could still reach it.
//
// Recipe, all of it what a loaded public TLS endpoint sees (a full send
// buffer, clients aborting mid-handshake):
//  1) bsd_send returns 0, so the SSL write BIO reports retry and BoringSSL
//     keeps the whole ServerHello flight buffered: every accepted socket
//     stays SSL_in_init polling READABLE|WRITABLE forever. ("short" would
//     NOT work: BoringSSL's flush loop just re-calls the BIO with the
//     remainder, so the flight still drains in one SSL_read.)
//  2) a clean child process holds BURST real TLS clients open, then destroys
//     them all synchronously: BURST FINs land in one epoll batch, exhausting
//     the low-prio budget (5), so the rest of the server sockets PARK with
//     WRITABLE still armed.
//  3) a parked socket's WRITABLE tick retries the (still failing) flight and
//     re-arms READABLE with low_prio_state == 1. Its FIN is level-triggered
//     EPOLLIN, so every later tick re-enters the budget gate until one of
//     them lands past budget exhaustion: the corrupting re-park.
import { socketFaultInjection as fault } from "bun:internal-for-testing";

const pem = JSON.parse(process.env.TLS_PEM!);
const ROUNDS = Number(process.env.ROUNDS ?? 30);
const BURST = Number(process.env.BURST ?? 48);

let accepted = 0;
let closed = 0;

const server = Bun.listen({
  port: 0,
  hostname: "127.0.0.1",
  tls: { key: pem.key, cert: pem.cert },
  socket: {
    open(s) {
      accepted++;
      s.timeout(1); // keep the timer sweep walking head_sockets
    },
    handshake() {},
    data() {},
    drain() {},
    timeout(s) {
      s.timeout(1);
    },
    error() {},
    close() {
      closed++;
    },
  },
});

fault.set({ syscall: "send", action: "zero", after: 0, repeat: -1 });

// The client child must not be faulted (fault rules are process-wide), so the
// server keeps getting complete ClientHellos to answer.
const clientSrc = /* js */ `
  const tls = require("node:tls");
  const [port, n, rounds] = process.argv.slice(1).map(Number);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  for (let r = 0; r < rounds; r++) {
    const socks = [];
    for (let i = 0; i < n; i++) {
      const c = tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false });
      c.on("error", () => {});
      socks.push(c);
    }
    await sleep(8 + Math.floor(Math.random() * 60));
    for (const c of socks) c.destroy();
    await sleep(4);
  }
  process.exit(0);
`;

const child = Bun.spawn({
  cmd: [process.execPath, "-e", clientSrc, String(server.port), String(BURST), String(ROUNDS)],
  env: { ...process.env, BUN_DEBUG_QUIET_LOGS: "1" },
  stdout: "ignore",
  stderr: "ignore",
});
await child.exited;

fault.clear();
// Group teardown also trips the pre-existing US_ASSERT(group->low_prio_count
// == 0) when the re-park has double-counted the queue.
server.stop(true);
await Bun.sleep(100);
console.log(JSON.stringify({ ok: true, accepted, closed, childExit: child.exitCode }));
