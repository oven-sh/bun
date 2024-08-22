//#FILE: test-http-bind-twice.js
//#SHA1: 71319f0a5445d1ea7644e952ec4048d8996be1bc
//-----------------
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

"use strict";
const http = require("http");

test("HTTP server bind twice", async () => {
  const server1 = http.createServer(jest.fn());
  const server1ListenPromise = new Promise(resolve => {
    server1.listen(0, "127.0.0.1", resolve);
  });

  await server1ListenPromise;

  const server2 = http.createServer(jest.fn());
  const server2ErrorPromise = new Promise(resolve => {
    server2.on("error", resolve);
  });

  server2.listen(server1.address().port, "127.0.0.1");

  const error = await server2ErrorPromise;

  expect(error).toEqual(
    expect.objectContaining({
      code: "EADDRINUSE",
      message: expect.any(String),
    }),
  );

  await new Promise(resolve => server1.close(resolve));
});

//<#END_FILE: test-http-bind-twice.js
