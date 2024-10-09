//#FILE: test-tls-inception.js
//#SHA1: 410893674973cae3603656c032a18e01a1cd759a
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

const crypto = require("crypto");
const fixtures = require("../common/fixtures");
const tls = require("tls");
const net = require("net");

if (!crypto.getCurves().includes("prime256v1")) {
  test.skip("missing crypto support");
}

const options = {
  key: fixtures.readKey("rsa_private.pem"),
  cert: fixtures.readKey("rsa_cert.crt"),
};

const body = "A".repeat(40000);

test("TLS inception", async () => {
  // the "proxy" server
  const a = tls.createServer(options, socket => {
    const myOptions = {
      host: "127.0.0.1",
      port: b.address().port,
      rejectUnauthorized: false,
    };
    const dest = net.connect(myOptions);
    dest.pipe(socket);
    socket.pipe(dest);

    dest.on("end", () => {
      socket.destroy();
    });
  });

  // the "target" server
  const b = tls.createServer(options, socket => {
    socket.end(body);
  });

  await new Promise(resolve => {
    a.listen(0, () => {
      b.listen(0, resolve);
    });
  });

  const myOptions = {
    host: "127.0.0.1",
    port: a.address().port,
    rejectUnauthorized: false,
  };

  return new Promise(resolve => {
    const socket = tls.connect(myOptions);
    const ssl = tls.connect({
      socket: socket,
      rejectUnauthorized: false,
    });
    ssl.setEncoding("utf8");
    let buf = "";
    ssl.on("data", data => {
      buf += data;
    });
    ssl.on("end", () => {
      expect(buf).toBe(body);
      ssl.end();
      a.close();
      b.close();
      resolve();
    });
  });
});

//<#END_FILE: test-tls-inception.js
