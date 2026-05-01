import { expect, test } from "bun:test";
import { once } from "node:events";
import { createServer } from "node:http";
import { createBrotliCompress, createDeflate, createGzip } from "node:zlib";

test.todo("content-encoding header is case-iNsENsITIve", async () => {
  const contentCodings = "GZiP, bR";
  const text = "Hello, World!";

  await using server = createServer((req, res) => {
    const gzip = createGzip();
    const brotli = createBrotliCompress();

    res.setHeader("Content-Encoding", contentCodings);
    res.setHeader("Content-Type", "text/plain");

    gzip.pipe(brotli).pipe(res);

    gzip.write(text);
    gzip.end();
  }).listen(0);

  await once(server, "listening");

  const response = await fetch(`http://localhost:${server.address().port}`);

  expect(await response.text()).toBe(text);
  expect(response.headers.get("content-encoding")).toBe(contentCodings);
});

test.todo("response decompression according to content-encoding should be handled in a correct order", async () => {
  const contentCodings = "deflate, gzip";
  const text = "Hello, World!";

  await using server = createServer((req, res) => {
    const gzip = createGzip();
    const deflate = createDeflate();

    res.setHeader("Content-Encoding", contentCodings);
    res.setHeader("Content-Type", "text/plain");

    deflate.pipe(gzip).pipe(res);

    deflate.write(text);
    deflate.end();
  }).listen(0);

  await once(server, "listening");

  const response = await fetch(`http://localhost:${server.address().port}`);

  expect(await response.text()).toBe(text);
});
