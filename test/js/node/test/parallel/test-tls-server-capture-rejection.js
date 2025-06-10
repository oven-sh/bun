'use strict';

const common = require('../common');
if (!common.hasCrypto)
  common.skip('missing crypto');

const assert = require('assert');
const events = require('events');
const fixtures = require('../common/fixtures');
const { createServer, connect } = require('tls');
const cert = fixtures.readKey('rsa_cert.crt');
const key = fixtures.readKey('rsa_private.pem');

console.log('Setting up event capture rejections...');
events.captureRejections = true;

console.log('Creating TLS server...');
const server = createServer({ cert, key }, common.mustCall(async (sock) => {
  console.log('Server received connection');
  server.close();
  console.log('Server closed');

  const _err = new Error('kaboom');
  console.log('Setting up error handler on socket...');
  sock.on('error', common.mustCall((err) => {
    console.log('Socket error handler called with:', err.message);
    assert.strictEqual(err, _err);
  }));
  console.log('Throwing error...');
  throw _err;
}));

console.log('Starting server...');
server.listen(0, common.mustCall(() => {
  console.log('Server listening on port:', server.address().port);
  console.log('Creating client connection...');
  const sock = connect({
    port: server.address().port,
    host: server.address().host,
    rejectUnauthorized: false
  });

  console.log('Setting up close handler on client socket...');
  sock.on('close', common.mustCall(() => {
    console.log('Client socket closed');
  }));
}));
