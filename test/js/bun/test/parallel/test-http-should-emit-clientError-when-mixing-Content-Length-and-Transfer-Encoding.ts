import { createTest } from "node-harness";
import { once } from "node:events";
import http from "node:http";
import { connect, type AddressInfo } from "node:net";
const { expect } = createTest(import.meta.path);

const { promise, resolve, reject } = Promise.withResolvers();
await using server = http.createServer(reject);

server.on("clientError", (err, socket) => {
  resolve(err);
  socket.destroy();
});

await once(server.listen(0), "listening");

const client = connect((server.address() as AddressInfo).port as any, () => {
  // HTTP request with invalid Content-Length
  // The Content-Length says 10 but the actual body is 20 bytes
  // Send the request
  client.write(
    `POST /test HTTP/1.1\r\nHost: localhost:${(server.address() as AddressInfo).port}\r\nContent-Type: text/plain\r\nContent-Length: 5\r\nTransfer-Encoding: chunked\r\n\r\nHello`,
  );
});

const err = (await promise) as NodeJS.ErrnoException;
expect(err.code).toBe("HPE_INVALID_TRANSFER_ENCODING");
