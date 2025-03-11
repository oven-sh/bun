import { createServer } from "node:http";
import { isIPv6 } from "node:net";

const server = createServer((req, res) => {
  throw new Error("Oops!");
});

server.listen({ port: 0 }, async err => {
  const { port, address: host } = server.address();
  if (err) {
    console.error(err);
    process.exit(1);
  }
  const hostname = isIPv6(host) ? `[${host}]` : host;

  (process?.connected ? process.send : console.log)(`http://${hostname}:${port}/`);
});
