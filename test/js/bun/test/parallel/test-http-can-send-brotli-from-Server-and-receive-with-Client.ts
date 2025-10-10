import { createTest } from "node-harness";
import { once } from "node:events";
import http, { createServer } from "node:http";
import * as stream from "node:stream";
import * as zlib from "node:zlib";
const { expect } = createTest(import.meta.path);

await using server = createServer((req, res) => {
  expect(req.url).toBe("/hello");
  res.setHeader("content-encoding", "br");
  res.writeHead(200);

  const inputStream = new stream.Readable();
  inputStream.push("Hello World");
  inputStream.push(null);

  const passthrough = new stream.PassThrough();
  passthrough.on("data", data => res.write(data));
  passthrough.on("end", () => res.end());

  inputStream.pipe(zlib.createBrotliCompress()).pipe(passthrough);
});

server.listen(0);
await once(server, "listening");
const url = new URL(`http://127.0.0.1:${server.address().port}`);

const { resolve, reject, promise } = Promise.withResolvers();
http.get(new URL("/hello", url), res => {
  let rawData = "";
  const passthrough = stream.PassThrough();
  passthrough.on("data", chunk => {
    rawData += chunk;
  });
  passthrough.on("end", () => {
    try {
      expect(Buffer.from(rawData)).toEqual(Buffer.from("Hello World"));
      resolve();
    } catch (e) {
      reject(e);
    }
  });
  res.pipe(zlib.createBrotliDecompress()).pipe(passthrough);
});
await promise;
