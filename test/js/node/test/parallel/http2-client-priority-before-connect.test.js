//#FILE: test-http2-client-priority-before-connect.js
//#SHA1: bc94924856dc82c18ccf699d467d63c28fed0d13
//-----------------
'use strict';

const h2 = require('http2');

let server;
let port;

beforeAll(async () => {
  // Check if crypto is available
  try {
    require('crypto');
  } catch (err) {
    return test.skip('missing crypto');
  }
});

afterAll(() => {
  if (server) {
    server.close();
  }
});

test('HTTP2 client priority before connect', (done) => {
  server = h2.createServer();

  // We use the lower-level API here
  server.on('stream', (stream) => {
    stream.respond();
    stream.end('ok');
  });

  server.listen(0, () => {
    port = server.address().port;
    const client = h2.connect(`http://localhost:${port}`);
    const req = client.request();
    req.priority({});

    req.on('response', () => {
      // Response received
    });

    req.resume();

    req.on('end', () => {
      // Request ended
    });

    req.on('close', () => {
      client.close();
      done();
    });
  });
});

//<#END_FILE: test-http2-client-priority-before-connect.js
