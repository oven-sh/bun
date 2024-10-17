//#FILE: test-http2-client-shutdown-before-connect.js
//#SHA1: 75a343e9d8b577911242f867708310346fe9ddce
//-----------------
'use strict';

const h2 = require('http2');

// Skip test if crypto is not available
const hasCrypto = (() => {
  try {
    require('crypto');
    return true;
  } catch (err) {
    return false;
  }
})();

if (!hasCrypto) {
  test.skip('missing crypto', () => {});
} else {
  test('HTTP/2 client shutdown before connect', (done) => {
    const server = h2.createServer();

    // We use the lower-level API here
    server.on('stream', () => {
      throw new Error('Stream should not be created');
    });

    server.listen(0, () => {
      const client = h2.connect(`http://localhost:${server.address().port}`);
      client.close(() => {
        server.close(() => {
          done();
        });
      });
    });
  });
}

//<#END_FILE: test-http2-client-shutdown-before-connect.js
