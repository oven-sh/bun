//#FILE: test-tls-fast-writing.js
//#SHA1: 3a9ce4612ccf460fb5c0dfd4be6f8f5cad06c4a4
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
const tls = require("tls");

const options = {
  key: fixtures.readKey("rsa_private.pem"),
  cert: fixtures.readKey("rsa_cert.crt"),
  ca: [fixtures.readKey("rsa_ca.crt")],
};

let gotChunk = false;
let gotDrain = false;

function onconnection(conn) {
  conn.on("data", function (c) {
    if (!gotChunk) {
      gotChunk = true;
      console.log("ok - got chunk");
    }

    // Just some basic sanity checks.
    expect(c.length).toBeGreaterThan(0);
    expect(Buffer.isBuffer(c)).toBe(true);

    if (gotDrain) {
      process.exit(0);
    }
  });
}

test("TLS fast writing", done => {
  if (!process.versions.openssl) {
    console.log("1..0 # Skipped: missing crypto");
    return done();
  }

  const server = tls.createServer(options, onconnection);

  server.listen(0, function () {
    const chunk = Buffer.alloc(1024, "x");
    const opt = { port: this.address().port, rejectUnauthorized: false };
    const conn = tls.connect(opt, function () {
      conn.on("drain", ondrain);
      write();
    });

    function ondrain() {
      if (!gotDrain) {
        gotDrain = true;
        console.log("ok - got drain");
      }
      if (gotChunk) {
        process.exit(0);
      }
      write();
    }

    function write() {
      // This needs to return false eventually
      while (false !== conn.write(chunk));
    }
  });

  // Clean up
  process.on("exit", () => {
    server.close();
    expect(gotChunk).toBe(true);
    expect(gotDrain).toBe(true);
    done();
  });
});

//<#END_FILE: test-tls-fast-writing.js
