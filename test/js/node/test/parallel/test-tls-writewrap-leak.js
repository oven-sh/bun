'use strict';
const common = require('../common');

if (!common.hasCrypto)
  common.skip('missing crypto');

const assert = require('assert');
const net = require('net');
const tls = require('tls');

console.log('Creating server...');
const server = net.createServer(common.mustCall((c) => {
  console.log('Server received connection, destroying it...');
  c.destroy();
})).listen(0, common.mustCall(() => {
  console.log('Server listening on port:', server.address().port);
  console.log('Creating TLS client connection...');
  const c = tls.connect({ port: server.address().port });
  c.on('error', (err) => {
    console.log('TLS client received error', err);
    // Otherwise `.write()` callback won't be invoked.
    // c._undestroy();
  });

  console.log('Attempting to write data...');
  c.write('hello', common.mustCall((err) => {
    console.log('Write callback called with error:', err);
    assert.strictEqual(err.code, 'ECANCELED');
    console.log('Closing server...');
    server.close();
  }));
}));
