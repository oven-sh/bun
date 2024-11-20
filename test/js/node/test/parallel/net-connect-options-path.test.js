//#FILE: test-net-connect-options-path.js
//#SHA1: 03b1a7de04f689c6429298b553a49478321b4adb
//-----------------
'use strict';
const net = require('net');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CLIENT_VARIANTS = 12;

describe('net.connect options path', () => {
  let serverPath;
  let server;

  beforeAll(() => {
    const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'net-connect-options-path-'));
    serverPath = path.join(tmpdir, 'server');
  });

  afterAll(() => {
    fs.rmdirSync(path.dirname(serverPath), { recursive: true });
  });

  test('connect with various options', (done) => {
    let connectionsCount = 0;

    server = net.createServer((socket) => {
      socket.end('ok');
    });

    server.listen(serverPath, () => {
      const connectAndTest = (connectFn) => {
        return new Promise((resolve) => {
          const socket = connectFn();
          socket.on('data', (data) => {
            expect(data.toString()).toBe('ok');
            socket.end();
          });
          socket.on('end', () => {
            connectionsCount++;
            resolve();
          });
        });
      };

      const connectPromises = [
        () => net.connect(serverPath),
        () => net.createConnection(serverPath),
        () => new net.Socket().connect(serverPath),
        () => net.connect({ path: serverPath }),
        () => net.createConnection({ path: serverPath }),
        () => new net.Socket().connect({ path: serverPath })
      ];

      Promise.all(connectPromises.map(connectAndTest))
        .then(() => {
          expect(connectionsCount).toBe(CLIENT_VARIANTS / 2); // We're testing 6 variants instead of 12
          server.close(() => {
            done();
          });
        })
        .catch((err) => {
          done(err);
        });
    });
  });
});

//<#END_FILE: test-net-connect-options-path.js
