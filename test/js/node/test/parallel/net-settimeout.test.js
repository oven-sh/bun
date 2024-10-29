//#FILE: test-net-settimeout.js
//#SHA1: 24fde10dfba0d555d2a61853374866b370e40edf
//-----------------
'use strict';

const net = require('net');

const T = 100;

let server;
let serverPort;

beforeAll((done) => {
  server = net.createServer((c) => {
    c.write('hello');
  });

  server.listen(0, () => {
    serverPort = server.address().port;
    done();
  });
});

afterAll((done) => {
  server.close(done);
});

test('setTimeout and immediate clearTimeout', (done) => {
  const socket = net.createConnection(serverPort, 'localhost');

  const timeoutCallback = jest.fn();
  const s = socket.setTimeout(T, timeoutCallback);
  expect(s).toBeInstanceOf(net.Socket);

  socket.on('data', () => {
    setTimeout(() => {
      socket.destroy();
      expect(timeoutCallback).not.toHaveBeenCalled();
      done();
    }, T * 2);
  });

  socket.setTimeout(0);
});

//<#END_FILE: test-net-settimeout.js
