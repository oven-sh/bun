'use strict';
const common = require('../common');

if (!common.hasCrypto)
  common.skip('missing crypto');

const assert = require('assert');
const tls = require('tls');
const net = require('net');
const fixtures = require('../common/fixtures');

let out = '';

const server = tls.createServer({
  key: fixtures.readKey('agent1-key.pem'),
  cert: fixtures.readKey('agent1-cert.pem')
}, function(c) {
  c.end('hello');
}).listen(0, function() {
  const socket = new net.Socket();

  const s = tls.connect({
    socket: socket,
    rejectUnauthorized: false
  }, common.mustCall(function() {
    s.on('data', common.mustCall(function(chunk) {
      out += chunk;
    }));
    s.on('end', common.mustCall(function() {
      s.destroy();
      server.close();
    }));
  }));

  socket.connect(this.address().port);
});

process.on('exit', function() {
  assert.strictEqual(out, 'hello');
});
