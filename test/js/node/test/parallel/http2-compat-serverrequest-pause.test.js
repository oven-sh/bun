//#FILE: test-http2-compat-serverrequest-pause.js
//#SHA1: 3f3eff95f840e6321b0d25211ef5116304049dc7
//-----------------
'use strict';

const h2 = require('http2');

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
  const testStr = 'Request Body from Client';
  let server;
  let client;

  beforeAll(() => {
    server = h2.createServer();
  });

  afterAll(() => {
    if (client) client.close();
    if (server) server.close();
  });

  test('pause & resume work as expected with Http2ServerRequest', (done) => {
    const requestHandler = jest.fn((req, res) => {
      let data = '';
      req.pause();
      req.setEncoding('utf8');
      req.on('data', jest.fn((chunk) => (data += chunk)));
      setTimeout(() => {
        expect(data).toBe('');
        req.resume();
      }, 100);
      req.on('end', () => {
        expect(data).toBe(testStr);
        res.end();
      });

      res.on('finish', () => process.nextTick(() => {
        req.pause();
        req.resume();
      }));
    });

    server.on('request', requestHandler);

    server.listen(0, () => {
      const port = server.address().port;

      client = h2.connect(`http://localhost:${port}`);
      const request = client.request({
        ':path': '/foobar',
        ':method': 'POST',
        ':scheme': 'http',
        ':authority': `localhost:${port}`
      });
      request.resume();
      request.end(testStr);
      request.on('end', () => {
        expect(requestHandler).toHaveBeenCalled();
        done();
      });
    });
  });
}
//<#END_FILE: test-http2-compat-serverrequest-pause.js
