//#FILE: test-http2-client-write-before-connect.js
//#SHA1: f38213aa6b5fb615d5b80f0213022ea06e2705cc
//-----------------
'use strict';

const h2 = require('http2');

let server;
let client;

beforeAll(() => {
  if (!process.versions.openssl) {
    test.skip('missing crypto');
    return;
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

test('HTTP/2 client write before connect', (done) => {
  server = h2.createServer();

  server.on('stream', (stream, headers, flags) => {
    let data = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => data += chunk);
    stream.on('end', () => {
      expect(data).toBe('some data more data');
    });
    stream.respond();
    stream.end('ok');
  });

  server.listen(0, () => {
    const port = server.address().port;
    client = h2.connect(`http://localhost:${port}`);

    const req = client.request({ ':method': 'POST' });
    req.write('some data ');
    req.end('more data');

    req.on('response', () => {});
    req.resume();
    req.on('end', () => {});
    req.on('close', () => {
      done();
    });
  });
});

//<#END_FILE: test-http2-client-write-before-connect.js
