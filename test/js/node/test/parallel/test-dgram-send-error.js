// Flags: --expose-internals
'use strict';
const common = require('../common');
const assert = require('assert');
const dgram = require('dgram');
const { getSystemErrorName } = require('util');
const mockError = new Error('mock DNS error');

let kStateSymbol;

function getSocket(callback) {
  const socket = dgram.createSocket('udp4');

  if (!kStateSymbol) {
    kStateSymbol = Object.getOwnPropertySymbols(socket).filter(sym => sym.description === "state symbol")[0];
  }

  socket.on('message', common.mustNotCall('Should not receive any messages.'));
  socket.bind(common.mustCall(() => {
    socket[kStateSymbol].handle.lookup = function(address, callback) {
      process.nextTick(callback, mockError);
    };

    callback(socket);
  }));
  return socket;
}

getSocket((socket) => {
  socket.on('error', common.mustCall((err) => {
    socket.close();
    assert.strictEqual(err, mockError);
  }));

  socket.send('foo', socket.address().port, 'localhost');
});

getSocket((socket) => {
  const callback = common.mustCall((err) => {
    socket.close();
    assert.strictEqual(err, mockError);
  });

  socket.send('foo', socket.address().port, 'localhost', callback);
});

{
  const socket = dgram.createSocket('udp4');

  socket.on('message', common.mustNotCall('Should not receive any messages.'));

  socket.bind(common.mustCall(() => {
    const port = socket.address().port;
    const callback = common.mustCall((err, ...args) => {
      socket.close();
      assert.strictEqual(err.code, 'UNKNOWN');
      assert.strictEqual(getSystemErrorName(err.errno), 'UNKNOWN');
      assert.strictEqual(err.syscall, 'send');
      assert.strictEqual(err.address, common.localhostIPv4);
      assert.strictEqual(err.port, port);
      assert.strictEqual(
        err.message,
        `${err.syscall} ${err.code} ${err.address}:${err.port}`
      );
    });

    socket[kStateSymbol].handle.socket.send = function() {
      throw Object.assign(new Error("???"), {code: "UNKNOWN", errno: -4094, syscall: "send"});
    };

    socket.send('foo', port, common.localhostIPv4, callback);
  }));
}
