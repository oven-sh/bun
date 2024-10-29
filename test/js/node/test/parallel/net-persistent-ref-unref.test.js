//#FILE: test-net-persistent-ref-unref.js
//#SHA1: 630ad893713b3c13100743b5e5ae46453adc523e
//-----------------
'use strict';
const net = require('net');

// Mock TCPWrap
const TCPWrap = {
  prototype: {
    ref: jest.fn(),
    unref: jest.fn(),
  },
};

let refCount = 0;

describe('Net persistent ref/unref', () => {
  let echoServer;

  beforeAll((done) => {
    echoServer = net.createServer((conn) => {
      conn.end();
    });

    TCPWrap.prototype.ref = jest.fn().mockImplementation(function() {
      TCPWrap.prototype.ref.mockOriginal.call(this);
      refCount++;
      expect(refCount).toBe(0);
    });

    TCPWrap.prototype.unref = jest.fn().mockImplementation(function() {
      TCPWrap.prototype.unref.mockOriginal.call(this);
      refCount--;
      expect(refCount).toBe(-1);
    });

    echoServer.listen(0, done);
  });

  afterAll((done) => {
    echoServer.close(done);
  });

  test('should maintain correct ref count', (done) => {
    const sock = new net.Socket();
    sock.unref();
    sock.ref();
    sock.connect(echoServer.address().port);
    sock.on('end', () => {
      expect(refCount).toBe(0);
      done();
    });
  });
});

//<#END_FILE: test-net-persistent-ref-unref.js
