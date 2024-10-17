//#FILE: test-http2-socket-proxy.js
//#SHA1: c5158fe06db7a7572dc5f7a52c23f019d16fb8ce
//-----------------
'use strict';

const h2 = require('http2');
const net = require('net');

let server;
let port;

beforeAll(async () => {
  server = h2.createServer();
  await new Promise(resolve => server.listen(0, () => {
    port = server.address().port;
    resolve();
  }));
});

afterAll(async () => {
  await new Promise(resolve => server.close(resolve));
});

describe('HTTP/2 Socket Proxy', () => {
  test('Socket behavior on Http2Session', async () => {
    expect.assertions(5);

    server.once('stream', (stream, headers) => {
      const socket = stream.session.socket;
      const session = stream.session;

      expect(socket).toBeInstanceOf(net.Socket);
      expect(socket.writable).toBe(true);
      expect(socket.readable).toBe(true);
      expect(typeof socket.address()).toBe('object');

      // Test that setting a property on socket affects the session
      const fn = jest.fn();
      socket.setTimeout = fn;
      expect(session.setTimeout).toBe(fn);

      stream.respond({ ':status': 200 });
      stream.end('OK');
    });

    const client = h2.connect(`http://localhost:${port}`);
    const req = client.request({ ':path': '/' });
    
    await new Promise(resolve => {
      req.on('response', () => {
        req.on('data', () => {});
        req.on('end', () => {
          client.close();
          resolve();
        });
      });
    });
  }, 10000); // Increase timeout to 10 seconds
});

//<#END_FILE: test-http2-socket-proxy.js
