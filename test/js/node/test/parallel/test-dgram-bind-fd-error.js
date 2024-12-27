// Flags: --expose-internals
'use strict';
const common = require('../common');
if (common.isWindows)
  common.skip('Does not support binding fd on Windows');

const dgram = require('dgram');
const assert = require('assert');
// const { kStateSymbol } = require('internal/dgram');
const { internalBinding } = require('internal/test/binding');
// const { TCP, constants } = internalBinding('tcp_wrap');
const TYPE = 'udp4';

// Throw when the fd is occupied according to https://github.com/libuv/libuv/pull/1851.
{
  const socket = dgram.createSocket(TYPE);

  socket.bind(common.mustCall(() => {
    const anotherSocket = dgram.createSocket(TYPE);
    const state_symbol = Object.getOwnPropertySymbols(socket).filter(sym => sym.description == "state symbol")[0];
    assert.notStrictEqual(state_symbol, undefined);
    const { handle } = socket[state_symbol];
    assert.notStrictEqual(handle.fd, undefined);

    assert.throws(() => {
      anotherSocket.bind({
        fd: handle.fd,
      });
    }, {
      code: 'EEXIST',
      name: 'Error',
      message: /^open EEXIST$/
    });

    socket.close();
  }));

  socket.on("error", (...args) => { console.log("oh no", ...args); });
}
return;

// Throw when the type of fd is not "UDP".
{
  const handle = new TCP(constants.SOCKET);
  handle.listen();

  const fd = handle.fd;
  assert.notStrictEqual(fd, -1);

  const socket = new dgram.createSocket(TYPE);
  assert.throws(() => {
    socket.bind({
      fd,
    });
  }, {
    code: 'ERR_INVALID_FD_TYPE',
    name: 'TypeError',
    message: /^Unsupported fd type: TCP$/
  });

  handle.close();
}
