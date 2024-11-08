//#FILE: test-net-write-slow.js
//#SHA1: ef646d024e2dfcfb07b99fcdfb9ccf2bfbcb6487
//-----------------
'use strict';
const net = require('net');

const SIZE = 2E5;
const N = 10;
let flushed = 0;
let received = 0;
const buf = Buffer.alloc(SIZE, 'a');

let server;

beforeAll(() => {
  return new Promise((resolve) => {
    server = net.createServer((socket) => {
      socket.setNoDelay();
      socket.setTimeout(9999);
      socket.on('timeout', () => {
        throw new Error(`flushed: ${flushed}, received: ${received}/${SIZE * N}`);
      });

      for (let i = 0; i < N; ++i) {
        socket.write(buf, () => {
          ++flushed;
          if (flushed === N) {
            socket.setTimeout(0);
          }
        });
      }
      socket.end();
    }).listen(0, () => {
      resolve();
    });
  });
});

afterAll(() => {
  return new Promise((resolve) => {
    server.close(resolve);
  });
});

test('net write slow', (done) => {
  const conn = net.connect(server.address().port);
  
  conn.on('data', (buf) => {
    received += buf.length;
    conn.pause();
    setTimeout(() => {
      conn.resume();
    }, 20);
  });

  conn.on('end', () => {
    expect(received).toBe(SIZE * N);
    done();
  });
});

//<#END_FILE: test-net-write-slow.js
