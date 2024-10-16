//#FILE: test-http2-large-write-destroy.js
//#SHA1: 0c76344570b21b6ed78f12185ddefde59a9b2914
//-----------------
'use strict';

const http2 = require('http2');

const content = Buffer.alloc(60000, 0x44);

let server;

afterEach(() => {
  if (server) {
    server.close();
  }
});

test('HTTP/2 large write and destroy', (done) => {
  server = http2.createServer();

  server.on('stream', (stream) => {
    stream.respond({
      'Content-Type': 'application/octet-stream',
      'Content-Length': (content.length.toString() * 2),
      'Vary': 'Accept-Encoding'
    }, { waitForTrailers: true });

    stream.write(content);
    stream.destroy();
  });

  server.listen(0, () => {
    const client = http2.connect(`http://localhost:${server.address().port}`);

    const req = client.request({ ':path': '/' });
    req.end();
    req.resume(); // Otherwise close won't be emitted if there's pending data.

    req.on('close', () => {
      client.close();
      done();
    });

    req.on('error', (err) => {
      // We expect an error due to the stream being destroyed
      expect(err.code).toBe('ECONNRESET');
      client.close();
      done();
    });
  });
});

//<#END_FILE: test-http2-large-write-destroy.js
