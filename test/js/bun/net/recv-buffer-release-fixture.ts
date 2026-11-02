// Its own process: any other socket on the loop would write to the same two buffers.
import { recvBufferTails, residentBytes } from "bun:internal-for-testing";
import { tls } from "harness";

type Tails = NonNullable<ReturnType<typeof recvBufferTails>>;
const resident = (tails: Tails) => ({
  recv: residentBytes(tails.recv.address, tails.recv.length)!,
  tls: residentBytes(tails.tls.address, tails.tls.length)!,
});
const peak = { recv: 0, tls: 0 };
function sample(tails: Tails) {
  const now = resident(tails);
  peak.recv = Math.max(peak.recv, now.recv);
  peak.tls = Math.max(peak.tls, now.tls);
}

// The HTTP client thread has no timers: once its last socket is closed it polls with no timeout, so
// nothing but the release's own deadline wakes it.
async function overHTTP(secure: boolean) {
  using server = Bun.serve({
    port: 0,
    tls: secure ? tls : undefined,
    fetch: () => new Response(Buffer.alloc(4 * 1024 * 1024, "a")),
  });
  const response = await fetch(server.url, { tls: { ca: tls.cert }, keepalive: false });
  for await (const _ of response.body!) sample(recvBufferTails(true)!);
  return recvBufferTails(true)!;
}

// One recvmmsg() puts each datagram at its own 64 KiB offset of the buffer.
async function overUDP() {
  const count = 8;
  let total = 0;
  const { promise, resolve } = Promise.withResolvers<void>();
  const receiver = await Bun.udpSocket({
    hostname: "127.0.0.1",
    socket: {
      data() {
        sample(recvBufferTails()!);
        if (++total === count) resolve();
      },
    },
  });
  const sender = await Bun.udpSocket({ hostname: "127.0.0.1" });
  const sent = sender.sendMany(Array.from({ length: count }, () => ["hello", receiver.port, "127.0.0.1"]).flat());
  if (sent !== count) throw new Error(`sent ${sent} of ${count}`);
  await promise;
  return recvBufferTails()!;
}

async function settle(tails: Tails) {
  const deadline = performance.now() + 10_000;
  let settled = resident(tails);
  while ((settled.recv || settled.tls) && performance.now() < deadline) {
    await Bun.sleep(20);
    settled = resident(tails);
  }
  return settled;
}

// Allocating a buffer schedules a release too. Only the second round's depends on the reads alone.
const mode = process.argv[2];
const run = mode === "udp" ? overUDP : () => overHTTP(mode === "tls");
const first = await settle(await run());
peak.recv = peak.tls = 0;
const second = await settle(await run());
console.log(JSON.stringify({ first, peak, second }));
process.exit(0);
