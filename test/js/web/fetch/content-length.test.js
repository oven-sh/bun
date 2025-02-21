const { createServer } = require("node:http");

// https://github.com/nodejs/undici/issues/1783
test("Content-Length is set when using a FormData body with fetch", async () => {
  const { resolve, promise } = Promise.withResolvers();
  const server = createServer((req, res) => {
    // TODO: check the length's value once the boundary has a fixed length
    expect("content-length" in req.headers).toBe(true); // request has content-length header
    expect(Number.isNaN(Number(req.headers["content-length"]))).toBe(false); // content-length is a number
    res.end();
  }).listen(0, "127.0.0.1", resolve);

  await promise;
  const { port, address } = server.address();

  const fd = new FormData();
  fd.set("file", new Blob(["hello world 👋"], { type: "text/plain" }), "readme.md");
  fd.set("string", "some string value");

  await fetch(`http://${address}:${port}`, {
    method: "POST",
    body: fd,
  });

  await new Promise(resolve => server.close(resolve));
});
