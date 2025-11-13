import { createTest } from "node-harness";
import { once } from "node:events";
import http from "node:http";
import { connect } from "node:net";
const { expect } = createTest(import.meta.path);

const { promise, resolve, reject } = Promise.withResolvers();
await using server = http.createServer(reject);

server.on("clientError", (err, socket) => {
  resolve(err);
  socket.destroy();
});

server.listen(0);
await once(server, "listening");

const client = connect(server.address().port, () => {
  // HTTP request with invalid Content-Length
  // The Content-Length says 10 but the actual body is 20 bytes
  // Send the request
  client.write(
    `POST /test HTTP/1.1\r\nHost: localhost:${server.address().port}\r\nContent-Type: text/plain\r\nContent-Length: invalid\r\n\r\n`,
  );
});

const err = (await promise) as Error;
expect(err.code).toBe("HPE_UNEXPECTED_CONTENT_LENGTH");
