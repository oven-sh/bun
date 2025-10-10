import { createTest } from "node-harness";
import { once } from "node:events";
import { createServer } from "node:http";
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

  inputStream.pipe(zlib.createBrotliCompress()).pipe(res);
});
server.listen(0);
await once(server, "listening");
const url = new URL(`http://127.0.0.1:${server.address().port}`);

const res = await fetch(new URL("/hello", url));
expect(await res.text()).toBe("Hello World");
