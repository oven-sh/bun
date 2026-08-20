// A UDP peer sending at or above our drain rate must not starve the event
// loop: the recv dispatch used to loop until EAGAIN, so while the kernel
// queue stayed non-empty no timer or other socket ever ran. libuv bounds a
// dispatch at 32 datagrams; usockets now does the same (4 batches of 8).
//
// The receiver burns ~2ms per datagram so a child-process flooder easily
// outpaces it; a 20ms interval then measures whether the loop still breathes.
import { bunEnv, bunExe } from "harness";

const firstPacket = Promise.withResolvers<void>();
let got = 0;
// Under total starvation not even Bun.sleep's timer fires, so the data
// handler itself is the watchdog: it is the one callback starvation keeps
// feeding. 0 until the measurement starts.
let watchdogDeadline = 0;

const receiver = await Bun.udpSocket({
  hostname: "127.0.0.1",
  port: 0,
  socket: {
    data() {
      if (++got === 1) firstPacket.resolve();
      if (watchdogDeadline && Bun.nanoseconds() > watchdogDeadline) {
        fail(`STARVED: data handler still monopolizing the loop after 6s (received ${got})`);
      }
      const end = Bun.nanoseconds() + 2_000_000; // ~2ms of work per datagram
      while (Bun.nanoseconds() < end) {}
    },
    error() {},
  },
});

// The flooder self-expires after 15s so no exit path of ours can leak it, and
// swallows the ICMP unreachable errors it gets once our socket closes.
const flooder = Bun.spawn({
  cmd: [
    bunExe(),
    "-e",
    `
      const s = await Bun.udpSocket({ socket: { data() {}, error() {} } });
      const buf = new Uint8Array(64);
      const deadline = Date.now() + 15_000;
      function burst() {
        if (Date.now() > deadline) process.exit(0);
        for (let i = 0; i < 500; i++) {
          try { s.send(buf, ${receiver.port}, "127.0.0.1"); } catch {}
        }
        setTimeout(burst, 0);
      }
      burst();
    `,
  ],
  env: bunEnv,
  stdout: "ignore",
  stderr: "pipe",
});

function fail(message: string): never {
  console.error(message);
  flooder.kill();
  process.exit(1);
}

// A flooder that dies before its first datagram would leave firstPacket
// pending forever; surface its exit (and stderr) instead of an opaque hang.
await Promise.race([
  firstPacket.promise,
  flooder.exited.then(async code => {
    throw new Error(`flooder exited (${code}) before the first packet: ${await flooder.stderr.text()}`);
  }),
]);
watchdogDeadline = Bun.nanoseconds() + 6_000_000_000;

let ticks = 0;
const interval = setInterval(() => {
  ticks++;
}, 20);

await Bun.sleep(2000);
clearInterval(interval);
flooder.kill();
receiver.close();

console.log(`interval fired ${ticks} times during 2s of flood (received ${got} datagrams)`);
if (ticks < 5) {
  console.error(`STARVED: interval fired only ${ticks} times in 2s under UDP flood`);
  process.exit(1);
}
process.exit(0);
