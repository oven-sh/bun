const net = require("node:net");

// The test runner doesn't kill a concurrent test's children when it times out,
// so exit here if the process hangs. The unref'd timer doesn't keep the loop alive.
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
