//#FILE: test-http-agent-no-protocol.js
//#SHA1: f1b40623163271a500c87971bf996466e006130e
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
const url = require("url");

test("http agent with no protocol", async () => {
  const serverCallback = jest.fn((req, res) => {
    res.end();
  });

  const server = http.createServer(serverCallback);

  await new Promise(resolve => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const opts = url.parse(`http://127.0.0.1:${server.address().port}/`);

  // Remove the `protocol` field… the `http` module should fall back
  // to "http:", as defined by the global, default `http.Agent` instance.
  opts.agent = new http.Agent();
  opts.agent.protocol = null;

  const responseCallback = jest.fn(res => {
    res.resume();
    server.close();
  });

  await new Promise(resolve => {
    http.get(opts, res => {
      responseCallback(res);
      resolve();
    });
  });

  expect(serverCallback).toHaveBeenCalledTimes(1);
  expect(responseCallback).toHaveBeenCalledTimes(1);
});

//<#END_FILE: test-http-agent-no-protocol.js
