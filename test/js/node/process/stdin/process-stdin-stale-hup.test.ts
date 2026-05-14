// PosixBufferedReader.readBlockingPipe() used to snapshot received_hup from
// the epoll/kqueue event and then loop `while(true)` draining the pipe
// without ever re-checking it. onReadChunk() re-enters JS (resolves the
// pending read, drains microtasks, fires the 'data' event), so user code can
// open a new writer on the same FIFO before control returns to the drain
// loop. With a writer present the next readNonblocking() can no longer reach
// EOF:
//   - Linux named FIFOs: preadv2(RWF_NOWAIT) → EOPNOTSUPP → fallback to
//     blocking read() → the event-loop thread blocks forever.
//   - O_NONBLOCK fd: read() → EAGAIN → loop → EAGAIN → 100% CPU spin.
// Either way the process stops making progress after the parent "dies".
//
// The fix re-evaluates bun.isReadable() before looping back and re-arms the
// poll on EAGAIN, so the event loop stays live.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isPosix, tempDir } from "harness";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const fixture = path.join(import.meta.dir, "stale-hup.fixture.js");

test.skipIf(!isPosix)(
  "process.stdin drain loop does not wedge on a stale POLLHUP when a writer reappears",
  async () => {
    using dir = tempDir("stdin-stale-hup", {});
    const fifo = path.join(String(dir), "fifo");
    execFileSync("mkfifo", [fifo]);

    // Open the FIFO read end ourselves and hand it to the child as stdin.
    // O_NONBLOCK so this open does not block before a writer exists; the
    // flag is per open-file-description and so is inherited by the child's
    // fd 0. FileReader still classifies it as `.pipe` (ISFIFO, not a TTY)
    // and takes the readBlockingPipe path regardless of O_NONBLOCK.
    const readFd = fs.openSync(fifo, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
    const writeFd = fs.openSync(fifo, fs.constants.O_WRONLY);

    await using proc = Bun.spawn({
      cmd: [bunExe(), fixture, fifo],
      env: bunEnv,
      stdin: readFd,
      stdout: "pipe",
      stderr: "pipe",
    });
    fs.closeSync(readFd);

    // Wait for the child to register its stdin poll before we write+close,
    // so the data and HUP arrive in the same epoll/kqueue event.
    const stderrReader = proc.stderr.getReader();
    let stderrBuf = "";
    while (!stderrBuf.includes("ready\n")) {
      const { value, done } = await stderrReader.read();
      if (done) break;
      stderrBuf += Buffer.from(value).toString();
    }

    // Write a chunk and immediately close our writer: child's epoll reports
    // POLLIN|POLLHUP and readBlockingPipe enters with received_hup=true.
    fs.writeSync(writeFd, "hello");
    fs.closeSync(writeFd);

    // The fixture's 'data' handler opens its own writer on `fifo`, which
    // un-hangs-up the pipe while readBlockingPipe is still on the stack with
    // a stale received_hup=true. If the drain loop wedges, the child never
    // prints OK and never exits; the race resolves via the timeout path.
    // The fixture's own setTimeout fires at 500ms, so in the passing case
    // the child exits well under a second after we closed the writer.
    const exited = await Promise.race([proc.exited, Bun.sleep(3000).then(() => "timeout" as const)]);

    if (exited === "timeout") {
      proc.kill(9);
      await proc.exited;
    }

    // Drain the rest of stderr (we already consumed the "ready\n" prefix).
    while (true) {
      const { value, done } = await stderrReader.read();
      if (done) break;
      stderrBuf += Buffer.from(value).toString();
    }
    stderrReader.releaseLock();
    const stdout = await proc.stdout.text();

    expect(stderrBuf).toContain("data len=5");
    expect(stderrBuf).toContain("opened writer fd=");
    expect({ stdout: stdout.trim(), exited }).toEqual({ stdout: "OK", exited: 0 });
  },
  // Debug-bun child startup + the 3s hang-detection race above can approach
  // the default 5s test timeout on slow CI; give explicit headroom.
  15000,
);
