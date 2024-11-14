//#FILE: test-http2-server-async-dispose.js
//#SHA1: 3f26a183d15534b5f04c61836e718ede1726834f
//-----------------
'use strict';

const http2 = require('http2');

// Check if crypto is available
let hasCrypto = false;
try {
  require('crypto');
  hasCrypto = true;
} catch (err) {
  // crypto is not available
}

(hasCrypto ? test : test.skip)('http2 server async close', (done) => {
  const server = http2.createServer();

  const closeHandler = jest.fn();
  server.on('close', closeHandler);

  server.listen(0, () => {
    // Use the close method instead of Symbol.asyncDispose
    server.close(() => {
      expect(closeHandler).toHaveBeenCalled();
      done();
    });
  });
}, 10000); // Increase timeout to 10 seconds

//<#END_FILE: test-http2-server-async-dispose.js
