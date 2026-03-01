import { tls } from "harness";
import https from "node:https";

using server = Bun.serve({
  port: 0,
  tls,
  fetch() {
    return new Response("OK");
  },
});

const { promise, resolve, reject } = Promise.withResolvers();
const client = https.request(`https://localhost:${server.port}/`, {
  agent: false,
  ca: tls.cert,
  rejectUnauthorized: true,
});
client.on("error", reject);
client.on("close", resolve);
client.end();
await promise;
