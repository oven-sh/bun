//#FILE: test-http2-compat-serverresponse-finished.js
//#SHA1: 6ef7a05f30923975d7a267cee54aafae1bfdbc7d
//-----------------
'use strict';

const h2 = require('http2');
const net = require('net');

let server;

beforeAll(() => {
  // Skip the test if crypto is not available
  if (!process.versions.openssl) {
    return test.skip('missing crypto');
  }
});

afterEach(() => {
  if (server) {
    server.close();
  }
});

test('Http2ServerResponse.finished', (done) => {
  server = h2.createServer();
  server.listen(0, () => {
    const port = server.address().port;
    
    server.once('request', (request, response) => {
      expect(response.socket).toBeInstanceOf(net.Socket);
      expect(response.connection).toBeInstanceOf(net.Socket);
      expect(response.socket).toBe(response.connection);

      response.on('finish', () => {
        expect(response.socket).toBeUndefined();
        expect(response.connection).toBeUndefined();
        process.nextTick(() => {
          expect(response.stream).toBeDefined();
          done();
        });
      });

      expect(response.finished).toBe(false);
      expect(response.writableEnded).toBe(false);
      response.end();
      expect(response.finished).toBe(true);
      expect(response.writableEnded).toBe(true);
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
      request.on('end', () => {
        client.close();
      });
      request.end();
      request.resume();
    });
  });
});

//<#END_FILE: test-http2-compat-serverresponse-finished.js
