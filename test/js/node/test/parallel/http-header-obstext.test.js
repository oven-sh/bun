//#FILE: test-http-header-obstext.js
//#SHA1: 031a5230bc91c831407772f2b8cbeba3559ed1d2
//-----------------
"use strict";

// This test ensures that the http-parser can handle UTF-8 characters
// in the http header.

const http = require("http");

test("http-parser can handle UTF-8 characters in http header", async () => {
  const server = http.createServer((req, res) => {
    res.end("ok");
  });

  await new Promise(resolve => server.listen(0, resolve));

  const { port } = server.address();

  const response = await new Promise(resolve => {
    http.get(
      {
        port,
        headers: { Test: "Düsseldorf" },
      },
      resolve,
    );
  });

  expect(response.statusCode).toBe(200);

  await new Promise(resolve => server.close(resolve));
});

//<#END_FILE: test-http-header-obstext.js
