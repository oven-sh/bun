'use strict';

const common = require('../common');
if (!common.hasCrypto)
  common.skip('missing crypto');

const assert = require('assert');
const tls = require('tls');
const util = require('util');
const fixtures = require('../common/fixtures');

const sent = 'hello world';
const serverOptions = {
  isServer: true,
  key: fixtures.readKey('agent1-key.pem'),
  cert: fixtures.readKey('agent1-cert.pem')
};

let ssl = null;

process.on('exit', function() {
  console.log('Exit handler called');
  assert.ok(ssl !== null);
  // If the internal pointer to stream_ isn't cleared properly then this
  // will abort.
  console.log('About to inspect ssl');
  util.inspect(ssl);
});

const server = tls.createServer(serverOptions, function(s) {
  console.log('Server connection received');
  s.on('data', function() { 
    console.log('Server received data');
  });
  s.on('end', function() {
    console.log('Server connection ended');
    server.close();
    s.destroy();
  });
}).listen(0, function() {
  console.log('Server listening on port:', this.address().port);
  const c = new tls.TLSSocket();
  ssl = c.ssl;
  console.log('Created TLSSocket with ssl');
  c.connect(this.address().port, function() {
    console.log('Client connected');
    c.end(sent);
  });
});
