const net = require("node:net");

// The test looks for a hang. The test runner does not kill the children of a
// concurrent test that timed out, so this process ends itself. An unref'd
// timer does not hold the loop open.
setTimeout(() => {
  console.error("still running after 10s");
  process.exit(2);
}, 10_000).unref();

const { promise, resolve } = Promise.withResolvers();
const client = net.createConnection(process.env.PORT, "localhost");
client.on("connect", () => {
  client.destroy();
  resolve(0);
});

client.on("error", err => {
  console.error("error", err);
  resolve(1);
});

await promise;
