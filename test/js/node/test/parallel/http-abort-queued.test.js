//#FILE: test-http-abort-queued.js
//#SHA1: e0fcd4a5eb0466a1e218147e8eb53714311a6f42
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

let complete;

test("http abort queued request", async () => {
  const server = http.createServer((req, res) => {
    // We should not see the queued /thatotherone request within the server
    // as it should be aborted before it is sent.
    expect(req.url).toBe("/");

    res.writeHead(200);
    res.write("foo");

    complete =
      complete ||
      function () {
        res.end();
      };
  });

  await new Promise(resolve => server.listen(0, resolve));

  const agent = new http.Agent({ maxSockets: 1 });
  expect(Object.keys(agent.sockets)).toHaveLength(0);

  const options = {
    hostname: "localhost",
    port: server.address().port,
    method: "GET",
    path: "/",
    agent: agent,
  };

  const req1 = http.request(options);
  req1.on("response", res1 => {
    expect(Object.keys(agent.sockets)).toHaveLength(1);
    expect(Object.keys(agent.requests)).toHaveLength(0);

    const req2 = http.request({
      method: "GET",
      host: "localhost",
      port: server.address().port,
      path: "/thatotherone",
      agent: agent,
    });
    expect(Object.keys(agent.sockets)).toHaveLength(1);
    expect(Object.keys(agent.requests)).toHaveLength(1);

    // TODO(jasnell): This event does not appear to currently be triggered.
    // is this handler actually required?
    req2.on("error", err => {
      // This is expected in response to our explicit abort call
      expect(err.code).toBe("ECONNRESET");
    });

    req2.end();
    req2.abort();

    expect(Object.keys(agent.sockets)).toHaveLength(1);
    expect(Object.keys(agent.requests)).toHaveLength(1);

    res1.on("data", chunk => complete());

    res1.on("end", () => {
      setTimeout(() => {
        expect(Object.keys(agent.sockets)).toHaveLength(0);
        expect(Object.keys(agent.requests)).toHaveLength(0);

        server.close();
      }, 100);
    });
  });

  req1.end();
});

//<#END_FILE: test-http-abort-queued.js
