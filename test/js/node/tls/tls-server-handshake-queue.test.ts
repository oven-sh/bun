// uSockets parks TLS sockets that become readable mid-handshake once the
// per-iteration handshake budget (5) is spent: READABLE is removed, the socket
// is unlinked from its group and pushed onto the loop's low-priority queue
// (which reuses the same prev/next links). us_socket_resume() re-armed
// READABLE on parked sockets without checking low_prio_state, so the next
// readable dispatch parked them a second time. That runs the group unlink on
// queue links (corrupting both intrusive lists, later a heap-use-after-free)
// and leaks one low_prio_count / sweep-timer reference per occurrence.
//
// The sweep-timer leak is the deterministic, build-independent symptom this
// test asserts on: us_internal_disable_sweep_timer() is called once more than
// us_internal_enable_sweep_timer(), so once every socket from the storm is
// gone the refcount is negative and the 4s timeout sweep can never be
// re-armed. A fresh idle connection with a native 1s timeout then never gets
// its `timeout` callback.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tls as tlsCert } from "harness";

const fixture = String.raw`
  const tls = require("node:tls");
  const net = require("node:net");

  const key = ${JSON.stringify(tlsCert.key)};
  const cert = ${JSON.stringify(tlsCert.cert)};

  const CLIENTS = 32; // > MAX_LOW_PRIO_SOCKETS_PER_LOOP_ITERATION (5)
  const TURNS = 40;

  const srv = tls.createServer({ key, cert });
  srv.on("tlsClientError", () => {});
  srv.on("error", () => {});
  const serverSockets = [];
  srv.on("connection", s => {
    s.on("error", () => {});
    serverSockets.push(s);
  });

  // An incomplete TLS record (claims 0x4000 bytes that never arrive) keeps the
  // server-side SSL in SSL_in_init(), i.e. eligible for the low-priority queue,
  // for the whole life of the connection.
  const HEADER = Buffer.from([0x16, 0x03, 0x01, 0x40, 0x00]);
  const CHUNK = Buffer.alloc(64, 0x41);
  const clients = [];

  srv.listen(0, "127.0.0.1", () => {
    const port = srv.address().port;
    let connected = 0;
    for (let i = 0; i < CLIENTS; i++) {
      const c = net.connect(port, "127.0.0.1");
      c.on("error", () => {});
      clients.push(c);
      c.once("connect", () => {
        c.setNoDelay(true);
        if (++connected === CLIENTS) setTimeout(storm, 30);
      });
    }

    let turn = 0;
    function storm() {
      turn++;
      // Refill every socket's receive buffer so all of them stay readable
      // while still inside the handshake.
      if (turn % 8 === 1) {
        for (const c of clients) if (!c.destroyed) c.write(turn === 1 ? Buffer.concat([HEADER, CHUNK]) : CHUNK);
      }
      // The load-bearing lines: pause()+resume() from the 'connection' handler
      // is the documented backpressure idiom for pre-handshake sockets.
      for (const s of serverSockets) {
        if (!s.destroyed) {
          s.pause();
          s.resume();
        }
      }
      if (turn < TURNS) return void setImmediate(storm);

      for (const c of clients) c.destroy();
      for (const s of serverSockets) s.destroy();
      srv.close();
      setTimeout(probe, 100);
    }
  });

  // An unrelated idle connection whose *native* 1s timeout must still fire
  // (bun's socket timeouts ride the loop-wide sweep timer).
  function probe() {
    const guard = setTimeout(() => {
      console.log("TIMEOUT_NEVER_FIRED");
      process.exit(1);
    }, 14000);
    const probeServer = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        open(s) {
          s.timeout(1);
        },
        timeout(s) {
          clearTimeout(guard);
          console.log("TIMEOUT_FIRED");
          s.end();
          probeServer.stop(true);
          process.exit(0);
        },
        data() {},
        error() {},
        close() {},
      },
    });
    const probeClient = net.connect(probeServer.port, "127.0.0.1");
    probeClient.on("error", () => {});
  }
`;

// The sweep timer fires every 4 seconds (LIBUS_TIMEOUT_GRANULARITY), so the
// healthy path needs ~5-9s and the broken path exits after its 14s guard.
test(
  "pause()+resume() on pre-handshake sockets does not corrupt the low-priority handshake queue",
  async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // stderr is only for diagnostics (ASAN reports land there); the assertion
    // is the child's verdict.
    if (exitCode !== 0) console.error(stderr);
    expect({ stdout: stdout.trim(), exitCode }).toEqual({ stdout: "TIMEOUT_FIRED", exitCode: 0 });
  },
  30_000,
);
