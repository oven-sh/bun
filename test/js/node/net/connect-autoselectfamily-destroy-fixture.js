const net = require("node:net");

process.on("uncaughtException", e => {
  console.error("UNCAUGHT:", e.message);
  process.exit(1);
});

let destroyed = false;
let attemptFailedBeforeDestroy = false;
const sock = net.connect({
  host: "test.invalid",
  port: 443,
  autoSelectFamily: true,
  autoSelectFamilyAttemptTimeout: 100,
  lookup(host, opts, cb) {
    // TEST-NET-1 black-holes, so attempt 0 is still pending (and its
    // per-attempt timer armed) when the setImmediate below destroys.
    process.nextTick(cb, null, [
      { address: "192.0.2.1", family: 4 },
      { address: "192.0.2.2", family: 4 },
    ]);
  },
});
sock.on("error", () => {});
sock.on("connectionAttemptFailed", () => {
  attemptFailedBeforeDestroy ||= !destroyed;
});

// The regression: the stale per-attempt timer firing on the destroyed socket,
// either emitting this event or throwing the handle.close() TypeError.
sock.on("connectionAttemptTimeout", () => {
  if (!destroyed) return;
  console.error("POST_DESTROY_EVENT:connectionAttemptTimeout");
  process.exit(1);
});

// setImmediate runs after the lookup nextTick (which armed the per-attempt
// timer) and before any setTimeout, so destroy() lands deterministically
// while the timer for attempt 0 is pending — no wall-clock race.
setImmediate(() => {
  if (!sock.connecting || attemptFailedBeforeDestroy) {
    // This host has no route to TEST-NET-1 (darwin CI; see expectations.txt)
    // and connect() failed synchronously — the sync-fail fixture covers that.
    console.log("SKIP_SYNC_FAIL: connect to TEST-NET-1 resolved synchronously on this host");
    console.log("OK");
    process.exit(0);
  }
  console.log("connecting at destroy:", sock.connecting);
  destroyed = true;
  sock.destroy();
});

// Wait past the per-attempt timeout to catch the stale timer firing.
setTimeout(() => {
  console.log("OK");
  process.exit(0);
}, 300);
