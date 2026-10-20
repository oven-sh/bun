// A TLS Bun.serve must answer every client of a burst, also when its loop is too slow to read
// every ClientHello within the 10 s that a connection gets to send its request.
//
// uSockets reads at most 5 handshaking TLS sockets per loop iteration. It parks the others in a
// queue with their reads off and takes 5 back per iteration. The timeout sweep runs on a 4 s tick,
// and the 10 s timeout is 3 ticks. This server accepts the whole burst in one iteration and then
// lets the loop iterate once per tick for 3 ticks, so most of the burst is still in the queue
// when its timeout comes due. The time a socket spends there, unread, is the server's own delay:
// the timeout must not run against it.
//
// The clients run in a child process. On the server's loop their handshakes would go through the
// same queue.
//
// Prints one JSON line: { clients, answered, errors }.

import { getEventLoopStats } from "bun:internal-for-testing";
import { bunEnv, bunExe, tempDir, tls as certs } from "harness";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const N = 40;
// LIBUS_TIMEOUT_GRANULARITY (packages/bun-usockets/src/libusockets.h) plus a margin.
const TICK_MS = 4100;
const TICKS = 3;
const STEP_DEADLINE_MS = 20_000;

type Summary = { clients: number; answered: number; errors: Record<string, number> };

if (process.argv[2] === "client") {
  await client(Number(process.argv[3]), process.argv[4]);
} else {
  await server();
}

async function server() {
  using dir = tempDir("parked-handshake", {});
  const everyHelloSent = join(String(dir), "every-hello-sent");

  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    tls: { cert: certs.cert, key: certs.key },
    fetch: () => new Response("ok"),
  });
  // The sweep only ticks while a socket is linked, and a parked socket is not. This pair keeps it ticking.
  const keep = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  const keepClient = await Bun.connect({ hostname: "127.0.0.1", port: keep.port, socket: { data() {} } });

  await using child = Bun.spawn({
    cmd: [bunExe(), import.meta.path, "client", String(server.port), everyHelloSent],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });

  // The loop stays blocked until every ClientHello is in the kernel, so one iteration accepts them all.
  const deadline = Date.now() + STEP_DEADLINE_MS;
  while (!existsSync(everyHelloSent)) {
    if (Date.now() > deadline) throw new Error("timed out waiting for the clients to connect");
    Bun.sleepSync(5);
  }
  await oneIteration();
  for (let tick = 0; tick < TICKS; tick++) {
    // No signal says that a sweep tick is due. The tick is a clock, and the test is about that clock.
    Bun.sleepSync(TICK_MS);
    await oneIteration();
  }

  const [stdout, exitCode] = await Promise.all([child.stdout.text(), child.exited]);
  if (exitCode !== 0) throw new Error(`the client process exited with code ${exitCode}`);
  console.log(stdout.trim());

  keepClient.terminate();
  keep.stop(true);
  await server.stop(true);
}

// An immediate runs once per loop iteration.
async function oneIteration() {
  const target = getEventLoopStats().iteration + 1;
  while (getEventLoopStats().iteration < target) await new Promise(resolve => setImmediate(resolve));
}

async function client(port: number, everyHelloSent: string) {
  const summary: Summary = { clients: N, answered: 0, errors: {} };
  const settled = Promise.withResolvers<void>();
  let opened = 0;
  let pending = N;

  for (let i = 0; i < N; i++) {
    let response = "";
    let done = false;
    const settle = (error?: string) => {
      if (done) return;
      done = true;
      if (error !== undefined) summary.errors[error] = (summary.errors[error] ?? 0) + 1;
      else summary.answered++;
      if (--pending === 0) settled.resolve();
    };
    const code = (e: unknown) => (e as { code?: string })?.code ?? String(e);
    Bun.connect({
      hostname: "127.0.0.1",
      port,
      tls: { rejectUnauthorized: false },
      socket: {
        open() {
          // The ClientHello goes out when this returns. Two turns later all of them are in the kernel.
          if (++opened === N) setImmediate(() => setImmediate(() => writeFileSync(everyHelloSent, "")));
        },
        handshake(socket, success) {
          if (success) socket.write("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
        },
        data(socket, chunk) {
          response += chunk.toString();
        },
        error(socket, error) {
          settle(code(error));
        },
        close(socket, error) {
          if (error) settle(code(error));
          else if (response.startsWith("HTTP/1.1 200") && response.endsWith("ok")) settle();
          else settle("closed without a response");
        },
        connectError(socket, error) {
          settle(code(error));
        },
      },
    }).catch(error => settle(code(error)));
  }

  await settled.promise;
  console.log(JSON.stringify(summary));
}
