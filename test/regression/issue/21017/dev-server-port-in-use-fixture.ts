import html from "./index-fixture.html";
import { readFileSync } from "node:fs";

function threadCount(): number {
  if (process.platform !== "linux") return -1;
  try {
    const status = readFileSync("/proc/self/status", "utf8");
    const m = status.match(/Threads:\s*(\d+)/);
    return m ? parseInt(m[1], 10) : -1;
  } catch {
    return -1;
  }
}

// Occupy a port so subsequent Bun.serve() calls on it throw EADDRINUSE.
using blocker = Bun.serve({
  port: 0,
  fetch: () => new Response("blocked"),
});
const busyPort = blocker.port;

const iterations = 40;
let threw = 0;

const threadsBefore = threadCount();

for (let i = 0; i < iterations; i++) {
  try {
    const s = Bun.serve({
      port: busyPort,
      reusePort: false,
      development: true,
      routes: { "/": html },
      fetch: () => new Response("ok"),
    });
    // Shouldn't reach here, but if it does, clean up.
    s.stop(true);
  } catch {
    threw++;
  }
}

if (threw !== iterations) {
  console.error(`expected ${iterations} EADDRINUSE throws, got ${threw}`);
  process.exit(1);
}

let threadsAfter = threadCount();
if (process.platform === "linux") {
  // The watcher thread is signalled to exit asynchronously; give any
  // still-winding-down threads a brief moment to finish, polling rather
  // than sleeping for a fixed time. With the fix this converges almost
  // immediately; without it, it never converges (threads are parked on a
  // futex forever), so a short deadline is enough.
  const deadline = Date.now() + 2000;
  while (threadsAfter - threadsBefore >= 10 && Date.now() < deadline) {
    await Bun.sleep(20);
    threadsAfter = threadCount();
  }
  console.log(`THREAD_DELTA=${threadsAfter - threadsBefore}`);
}

console.log("PASS");
