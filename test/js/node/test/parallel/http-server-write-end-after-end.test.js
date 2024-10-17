//#FILE: test-http-server-write-end-after-end.js
//#SHA1: 5b7550b3241cd6b99e607419c3b81d2df519b641
//-----------------
"use strict";

const http = require("http");

let server;

beforeAll(() => {});

afterAll(() => {});

function handle(req, res) {
  res.on("error", jest.fn());

  res.write("hello");
  res.end();

  setImmediate(() => {
    res.end("world");
    process.nextTick(() => {
      server.close();
    });
    res.write("world", err => {
      expect(err).toMatchObject({
        code: "ERR_STREAM_WRITE_AFTER_END",
        name: "Error",
        message: expect.any(String),
      });
      server.close();
    });
  });
}

test("http server write end after end", async () => {
  server = http.createServer(handle);
  const { promise, resolve, reject } = Promise.withResolvers();
  server.listen(0, () => {
    http
      .get(`http://localhost:${server.address().port}`)
      .once("close", () => {
        resolve();
      })
      .once("error", reject);
  });
  await promise;
});

//<#END_FILE: test-http-server-write-end-after-end.js
