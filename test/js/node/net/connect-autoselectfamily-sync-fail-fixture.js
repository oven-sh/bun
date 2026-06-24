const net = require("node:net");

process.on("uncaughtException", e => {
  console.error("UNCAUGHT:", e.message);
  process.exit(1);
});

// Two addresses force the autoSelectFamily multi-attempt path. 240.0.0.0/4
// (Class E) is rejected synchronously by the macOS kernel, which is what
// triggers the connectError-inside-kConnectTcp recursion this test covers;
// the test wrapper gates this fixture to macOS for that reason.
const sock = net.connect({
  host: "test.invalid",
  port: 443,
  autoSelectFamily: true,
  autoSelectFamilyAttemptTimeout: 50,
  lookup(host, opts, cb) {
    process.nextTick(cb, null, [
      { address: "240.0.0.1", family: 4 },
      { address: "240.0.0.2", family: 4 },
    ]);
  },
});
sock.on("error", e => {
  // Expected: AggregateError of per-address failures.
  console.log("error", e.code || e.constructor.name);
});

// Wait past the per-attempt timeout to catch any stale timer firing as an
// uncaughtException. Not gated on 'close' so the fixture is bounded even if
// the kernel ever stops rejecting Class E synchronously.
setTimeout(() => {
  if (!sock.destroyed) sock.destroy();
  console.log("OK");
  process.exit(0);
}, 300);
