//#FILE: test-http2-compat-expect-continue-check.js
//#SHA1: cfaba2929ccb61aa085572010d7730ceef07859e
//-----------------
'use strict';

const http2 = require('http2');

const testResBody = 'other stuff!\n';

describe('HTTP/2 100-continue flow', () => {
  let server;

  beforeAll(() => {
    if (!process.versions.openssl) {
      return test.skip('missing crypto');
    }
  });

  afterEach(() => {
    if (server) {
      server.close();
    }
  });

  test('Full 100-continue flow', (done) => {
    server = http2.createServer();
    const fullRequestHandler = jest.fn();
    server.on('request', fullRequestHandler);

    server.on('checkContinue', (req, res) => {
      res.writeContinue();
      res.writeHead(200, {});
      res.end(testResBody);
      
      expect(res.writeContinue()).toBe(false);
      
      res.on('finish', () => {
        process.nextTick(() => {
          expect(res.writeContinue()).toBe(false);
        });
      });
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
        expect(headers[':status']).toBe(200);
        req.end();
      });

      req.setEncoding('utf-8');
      req.on('data', (chunk) => { body += chunk; });

      req.on('end', () => {
        expect(body).toBe(testResBody);
        expect(fullRequestHandler).not.toHaveBeenCalled();
        client.close();
        done();
      });
    });
  });
});

//<#END_FILE: test-http2-compat-expect-continue-check.js
