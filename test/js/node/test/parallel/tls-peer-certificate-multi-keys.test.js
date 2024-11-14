//#FILE: test-tls-peer-certificate-multi-keys.js
//#SHA1: d30d685d74ebea73274e19cea1a19a2b8cea5120
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

const tls = require("tls");
const fixtures = require("../common/fixtures");

const options = {
  key: fixtures.readKey("rsa_private.pem"),
  cert: fixtures.readKey("rsa_cert.crt"),
};

let server;

beforeAll(() => {
  if (!process.versions.openssl) {
    return test.skip("missing crypto");
  }
});

afterAll(() => {
  if (server) {
    server.close();
  }
});

test("TLS peer certificate with multiple keys", async () => {
  server = tls.createServer(options, cleartext => {
    cleartext.end("World");
  });

  const serverSecureConnectionPromise = new Promise(resolve => {
    server.once("secureConnection", socket => {
      const cert = socket.getCertificate();
      // The server's local cert is the client's peer cert.
      expect(cert.subject.OU).toEqual(["Test TLS Certificate", "Engineering"]);
      resolve();
    });
  });

  await new Promise(resolve => {
    server.listen(0, resolve);
  });

  const clientConnectionPromise = new Promise((resolve, reject) => {
    const socket = tls.connect(
      {
        port: server.address().port,
        rejectUnauthorized: false,
      },
      () => {
        const peerCert = socket.getPeerCertificate();
        expect(peerCert.subject.OU).toEqual(["Test TLS Certificate", "Engineering"]);
        socket.end("Hello");
        resolve();
      },
    );

    socket.on("error", reject);
  });

  await Promise.all([serverSecureConnectionPromise, clientConnectionPromise]);
});

//<#END_FILE: test-tls-peer-certificate-multi-keys.js
