import { tls as COMMON_TLS_CERT } from "harness";
import { createTest } from "node-harness";
import { once } from "node:events";
import { Server } from "node:http";
import https, { createServer as createHttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
const { expect } = createTest(import.meta.path);

const { promise, resolve } = Promise.withResolvers();
await using httpServer = createHttpsServer(COMMON_TLS_CERT, function (req, res) {
  res.on("finish", () => resolve(req.connection.bytesWritten));
  res.writeHead(200, { "Content-Type": "text/plain" });

  // Write 1.5mb to cause some requests to buffer
  // Also, mix up the encodings a bit.
  const chunk = "7".repeat(1024);
  const bchunk = Buffer.from(chunk);
  res.write(chunk);
  res.write(bchunk);
  // Get .bytesWritten while buffer is not empty
  expect(res.connection.bytesWritten).toBe(1024 * 2);

  res.end("bunbunbun");
});

await once(httpServer.listen(0), "listening");
const address = httpServer.address() as AddressInfo;
const req = https.get({ port: address.port, rejectUnauthorized: false });
await once(req, "response");
const bytesWritten = await promise;
expect(typeof bytesWritten).toBe("number");
expect(bytesWritten).toBe(1024 * 2 + 9);
req.destroy();
