var net = require("net");

// The test runner doesn't kill a concurrent test's children when it times out,
// so exit here if the process hangs. The unref'd timer doesn't keep the loop alive.
setTimeout(() => {
  console.error("still running after 10s");
  process.exit(2);
}, 10_000).unref();

var client = new net.Socket();
client.connect(process.env.PORT, "localhost", function () {
  client.write("Hello, server");
});
