//#FILE: test-http2-unbound-socket-proxy.js
//#SHA1: bcb8a31b2f29926a8e8d9a3bb5f23d09bfa5e805
//-----------------
'use strict';

const http2 = require('http2');
const net = require('net');

let server;
let client;

beforeAll(() => {
  if (!process.versions.openssl) {
    return test.skip('missing crypto');
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

test('http2 unbound socket proxy', (done) => {
  server = http2.createServer();
  const streamHandler = jest.fn((stream) => {
    stream.respond();
    stream.end('ok');
  });
  server.on('stream', streamHandler);

  server.listen(0, () => {
    client = http2.connect(`http://localhost:${server.address().port}`);
    const socket = client.socket;
    const req = client.request();
    req.resume();
    req.on('close', () => {
      client.close();
      server.close();

      // Tests to make sure accessing the socket proxy fails with an
      // informative error.
      setImmediate(() => {
        expect(() => {
          socket.example; // eslint-disable-line no-unused-expressions
        }).toThrow(expect.objectContaining({
          code: 'ERR_HTTP2_SOCKET_UNBOUND'
        }));

        expect(() => {
          socket.example = 1;
        }).toThrow(expect.objectContaining({
          code: 'ERR_HTTP2_SOCKET_UNBOUND'
        }));

        expect(() => {
          // eslint-disable-next-line no-unused-expressions
          socket instanceof net.Socket;
        }).toThrow(expect.objectContaining({
          code: 'ERR_HTTP2_SOCKET_UNBOUND'
        }));

        expect(streamHandler).toHaveBeenCalled();
        done();
      });
    });
  });
});

//<#END_FILE: test-http2-unbound-socket-proxy.js
