//#FILE: test-http2-respond-file-compat.js
//#SHA1: fac1eb9c2e4f7a75e9c7605abc64fc9c6e6f7f14
//-----------------
'use strict';

const http2 = require('http2');
const fs = require('fs');
const path = require('path');

const hasCrypto = (() => {
  try {
    require('crypto');
    return true;
  } catch (err) {
    return false;
  }
})();

const fname = path.join(__dirname, '..', 'fixtures', 'elipses.txt');

describe('HTTP/2 respondWithFile', () => {
  let server;

  beforeAll(() => {
    if (!hasCrypto) {
      return;
    }
    // Ensure the file exists
    if (!fs.existsSync(fname)) {
      fs.writeFileSync(fname, '...');
    }
  });

  afterAll(() => {
    if (server) {
      server.close();
    }
  });

  test('should respond with file', (done) => {
    if (!hasCrypto) {
      done();
      return;
    }

    const requestHandler = jest.fn((request, response) => {
      response.stream.respondWithFile(fname);
    });

    server = http2.createServer(requestHandler);
    server.listen(0, () => {
      const client = http2.connect(`http://localhost:${server.address().port}`);
      const req = client.request();

      const responseHandler = jest.fn();
      req.on('response', responseHandler);

      req.on('end', () => {
        expect(requestHandler).toHaveBeenCalled();
        expect(responseHandler).toHaveBeenCalled();
        client.close();
        server.close(() => {
          done();
        });
      });

      req.end();
      req.resume();
    });
  });
});

//<#END_FILE: test-http2-respond-file-compat.js
