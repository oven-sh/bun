const net = require("node:net");

process.on("uncaughtException", e => {
  console.error("UNCAUGHT:", e.message);
  process.exit(1);
});

const sock = net.connect({
  host: "test.invalid",
  port: 443,
  autoSelectFamily: true,
  autoSelectFamilyAttemptTimeout: 100,
  lookup(host, opts, cb) {
    // TEST-NET-1; the goal is an attempt that stays pending so the timer is
    // armed before destroy() runs. On hosts where the kernel rejects this
    // synchronously instead, the socket is already destroyed and this
    // fixture exercises the sync-fail guard instead — still no crash.
    process.nextTick(cb, null, [
      { address: "192.0.2.1", family: 4 },
      { address: "192.0.2.2", family: 4 },
    ]);
  },
});
sock.on("error", () => {});

// setImmediate runs after the lookup nextTick (which armed the per-attempt
// timer) and before any setTimeout, so destroy() lands deterministically
// while the timer for attempt 0 is pending — no wall-clock race.
setImmediate(() => {
  console.log("connecting at destroy:", sock.connecting);
  sock.destroy();
});

// Wait past the per-attempt timeout to catch the stale timer firing.
setTimeout(() => {
  console.log("OK");
  process.exit(0);
}, 300);
