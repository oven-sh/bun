//#FILE: test-https-byteswritten.js
//#SHA1: 8b808da3e55de553190426095aee298ec7d5df36
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

const options = {
  key: fixtures.readKey("agent1-key.pem"),
  cert: fixtures.readKey("agent1-cert.pem"),
};

const body = "hello world\n";

test("HTTPS server bytesWritten", async () => {
  const httpsServer = https.createServer(options, (req, res) => {
    res.on("finish", () => {
      expect(typeof req.connection.bytesWritten).toBe("number");
      expect(req.connection.bytesWritten).toBeGreaterThan(0);
      httpsServer.close();
    });
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end(body);
  });

  await new Promise(resolve => {
    httpsServer.listen(0, () => {
      https.get({
        port: httpsServer.address().port,
        rejectUnauthorized: false,
      });
      resolve();
    });
  });
});

//<#END_FILE: test-https-byteswritten.js
