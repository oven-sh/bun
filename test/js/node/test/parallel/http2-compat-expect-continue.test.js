//#FILE: test-http2-compat-expect-continue.js
//#SHA1: 3c95de1bb9a0bf620945ec5fc39ba3a515dfe5fd
//-----------------
'use strict';

const http2 = require('http2');

// Skip the test if crypto is not available
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
  describe('HTTP/2 100-continue flow', () => {
    test('full 100-continue flow with response', (done) => {
      const testResBody = 'other stuff!\n';
      const server = http2.createServer();
      let sentResponse = false;

      server.on('request', (req, res) => {
        res.end(testResBody);
        sentResponse = true;
      });

      server.listen(0, () => {
        let body = '';
        const client = http2.connect(`http://localhost:${server.address().port}`);
        const req = client.request({
          ':method': 'POST',
          'expect': '100-continue'
        });

        let gotContinue = false;
        req.on('continue', () => {
          gotContinue = true;
        });

        req.on('response', (headers) => {
          expect(gotContinue).toBe(true);
          expect(sentResponse).toBe(true);
          expect(headers[':status']).toBe(200);
          req.end();
        });

        req.setEncoding('utf8');
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          expect(body).toBe(testResBody);
          client.close();
          server.close(done);
        });
      });
    });

    test('100-continue flow with immediate response', (done) => {
      const server = http2.createServer();

      server.on('request', (req, res) => {
        res.end();
      });

      server.listen(0, () => {
        const client = http2.connect(`http://localhost:${server.address().port}`);
        const req = client.request({
          ':path': '/',
          'expect': '100-continue'
        });

        let gotContinue = false;
        req.on('continue', () => {
          gotContinue = true;
        });

        let gotResponse = false;
        req.on('response', () => {
          gotResponse = true;
        });

        req.setEncoding('utf8');
        req.on('end', () => {
          expect(gotContinue).toBe(true);
          expect(gotResponse).toBe(true);
          client.close();
          server.close(done);
        });
      });
    });
  });
}

//<#END_FILE: test-http2-compat-expect-continue.js
