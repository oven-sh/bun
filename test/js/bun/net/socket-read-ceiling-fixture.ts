// Fixture for "one readable event reads a socket at most 32 full times" in socket.test.ts.
//
// After a read that fills its 512 KiB buffer, usockets reads the socket again without going
// back to the event loop (loop.c, MAX_FULL_READS_PER_READABLE_EVENT). This process holds one
// TCP connection to itself, alone on its loop. The receiving side's data handler writes to
// the sending side until the kernel refuses, so the next read is full too, for as long as the
// loop keeps reading. Without a bound, one readable event reads the whole stream.
//
// A read only fills the buffer when the kernel's receive buffer holds more than one read.
// The first attempt asks for 1 MiB with SO_RCVBUF, and then the first read is already full.
// Where net.core.rmem_max is smaller (212992 by default before Linux 6.18) the kernel clamps
// the request to less than one read and stops autotuning that socket. The later attempts
// leave the buffers alone and give receive autotuning a while to grow them.
//
// Prints one JSON line:
//   reason         "capped": two events took exactly CEILING full reads.
//                  "exceeded": one event took more.
//                  "gave-up": no attempt got that far.
//   longestRun     the most full reads one event took, over all attempts.
//   intact         every byte written arrived, in every attempt.
//   bufferGranted  the kernel did not clamp the first attempt's receive buffer.
import { getEventLoopStats, setSocketOptions } from "bun:internal-for-testing";

const CEILING = 32;
// loop.c reads again after a read of at least LIBUS_RECV_BUFFER_LENGTH - 24 KiB.
const FULL_READ = 512 * 1024 - 24 * 1024;
const MiB = 1024 * 1024;
const chunk = Buffer.alloc(MiB, "a");
// The run of full reads is only confirmed on Linux, so only there is another try worth it.
const attemptsAllowed = process.platform === "linux" ? 3 : 1;

type Reason = "capped" | "exceeded" | "gave-up";

async function attempt(pinBuffers: boolean) {
  let sender: Bun.Socket;
  let sent = 0;
  let received = 0;
  let flooding = true;
  let reason: Reason = "gave-up";
  let iteration = -1;
  let run = 0;
  let longestRun = 0;
  let cappedEvents = 0;
  // With a granted buffer the first read is full. Autotuning needs a few MiB to get there.
  const patience = (pinBuffers ? 4 : 32) * MiB;
  const receiverClosed = Promise.withResolvers<void>();
  const senderClosed = Promise.withResolvers<void>();

  function fill() {
    while (flooding) {
      const written = sender.write(chunk);
      if (written > 0) sent += written;
      if (written < chunk.length) break;
    }
  }
  function stop(why: Reason) {
    flooding = false;
    reason = why;
    sender.end();
  }

  using listener = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(socket) {
        if (pinBuffers) setSocketOptions(socket, 2, MiB);
      },
      data(_socket, data) {
        received += data.length;
        // After stop() this only counts what the kernel still held.
        if (!flooding) return;
        // One loop iteration dispatches one readable event for this socket.
        const now = getEventLoopStats().iteration;
        if (now !== iteration) {
          if (run === CEILING) cappedEvents++;
          iteration = now;
          run = 0;
          if (cappedEvents === 2) return stop("capped");
        }
        if (data.length >= FULL_READ) {
          if (++run > longestRun) longestRun = run;
          if (run > CEILING) return stop("exceeded");
        }
        if (received >= (longestRun === 0 ? patience : 128 * MiB)) return stop("gave-up");
        fill();
      },
      close() {
        receiverClosed.resolve();
      },
      error() {},
    },
  });
  await Bun.connect({
    hostname: "127.0.0.1",
    port: listener.port,
    socket: {
      open(socket) {
        sender = socket;
        if (pinBuffers) setSocketOptions(socket, 1, MiB);
      },
      drain: fill,
      data() {},
      close() {
        senderClosed.resolve();
      },
      error() {},
    },
  });
  fill();
  await Promise.all([receiverClosed.promise, senderClosed.promise]);
  return { reason, longestRun, intact: received === sent };
}

// setsockopt() fails for a size over the limit on macOS. Linux clamps it.
const first = await attempt(process.platform === "linux");
const bufferGranted = process.platform === "linux" && first.longestRun > 0;
let { reason, longestRun, intact } = first;
for (let attempts = 1; reason === "gave-up" && attempts < attemptsAllowed; attempts++) {
  const next = await attempt(false);
  reason = next.reason;
  longestRun = Math.max(longestRun, next.longestRun);
  intact &&= next.intact;
}
console.log(JSON.stringify({ reason, longestRun, intact, bufferGranted }));
