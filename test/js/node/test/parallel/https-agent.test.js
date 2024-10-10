//#FILE: test-https-agent.js
//#SHA1: 1348abc863ae99725dd893838c95b42c5120a052
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

const https = require("https");
const { readKey } = require("../common/fixtures");

const options = {
  key: readKey("agent1-key.pem"),
  cert: readKey("agent1-cert.pem"),
};

const N = 4;
const M = 4;

let server;
let responses = 0;

beforeAll(() => {
  if (!process.versions.openssl) {
    return test.skip("missing crypto");
  }
});

beforeEach(() => {
  return new Promise(resolve => {
    server = https.createServer(options, (req, res) => {
      res.writeHead(200);
      res.end("hello world\n");
    });

    server.listen(0, () => {
      resolve();
    });
  });
});

afterEach(() => {
  return new Promise(resolve => {
    server.close(() => {
      resolve();
    });
  });
});

test("HTTPS Agent handles multiple concurrent requests", async () => {
  const makeRequests = i => {
    return new Promise(resolve => {
      setTimeout(() => {
        const requests = Array.from(
          { length: M },
          () =>
            new Promise(innerResolve => {
              https
                .get(
                  {
                    path: "/",
                    port: server.address().port,
                    rejectUnauthorized: false,
                  },
                  function (res) {
                    res.resume();
                    expect(res.statusCode).toBe(200);
                    responses++;
                    innerResolve();
                  },
                )
                .on("error", e => {
                  throw e;
                });
            }),
        );
        Promise.all(requests).then(resolve);
      }, i);
    });
  };

  const allRequests = Array.from({ length: N }, (_, i) => makeRequests(i));
  await Promise.all(allRequests);

  expect(responses).toBe(N * M);
});

//<#END_FILE: test-https-agent.js
