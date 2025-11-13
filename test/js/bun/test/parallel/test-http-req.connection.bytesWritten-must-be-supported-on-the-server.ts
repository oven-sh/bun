import { createTest } from "node-harness";
import { once } from "node:events";
import http, { Server } from "node:http";
import type { AddressInfo } from "node:net";
const { expect } = createTest(import.meta.path);

const { promise, resolve } = Promise.withResolvers();
await using httpServer = http.createServer(function (req, res) {
  res.on("finish", () => resolve(req.connection.bytesWritten));
  res.writeHead(200, { "Content-Type": "text/plain" });

  const chunk = "7".repeat(1024);
  const bchunk = Buffer.from(chunk);
  res.write(chunk);
  res.write(bchunk);

  expect(res.connection.bytesWritten).toBe(1024 * 2);
  res.end("bunbunbun");
});

await once(httpServer.listen(0), "listening");
const address = httpServer.address() as AddressInfo;
const req = http.get({ port: address.port });
await once(req, "response");
const bytesWritten = await promise;
expect(typeof bytesWritten).toBe("number");
expect(bytesWritten).toBe(1024 * 2 + 9);
req.destroy();
