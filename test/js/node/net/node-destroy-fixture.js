const net = require("node:net");
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
