//#FILE: test-http2-respond-errors.js
//#SHA1: 383943673600e7ebea3caa91d65e0030a477c47d
//-----------------
'use strict';

const http2 = require('http2');

let server;
let client;

beforeAll((done) => {
  server = http2.createServer();
  server.listen(0, () => {
    done();
  });
});

afterAll((done) => {
  if (client) client.close();
  server.close(done);
});

test('HTTP/2 respond errors', (done) => {
  server.once('stream', (stream) => {
    // Send headers
    stream.respond({ 'content-type': 'text/plain' });

    // Should throw if headers already sent
    expect(() => stream.respond()).toThrow(expect.objectContaining({
      name: 'Error',
      code: 'ERR_HTTP2_HEADERS_SENT',
      message: expect.stringContaining('Response has already been initiated')
    }));

    // Should throw if stream is destroyed
    stream.destroy();
    expect(() => stream.respond()).toThrow(expect.objectContaining({
      name: 'Error',
      code: 'ERR_HTTP2_INVALID_STREAM',
      message: expect.stringContaining('The stream has been destroyed')
    }));

    done();
  });

  client = http2.connect(`http://localhost:${server.address().port}`);
  const req = client.request();

  req.on('end', () => {
    client.close();
  });
  req.resume();
  req.end();
});

//<#END_FILE: test-http2-respond-errors.js
