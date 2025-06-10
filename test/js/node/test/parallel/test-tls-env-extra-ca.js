// Certs in NODE_EXTRA_CA_CERTS are used for TLS peer validation

'use strict';
const common = require('../common');

if (!common.hasCrypto)
  common.skip('missing crypto');

const assert = require('assert');
const tls = require('tls');
const fixtures = require('../common/fixtures');

const { fork } = require('child_process');

if (process.env.CHILD) {
  console.log('Child process started');
  const copts = {
    port: process.env.PORT,
    checkServerIdentity: common.mustCall(),
  };
  console.log('Client options:', copts);
  const client = tls.connect(copts, common.mustCall(function() {
    console.log('Client connected successfully');
    client.end('hi');
  }));
  return;
}

const options = {
  key: fixtures.readKey('agent1-key.pem'),
  cert: fixtures.readKey('agent1-cert.pem'),
};
console.log('Server options:', options);

const server = tls.createServer(options, common.mustCall(function(s) {
  console.log('Server received connection');
  s.end('bye');
  server.close();
})).listen(0, common.mustCall(function() {
  console.log('Server listening on port:', this.address().port);
  const env = {
    ...process.env,
    CHILD: 'yes',
    PORT: this.address().port,
    NODE_EXTRA_CA_CERTS: fixtures.path('keys', 'ca1-cert.pem')
  };

  fork(__filename, { env }).on('exit', common.mustCall(function(status) {
    console.log('Child process exited with status:', status);
    // Client did not succeed in connecting
    assert.strictEqual(status, 0);
  }));
}));
