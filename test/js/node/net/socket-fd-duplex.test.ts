import { expect, test } from "bun:test";
import { isWindows, tempDir } from "harness";
import { openSync, closeSync } from "node:fs";
import { Socket } from "node:net";
import { join } from "node:path";

// net.Socket({fd}) on a FIFO is duplex: writeBuffer/writeUtf8String go through
// the native Pipe handle's StreamingWriter, readStart/onread through its
// BufferedReader. Two FIFOs (a→b, b→a) form a loopback.
test.skipIf(isWindows)("net.Socket({fd}) duplex write+read on a FIFO pair", async () => {
  using dir = tempDir("net-socket-fd-duplex", {});
  const fifoAB = join(String(dir), "ab");
  const fifoBA = join(String(dir), "ba");
  Bun.spawnSync({ cmd: ["mkfifo", fifoAB, fifoBA] });

  // Open both ends RDWR so open() doesn't block waiting for the other side.
  const fdA_read = openSync(fifoBA, "r+");
  const fdA_write = openSync(fifoAB, "r+");
  const fdB_read = openSync(fifoAB, "r+");
  const fdB_write = openSync(fifoBA, "r+");

  try {
    // A reads from BA, writes to AB. We only need one Socket here; the other
    // side is driven via raw fds for simplicity.
    const sockA = new Socket({ fd: fdA_write });
    expect(sockA._handle?.constructor.name).toBe("Pipe");

    const wrote = await new Promise<boolean>((resolve, reject) => {
      sockA.write("hello-from-A", err => (err ? reject(err) : resolve(true)));
    });
    expect(wrote).toBe(true);
    expect(sockA._handle.bytesWritten).toBeGreaterThan(0);

    // Read it back from the other end via a second Socket on fdB_read.
    const sockB = new Socket({ fd: fdB_read, writable: false });
    const got = await new Promise<string>(resolve => {
      sockB.once("data", d => resolve(d.toString()));
    });
    expect(got).toBe("hello-from-A");

    sockA.destroy();
    sockB.destroy();
  } finally {
    for (const fd of [fdA_read, fdA_write, fdB_read, fdB_write]) {
      try {
        closeSync(fd);
      } catch {}
    }
  }
});
