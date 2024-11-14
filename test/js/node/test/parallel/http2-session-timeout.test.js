//#FILE: test-http2-session-timeout.js
//#SHA1: 8a03d5dc642f9d07faac7b4a44caa0e02b625339
//-----------------
'use strict';

const http2 = require('http2');
const { hrtime } = process;
const NS_PER_MS = 1_000_000n;

let requests = 0;

test('HTTP/2 session timeout', (done) => {
  const server = http2.createServer();
  server.timeout = 0n;

  server.on('request', (req, res) => res.end());
  server.on('timeout', () => {
    throw new Error(`Timeout after ${requests} request(s)`);
  });

  server.listen(0, () => {
    const port = server.address().port;
    const url = `http://localhost:${port}`;
    const client = http2.connect(url);
    let startTime = hrtime.bigint();

    function makeReq() {
      const request = client.request({
        ':path': '/foobar',
        ':method': 'GET',
        ':scheme': 'http',
        ':authority': `localhost:${port}`,
      });
      request.resume();
      request.end();

      requests += 1;

      request.on('end', () => {
        const diff = hrtime.bigint() - startTime;
        const milliseconds = diff / NS_PER_MS;
        if (server.timeout === 0n) {
          server.timeout = milliseconds * 2n;
          startTime = hrtime.bigint();
          makeReq();
        } else if (milliseconds < server.timeout * 2n) {
          makeReq();
        } else {
          server.close();
          client.close();
          expect(requests).toBeGreaterThan(1);
          done();
        }
      });
    }

    makeReq();
  });
});

//<#END_FILE: test-http2-session-timeout.js
