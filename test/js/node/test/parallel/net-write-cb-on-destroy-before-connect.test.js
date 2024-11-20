//#FILE: test-net-write-cb-on-destroy-before-connect.js
//#SHA1: 49dc0c1780402ca7bc3648f52f821b0ba89eff32
//-----------------
'use strict';

const net = require('net');

let server;

beforeAll((done) => {
  server = net.createServer();
  server.listen(0, () => {
    done();
  });
});

afterAll((done) => {
  server.close(done);
});

test('write callback on destroy before connect', (done) => {
  const socket = new net.Socket();

  socket.on('connect', () => {
    done('Socket should not connect');
  });

  socket.connect({
    port: server.address().port,
  }, "127.0.0.1");

  expect(socket.connecting).toBe(true);

  socket.write('foo', (err) => {
    expect(err).toEqual(expect.objectContaining({
      code: 'ERR_SOCKET_CLOSED_BEFORE_CONNECTION',
      name: 'Error'
    }));
    done();
  });

  socket.destroy();
});

//<#END_FILE: test-net-write-cb-on-destroy-before-connect.js
