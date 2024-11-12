//#FILE: test-net-allow-half-open.js
//#SHA1: 713191e6681104ac9709a51cbe5dc881f7a7fa89
//-----------------
'use strict';

const net = require('net');

describe('Net allow half open', () => {
  test('Socket not destroyed immediately after end', (done) => {
    const server = net.createServer((socket) => {
      socket.end(Buffer.alloc(1024));
    });

    server.listen(0, () => {
      const socket = net.connect(server.address().port);
      expect(socket.allowHalfOpen).toBe(false);
      socket.resume();

      socket.on('end', () => {
        process.nextTick(() => {
          // Ensure socket is not destroyed straight away
          // without proper shutdown.
          expect(socket.destroyed).toBe(false);
          server.close();
          done();
        });
      });

      socket.on('finish', () => {
        expect(socket.destroyed).toBe(false);
      });

      socket.on('close', () => {});
    });
  });

  test('Socket not destroyed after end and write', (done) => {
    const server = net.createServer((socket) => {
      socket.end(Buffer.alloc(1024));
    });

    server.listen(0, () => {
      const socket = net.connect(server.address().port);
      expect(socket.allowHalfOpen).toBe(false);
      socket.resume();

      socket.on('end', () => {
        expect(socket.destroyed).toBe(false);
      });

      socket.end('asd');

      socket.on('finish', () => {
        expect(socket.destroyed).toBe(false);
      });

      socket.on('close', () => {
        server.close();
        done();
      });
    });
  });
});

//<#END_FILE: test-net-allow-half-open.js
