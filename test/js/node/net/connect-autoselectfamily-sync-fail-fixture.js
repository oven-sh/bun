const net = require("node:net");

process.on("uncaughtException", e => {
  console.error("UNCAUGHT:", e.message);
  process.exit(1);
});

// Two addresses force the multi-attempt path; TCP to a multicast group is
// rejected synchronously by the kernel regardless of routing, which drives
// the connectError-inside-kConnectTcp recursion this fixture covers.
const sock = net.connect({
  host: "test.invalid",
  port: 443,
  autoSelectFamily: true,
  autoSelectFamilyAttemptTimeout: 50,
  lookup(host, opts, cb) {
    process.nextTick(cb, null, [
      { address: "224.0.0.1", family: 4 },
      { address: "224.0.0.2", family: 4 },
    ]);
  },
});
let sawConnectError = false;
sock.on("error", e => {
  // Expected: AggregateError of the per-address synchronous failures.
  sawConnectError = true;
  console.log("error", e.code || e.constructor.name);
});

// Wait past the per-attempt timeout so a stale timer (the bug) fires as an
// uncaughtException instead of being skipped by an early exit.
setTimeout(() => {
  if (!sawConnectError) {
    // No 'error' means the failing attempts never ran; the run proved nothing.
    console.error("MISSING_EXPECTED_CONNECT_ERROR");
    process.exit(1);
  }
  if (!sock.destroyed) sock.destroy();
  console.log("OK");
  process.exit(0);
}, 300);
