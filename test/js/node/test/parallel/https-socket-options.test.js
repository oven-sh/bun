//#FILE: test-https-socket-options.js
//#SHA1: 8f63b3c65f69e8b766b159d148e681984c134477
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

const fixtures = require("../common/fixtures");
const https = require("https");
const http = require("http");

const options = {
  key: fixtures.readKey("agent1-key.pem"),
  cert: fixtures.readKey("agent1-cert.pem"),
};

const body = "hello world\n";

test("HTTP server socket options", async () => {
  const server_http = http.createServer((req, res) => {
    console.log("got HTTP request");
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(body);
  });

  await new Promise(resolve => {
    server_http.listen(0, () => {
      const req = http.request(
        {
          port: server_http.address().port,
          rejectUnauthorized: false,
        },
        res => {
          server_http.close();
          res.resume();
          resolve();
        },
      );
      // These methods should exist on the request and get passed down to the socket
      expect(req.setNoDelay).toBeDefined();
      expect(req.setTimeout).toBeDefined();
      expect(req.setSocketKeepAlive).toBeDefined();
      req.setNoDelay(true);
      req.setTimeout(1000, () => {});
      req.setSocketKeepAlive(true, 1000);
      req.end();
    });
  });
});

test("HTTPS server socket options", async () => {
  const server_https = https.createServer(options, (req, res) => {
    console.log("got HTTPS request");
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(body);
  });

  await new Promise(resolve => {
    server_https.listen(0, () => {
      const req = https.request(
        {
          port: server_https.address().port,
          rejectUnauthorized: false,
        },
        res => {
          server_https.close();
          res.resume();
          resolve();
        },
      );
      // These methods should exist on the request and get passed down to the socket
      expect(req.setNoDelay).toBeDefined();
      expect(req.setTimeout).toBeDefined();
      expect(req.setSocketKeepAlive).toBeDefined();
      req.setNoDelay(true);
      req.setTimeout(1000, () => {});
      req.setSocketKeepAlive(true, 1000);
      req.end();
    });
  });
});

//<#END_FILE: test-https-socket-options.js
