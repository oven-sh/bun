//#FILE: test-net-socket-ready-without-cb.js
//#SHA1: 2f6be9472163372bcd602f547bd709b27a2baad6
//-----------------
'use strict';

const net = require('net');

test('socket.connect can be called without callback', (done) => {
  const server = net.createServer((conn) => {
    conn.end();
    server.close();
  });

  server.listen(0, 'localhost', () => {
    const client = new net.Socket();

    client.on('ready', () => {
      client.end();
      done();
    });

    client.connect(server.address());
  });
});

//<#END_FILE: test-net-socket-ready-without-cb.js
