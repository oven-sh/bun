import http from "node:http";
import assert from "node:assert";
import { once } from "node:events";
import { connect } from "node:net";

const { promise: uncaughtExceptionPromise, resolve, reject } = Promise.withResolvers();

process.once("uncaughtException", err => {
  resolve(err);
});

await using server = http.createServer(reject);

server.on("clientError", () => {
  throw new Error("thrown from clientError");
});

server.listen(0);
await once(server, "listening");

const port = server.address().port;
const client = connect(port, undefined, () => {
  // HTTP request with invalid Content-Length
  // The Content-Length says 10 but the actual body is 20 bytes
  // Send the request
  client.write(
    `POST /test HTTP/1.1\r\nHost: localhost:${port}\r\nContent-Type: text/plain\r\nContent-Length: invalid\r\n\r\n`,
  );
});

const err = await uncaughtExceptionPromise;
assert.strictEqual(err.message, "thrown from clientError");
