//#FILE: test-tls-transport-destroy-after-own-gc.js
//#SHA1: e2ef35ad88444196d24664e93fb9efdad050c876
//-----------------
// Flags: --expose-gc
"use strict";

// Regression test for https://github.com/nodejs/node/issues/17475
// Unfortunately, this tests only "works" reliably when checked with valgrind or
// a similar tool.

const { TLSSocket } = require("tls");
const makeDuplexPair = require("../common/duplexpair");

test("TLSSocket destruction after garbage collection", done => {
  if (!process.versions.openssl) {
    done();
    return;
  }

  let { clientSide } = makeDuplexPair();

  let clientTLS = new TLSSocket(clientSide, { isServer: false });
  let clientTLSHandle = clientTLS._handle; // eslint-disable-line no-unused-vars

  setImmediate(() => {
    clientTLS = null;
    global.gc();
    clientTLSHandle = null;
    global.gc();
    setImmediate(() => {
      clientSide = null;
      global.gc();
      // If we've reached this point without crashing, the test has passed
      done();
    });
  });
});

//<#END_FILE: test-tls-transport-destroy-after-own-gc.js
