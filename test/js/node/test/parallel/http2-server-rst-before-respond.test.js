//#FILE: test-http2-server-rst-before-respond.js
//#SHA1: 67d0d7c2fdd32d5eb050bf8473a767dbf24d158a
//-----------------
'use strict';

const h2 = require('http2');

let server;
let client;

beforeEach(() => {
  server = h2.createServer();
});

afterEach(() => {
  if (server) server.close();
  if (client) client.close();
});

test('HTTP/2 server reset stream before respond', (done) => {
  if (!process.versions.openssl) {
    test.skip('missing crypto');
    return;
  }

  const onStream = jest.fn((stream, headers, flags) => {
    stream.close();

    expect(() => {
      stream.additionalHeaders({
        ':status': 123,
        'abc': 123
      });
    }).toThrow(expect.objectContaining({
      code: 'ERR_HTTP2_INVALID_STREAM'
    }));
  });

  server.on('stream', onStream);

  server.listen(0, () => {
    const port = server.address().port;
    client = h2.connect(`http://localhost:${port}`);
    const req = client.request();

    const onHeaders = jest.fn();
    req.on('headers', onHeaders);

    const onResponse = jest.fn();
    req.on('response', onResponse);

    req.on('close', () => {
      expect(req.rstCode).toBe(h2.constants.NGHTTP2_NO_ERROR);
      expect(onStream).toHaveBeenCalledTimes(1);
      expect(onHeaders).not.toHaveBeenCalled();
      expect(onResponse).not.toHaveBeenCalled();
      done();
    });
  });
});

//<#END_FILE: test-http2-server-rst-before-respond.js
