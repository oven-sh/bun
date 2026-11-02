// Crashes when `malloc` has begun to return NULL, as it does for the thread of an out-of-memory crash.
//
// The test sets `soft_rss_limit_mb` in ASAN_OPTIONS. AddressSanitizer's allocator then refuses every request while
// the process holds more memory than that. JavaScriptCore allocates with libpas, which the sanitizer does not
// intercept, so this script runs on.
//
// usage: bun fixture-crash-without-memory.js <approach> [in-signal-handler]
const { crash_handler } = require("bun:internal-for-testing");
const { Database } = require("bun:sqlite");

const [approach, where] = process.argv.slice(2);
let crash = crash_handler[approach];

if (where === "in-signal-handler") {
  // The handler of a signal returns into libc, so the stack of this crash has a frame that is not in the executable.
  const { dlopen, JSCallback } = require("bun:ffi");
  const { symbols: libc } = dlopen("libc.so.6", {
    signal: { args: ["i32", "ptr"], returns: "ptr" },
    getpid: { args: [], returns: "i32" },
    kill: { args: ["i32", "i32"], returns: "i32" },
  });
  const SIGUSR2 = 12;
  const hook = crash;
  const handler = new JSCallback(() => hook(), { args: ["i32"], returns: "void" });
  libc.signal(SIGUSR2, handler.ptr);
  const pid = libc.getpid();
  crash = () => libc.kill(pid, SIGUSR2);
}

// SQLite allocates with `malloc`, and reports a failure of it as an exception.
const mallocFails = () => {
  try {
    new Database(":memory:").close();
    return false;
  } catch {
    return true;
  }
};
if (mallocFails()) throw new Error("malloc has no memory before the limit is reached");

const limit = Number(/soft_rss_limit_mb=(\d+)/.exec(process.env.ASAN_OPTIONS)[1]) * 1024 * 1024;
const hold = [];
while (process.memoryUsage.rss() < limit + 32 * 1024 * 1024) hold.push(new Uint8Array(16 * 1024 * 1024).fill(1));

// The sanitizer compares the memory of the process with the limit ten times a second.
const deadline = Date.now() + 30_000;
while (!mallocFails()) {
  if (Date.now() > deadline) throw new Error("malloc still has memory");
  Bun.sleepSync(5);
}

crash();
