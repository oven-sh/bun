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

'use strict';
const common = require('../common');
const http = require('http');

// This test is to make sure that when the HTTP server
// responds to a HEAD request with data to res.end,
// it does not send any body.

<<<<<<< HEAD:test/js/node/test/parallel/http-client-timeout-event.test.js
test("http client timeout event", async () => {
  const server = http.createServer();

  await new Promise(resolve => {
    server.listen(0, options.host, () => {
      options.port = server.address().port;
      const req = http.request(options);

      req.on("error", () => {
        // This space is intentionally left blank
      });

      req.on("close", () => {
        expect(req.destroyed).toBe(true);
        server.close(resolve);
      });

      req.setTimeout(1);
      req.on("timeout", () => {
        req.end(() => {
          setTimeout(() => {
            req.destroy();
          }, 100);
        });
      });
    });
  });
||||||| a2e2d114e:test/js/node/test/parallel/http-client-timeout-event.test.js
test("http client timeout event", async () => {
  const server = http.createServer();

  await new Promise(resolve => {
    server.listen(0, options.host, () => {
      options.port = server.address().port;
      const req = http.request(options);

      req.on("error", () => {
        // This space is intentionally left blank
      });

      req.on("close", () => {
        expect(req.destroyed).toBe(true);
        server.close();
        resolve();
      });

      req.setTimeout(1);
      req.on("timeout", () => {
        req.end(() => {
          setTimeout(() => {
            req.destroy();
          }, 100);
        });
      });
    });
  });
=======
const server = http.createServer(function(req, res) {
  res.writeHead(200);
  res.end('FAIL'); // broken: sends FAIL from hot path.
>>>>>>> main:test/js/node/test/parallel/test-http-head-response-has-no-body-end.js
});
server.listen(0);

server.on('listening', common.mustCall(function() {
  const req = http.request({
    port: this.address().port,
    method: 'HEAD',
    path: '/'
  }, common.mustCall(function(res) {
    res.on('end', common.mustCall(function() {
      server.close();
    }));
    res.resume();
  }));
  req.end();
}));
