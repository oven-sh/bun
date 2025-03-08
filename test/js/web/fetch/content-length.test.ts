import { expect, test } from "bun:test";
import { Blob } from "node:buffer";
import { once } from "node:events";
import { createServer } from "node:http";

// https://github.com/nodejs/undici/issues/1783
test("Content-Length is set when using a FormData body with fetch", async () => {
  await using server = createServer((req, res) => {
    // TODO: check the length's value once the boundary has a fixed length
    expect("content-length" in req.headers).toBeTrue(); // request has content-length header
    expect(Number.isNaN(Number(req.headers["content-length"]))).toBeFalse(); // content-length is a number
    res.end();
  }).listen(0);

  await once(server, "listening");

  const fd = new FormData();
  fd.set("file", new Blob(["hello world 👋"], { type: "text/plain" }), "readme.md");
  fd.set("string", "some string value");

  await fetch(`http://localhost:${server.address().port}`, {
    method: "POST",
    body: fd,
  });
});
