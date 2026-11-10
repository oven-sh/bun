// Fixture for fs-eintr-darwin.test.ts (macOS only).
//
// Installs a SIGUSR1 handler WITHOUT SA_RESTART, then blocks the main thread
// in open(2) on a fifo that has no writer. A worker thread directs SIGUSR1 at
// this thread with pthread_kill, so the blocked openat returns EINTR on every
// delivery. Bun must retry internally; surfacing EINTR to JS is the bug
// (issue #41085).
import { dlopen, ptr } from "bun:ffi";
import { closeSync, openSync, readSync } from "node:fs";

const fifo = process.argv[2];
const SIGUSR1 = 30; // macOS
const RTLD_DEFAULT = -2; // macOS

const libc = dlopen("libc.dylib", {
  sigaction: { args: ["i32", "ptr", "ptr"], returns: "i32" },
  pthread_self: { args: [], returns: "u64" },
  dlsym: { args: ["i64", "ptr"], returns: "u64" },
});

// The handler is getpid: async-signal-safe, ignores its argument.
const name = Buffer.from("getpid\0");
const handler = libc.symbols.dlsym(RTLD_DEFAULT, ptr(name));
if (handler === 0n) {
  console.error("dlsym(getpid) failed");
  process.exit(1);
}

// struct sigaction on macOS: { void* sa_handler; sigset_t sa_mask (u32); int sa_flags; }
const act = new Uint8Array(16);
const view = new DataView(act.buffer);
view.setBigUint64(0, BigInt(handler), true); // sa_handler
view.setUint32(8, 0, true); // sa_mask: empty
view.setInt32(12, 0, true); // sa_flags: no SA_RESTART
if (libc.symbols.sigaction(SIGUSR1, ptr(act), null) !== 0) {
  console.error("sigaction failed");
  process.exit(1);
}

const worker = new Worker(new URL("./fs-eintr-signal-worker.ts", import.meta.url).href);
worker.postMessage({ tid: libc.symbols.pthread_self(), fifo });

try {
  // Blocks until the worker opens the fifo for writing. The worker keeps
  // interrupting this thread with SIGUSR1 the whole time.
  const fd = openSync(fifo, "r");
  const buf = Buffer.alloc(16);
  const n = readSync(fd, buf, 0, 16, null);
  closeSync(fd);
  console.log(buf.toString("utf8", 0, n));
  process.exit(0);
} catch (e) {
  console.error(e);
  process.exit(1);
}
