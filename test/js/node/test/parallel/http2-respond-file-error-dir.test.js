//#FILE: test-http2-respond-file-error-dir.js
//#SHA1: 61f98e2ad2c69302fe84383e1dec1118edaa70e1
//-----------------
'use strict';

const http2 = require('http2');
const path = require('path');

let server;
let client;

beforeAll(() => {
  if (!process.versions.openssl) {
    test.skip('missing crypto');
  }
});

afterEach(() => {
  if (client) {
    client.close();
  }
  if (server) {
    server.close();
  }
});

test('http2 respondWithFile with directory should fail', (done) => {
  server = http2.createServer();
  server.on('stream', (stream) => {
    stream.respondWithFile(process.cwd(), {
      'content-type': 'text/plain'
    }, {
      onError(err) {
        expect(err).toMatchObject({
          code: 'ERR_HTTP2_SEND_FILE',
          name: 'Error',
          message: 'Directories cannot be sent'
        });

        stream.respond({ ':status': 404 });
        stream.end();
      },
      statCheck: jest.fn()
    });
  });

  server.listen(0, () => {
    const port = server.address().port;
    client = http2.connect(`http://localhost:${port}`);
    const req = client.request();

    const responseHandler = jest.fn((headers) => {
      expect(headers[':status']).toBe(404);
    });

    const dataHandler = jest.fn();
    const endHandler = jest.fn(() => {
      expect(responseHandler).toHaveBeenCalled();
      expect(dataHandler).not.toHaveBeenCalled();
      done();
    });

    req.on('response', responseHandler);
    req.on('data', dataHandler);
    req.on('end', endHandler);
    req.end();
  });
});

//<#END_FILE: test-http2-respond-file-error-dir.js
