// Cancel path for happy-eyeballs connects: destroy() while the lookup and/or
// first attempt is still in flight must free the connecting-socket state
// without a stale per-attempt timer firing after the wrapper is gone.
const net = require("node:net");

process.on("uncaughtException", e => {
  console.error("UNCAUGHT:", e.message);
  process.exit(1);
});

function main() {
  const srv = net.createServer(c => c.destroy());
  srv.listen(0, "127.0.0.1", () => {
    const port = srv.address().port;
    const TOTAL = 200;
    let completed = 0;

    function oneCycle() {
      const s = net.connect({
        host: "localhost",
        port,
        autoSelectFamily: true,
        autoSelectFamilyAttemptTimeout: 10,
        // Two families so the attempt scheduler actually engages; nextTick
        // keeps the destroy() below ahead of the first attempt.
        lookup(host, opts, cb) {
          process.nextTick(cb, null, [
            { address: "::1", family: 6 },
            { address: "127.0.0.1", family: 4 },
          ]);
        },
      });
      s.on("error", () => {});
      s.on("close", () => {
        completed++;
        if (completed < TOTAL) {
          oneCycle();
        } else {
          // Outlive the largest per-attempt window; a stale timer surviving
          // destroy() would fire in here and trip the uncaughtException trap.
          setTimeout(() => {
            srv.close();
            console.log(`OK ${completed}`);
          }, 50);
        }
      });
      // Cancel immediately: lookup and/or the first attempt is still pending.
      s.destroy();
    }
    oneCycle();
  });
}

main();
