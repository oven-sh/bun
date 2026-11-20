var net = require("net");

// The test looks for a hang. The test runner does not kill the children of a
// concurrent test that timed out, so this process ends itself. An unref'd
// timer does not hold the loop open.
setTimeout(() => {
  console.error("still running after 10s");
  process.exit(2);
}, 10_000).unref();

var client = new net.Socket();
client.connect(process.env.PORT, "localhost", function () {
  client.write("Hello, server");
});
