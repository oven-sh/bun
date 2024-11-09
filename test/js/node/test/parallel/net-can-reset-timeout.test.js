//#FILE: test-net-can-reset-timeout.js
//#SHA1: 871319149db929419e14ba7f08e5d0c878222a93
//-----------------
'use strict';

const net = require('net');

describe('Net can reset timeout', () => {
  let server;
  let port;

  beforeAll((done) => {
    server = net.createServer((stream) => {
      stream.setTimeout(100);

      stream.resume();

      stream.once('timeout', () => {
        console.log('timeout');
        // Try to reset the timeout.
        stream.write('WHAT.');
      });

      stream.on('end', () => {
        console.log('server side end');
        stream.end();
      });
    });

    server.listen(0, () => {
      port = server.address().port;
      done();
    });
  });

  afterAll(() => {
    server.close();
  });

  test('should handle timeout and reset', (done) => {
    const c = net.createConnection(port, "127.0.0.1");

    c.on('data', () => {
      c.end();
    });

    c.on('end', () => {
      console.log('client side end');
      done();
    });
  });
});

//<#END_FILE: test-net-can-reset-timeout.js
