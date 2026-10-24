// With no uncaughtException handler a throwing 'data' listener must crash the
// process (exit 1, the error on stderr), not call the socket's 'error' listener.
const net = require("node:net");

// Only the live connection holds the loop: a swallowed throw drains to a clean
// exit 0 instead of a hang on the listening server.
const srv = net.createServer(s => s.end("x")).unref();

srv.listen(0, "127.0.0.1", () => {
  const c = net.connect(srv.address().port, "127.0.0.1");
  c.on("error", e => {
    console.log("socket-error:" + e.message);
    process.exit(7);
  });
  c.on("data", () => {
    throw new Error("fatal-boom");
  });
});
