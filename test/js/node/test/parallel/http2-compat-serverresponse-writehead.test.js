//#FILE: test-http2-compat-serverresponse-writehead.js
//#SHA1: fa267d5108f95ba69583bc709a82185ee9d18e76
//-----------------
'use strict';

const h2 = require('http2');

// Http2ServerResponse.writeHead should override previous headers

test('Http2ServerResponse.writeHead overrides previous headers', (done) => {
  const server = h2.createServer();
  server.listen(0, () => {
    const port = server.address().port;
    server.once('request', (request, response) => {
      response.setHeader('foo-bar', 'def456');

      // Override
      const returnVal = response.writeHead(418, { 'foo-bar': 'abc123' });

      expect(returnVal).toBe(response);

      expect(() => { response.writeHead(300); }).toThrow(expect.objectContaining({
        code: 'ERR_HTTP2_HEADERS_SENT'
      }));

      response.on('finish', () => {
        server.close();
        process.nextTick(() => {
          // The stream is invalid at this point,
          // and this line verifies this does not throw.
          response.writeHead(300);
          done();
        });
      });
      response.end();
    });

    const url = `http://localhost:${port}`;
    const client = h2.connect(url, () => {
      const headers = {
        ':path': '/',
        ':method': 'GET',
        ':scheme': 'http',
        ':authority': `localhost:${port}`
      };
      const request = client.request(headers);
      request.on('response', (headers) => {
        expect(headers['foo-bar']).toBe('abc123');
        expect(headers[':status']).toBe(418);
      });
      request.on('end', () => {
        client.close();
      });
      request.end();
      request.resume();
    });
  });
});

// Skip the test if crypto is not available
if (!process.versions.openssl) {
  test.skip('missing crypto', () => {});
}

//<#END_FILE: test-http2-compat-serverresponse-writehead.js
