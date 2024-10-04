//#FILE: test-http-url.parse-https.request.js
//#SHA1: e9b9e39f28d5d2633f9444150977b748bc8995cb
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
const url = require("url");
const { readKey } = require("../common/fixtures");

let common;
try {
  common = require("../common");
} catch (e) {
  // For Bun compatibility
  common = {
    hasCrypto: true,
    skip: console.log,
  };
}

if (!common.hasCrypto) {
  common.skip("missing crypto");
  process.exit(0);
}

// https options
const httpsOptions = {
  key: readKey("agent1-key.pem"),
  cert: readKey("agent1-cert.pem"),
};

function check(request) {
  // Assert that I'm https
  expect(request.socket._secureEstablished).toBeTruthy();
}

test("HTTPS request with URL object", done => {
  const server = https.createServer(httpsOptions, function (request, response) {
    // Run the check function
    check(request);
    response.writeHead(200, {});
    response.end("ok");
    server.close();
  });

  server.listen(0, function () {
    const testURL = url.parse(`https://localhost:${this.address().port}`);
    testURL.rejectUnauthorized = false;

    // make the request
    const clientRequest = https.request(testURL);
    // Since there is a little magic with the agent
    // make sure that the request uses the https.Agent
    expect(clientRequest.agent).toBeInstanceOf(https.Agent);
    clientRequest.end();
    done();
  });
});

//<#END_FILE: test-http-url.parse-https.request.js
