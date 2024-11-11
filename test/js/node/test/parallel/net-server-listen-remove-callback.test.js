//#FILE: test-net-server-listen-remove-callback.js
//#SHA1: 031a06bd108815e34b9ebbc3019044daeb8cf8c8
//-----------------
'use strict';

const net = require('net');

let server;

beforeEach(() => {
  server = net.createServer();
});

afterEach((done) => {
  if (server.listening) {
    server.close(done);
  } else {
    done();
  }
});

test('Server should only fire listen callback once', (done) => {
  server.on('close', () => {
    const listeners = server.listeners('listening');
    console.log('Closed, listeners:', listeners.length);
    expect(listeners.length).toBe(0);
  });

  server.listen(0, () => {
    server.close();
  });

  server.once('close', () => {
    server.listen(0, () => {
      server.close(done);
    });
  });
});

//<#END_FILE: test-net-server-listen-remove-callback.js
