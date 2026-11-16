// Worker side of fs-eintr-open-fixture.ts (macOS only): directs SIGUSR1 at
// the main thread while it blocks in open(2), then opens the fifo for writing
// to unblock it.
import { dlopen } from "bun:ffi";
import { closeSync, openSync, writeSync } from "node:fs";

declare var self: Worker;

const SIGUSR1 = 30; // macOS

const libc = dlopen("libc.dylib", {
  pthread_kill: { args: ["u64", "i32"], returns: "i32" },
});

self.onmessage = ({ data: { tid, fifo } }) => {
  // Each delivery interrupts the main thread's blocked openat with EINTR.
  for (let i = 0; i < 30; i++) {
    libc.symbols.pthread_kill(tid, SIGUSR1);
    Bun.sleepSync(8);
  }
  // Unblock the reader.
  const fd = openSync(fifo, "w");
  writeSync(fd, "unblocked");
  closeSync(fd);
};
