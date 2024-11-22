//#FILE: test-http2-request-remove-connect-listener.js
//#SHA1: 28cbc334f4429a878522e1e78eac56d13fb0c916
//-----------------
'use strict';

const http2 = require('http2');

// Skip the test if crypto is not available
let cryptoAvailable = true;
try {
  require('crypto');
} catch (err) {
  cryptoAvailable = false;
}

test('HTTP/2 request removes connect listener', (done) => {
  if (!cryptoAvailable) {
    console.log('Skipping test: missing crypto');
    return done();
  }

  const server = http2.createServer();
  const streamHandler = jest.fn((stream) => {
    stream.respond();
    stream.end();
  });
  server.on('stream', streamHandler);

  server.listen(0, () => {
    const client = http2.connect(`http://localhost:${server.address().port}`);
    const connectHandler = jest.fn();
    client.once('connect', connectHandler);

    const req = client.request();

    req.on('response', () => {
      expect(client.listenerCount('connect')).toBe(0);
      expect(streamHandler).toHaveBeenCalled();
      expect(connectHandler).toHaveBeenCalled();
    });

    req.on('close', () => {
      server.close();
      client.close();
      done();
    });
  });
});

//<#END_FILE: test-http2-request-remove-connect-listener.js
