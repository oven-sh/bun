'use strict';
const common = require('../common');
const dgram = require('dgram');
const socket = dgram.createSocket('udp4');
const kStateSymbol = Object.getOwnPropertySymbols(socket).filter(sym => sym.description === "state symbol")[0];
const { handle } = socket[kStateSymbol];
const lookup = handle.lookup;


// Test the scenario where the socket is closed during a bind operation.
handle.bind = common.mustNotCall('bind() should not be called.');

handle.lookup = common.mustCall(function(address, callback) {
  socket.close(common.mustCall(() => {
    lookup.call(this, address, callback);
  }));
});

socket.bind(common.mustNotCall('Socket should not bind.'));
