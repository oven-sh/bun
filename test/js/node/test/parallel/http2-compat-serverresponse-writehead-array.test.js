//#FILE: test-http2-compat-serverresponse-writehead-array.js
//#SHA1: e43a5a9f99ddad68b313e15fbb69839cca6d0775
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
  describe('Http2ServerResponse.writeHead with arrays', () => {
    test('should support nested arrays', (done) => {
      const server = http2.createServer();
      server.listen(0, () => {
        const port = server.address().port;

        server.once('request', (request, response) => {
          const returnVal = response.writeHead(200, [
            ['foo', 'bar'],
            ['foo', 'baz'],
            ['ABC', 123],
          ]);
          expect(returnVal).toBe(response);
          response.end(() => { server.close(); });
        });

        const client = http2.connect(`http://localhost:${port}`, () => {
          const request = client.request();

          request.on('response', (headers) => {
            expect(headers.foo).toBe('bar, baz');
            expect(headers.abc).toBe('123');
            expect(headers[':status']).toBe(200);
          });
          request.on('end', () => {
            client.close();
            done();
          });
          request.end();
          request.resume();
        });
      });
    });

    test('should support flat arrays', (done) => {
      const server = http2.createServer();
      server.listen(0, () => {
        const port = server.address().port;

        server.once('request', (request, response) => {
          const returnVal = response.writeHead(200, ['foo', 'bar', 'foo', 'baz', 'ABC', 123]);
          expect(returnVal).toBe(response);
          response.end(() => { server.close(); });
        });

        const client = http2.connect(`http://localhost:${port}`, () => {
          const request = client.request();

          request.on('response', (headers) => {
            expect(headers.foo).toBe('bar, baz');
            expect(headers.abc).toBe('123');
            expect(headers[':status']).toBe(200);
          });
          request.on('end', () => {
            client.close();
            done();
          });
          request.end();
          request.resume();
        });
      });
    });

    test('should throw ERR_INVALID_ARG_VALUE for invalid array', (done) => {
      const server = http2.createServer();
      server.listen(0, () => {
        const port = server.address().port;

        server.once('request', (request, response) => {
          expect(() => {
            response.writeHead(200, ['foo', 'bar', 'ABC', 123, 'extra']);
          }).toThrow(expect.objectContaining({
            code: 'ERR_INVALID_ARG_VALUE'
          }));

          response.end(() => { server.close(); });
        });

        const client = http2.connect(`http://localhost:${port}`, () => {
          const request = client.request();

          request.on('end', () => {
            client.close();
            done();
          });
          request.end();
          request.resume();
        });
      });
    });
  });
}

//<#END_FILE: test-http2-compat-serverresponse-writehead-array.js
