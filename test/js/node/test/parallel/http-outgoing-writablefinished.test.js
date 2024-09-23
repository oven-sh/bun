//#FILE: test-http-outgoing-writableFinished.js
//#SHA1: f3fbc0d89cd03168f3ee92ed586b62dd5e3b8edb
//-----------------
"use strict";

const http = require("http");

test("HTTP server response writableFinished", async () => {
  const server = http.createServer((req, res) => {
    expect(res.writableFinished).toBe(false);
    res.on("finish", () => {
      expect(res.writableFinished).toBe(true);
      server.close();
    });
    res.end();
  });

  await new Promise(resolve => {
    server.listen(0, resolve);
  });

  const port = server.address().port;

  const clientRequest = http.request({
    port,
    method: "GET",
    path: "/",
  });

  expect(clientRequest.writableFinished).toBe(false);

  await new Promise(resolve => {
    clientRequest.on("finish", () => {
      expect(clientRequest.writableFinished).toBe(true);
      resolve();
    });
    clientRequest.end();
    expect(clientRequest.writableFinished).toBe(false);
  });
});

//<#END_FILE: test-http-outgoing-writableFinished.js
