'use strict';
const common = require('../common');
if (!common.hasCrypto) { common.skip('missing crypto'); };

const assert = require('assert');
const { once } = require('events');
const fixtures = require('../common/fixtures');

// agent6-cert.pem is signed by intermediate cert of ca3.
// The server has a cert chain of agent6->ca3->ca1(root).

const { it, beforeEach, afterEach, describe } = require('node:test');

describe('allowPartialTrustChain', { skip: !common.hasCrypto }, function() {
  const tls = require('tls');
  let server;
  let client;
  let opts;

  beforeEach(async function() {
    console.log('Setting up server and options...');
    server = tls.createServer({
      ca: fixtures.readKey('ca3-cert.pem'),
      key: fixtures.readKey('agent6-key.pem'),
      cert: fixtures.readKey('agent6-cert.pem'),
    }, (socket) => socket.resume());
    server.listen(0);
    await once(server, 'listening');
    console.log('Server listening on port:', server.address().port);

    opts = {
      port: server.address().port,
      ca: fixtures.readKey('ca3-cert.pem'),
      checkServerIdentity() {}
    };
    console.log('Options configured:', opts);
  });

  afterEach(async function() {
    console.log('Cleaning up client and server...');
    client?.destroy();
    server?.close();
  });

  it('can connect successfully with allowPartialTrustChain: true', async function() {
    console.log('Testing connection with allowPartialTrustChain: true');
    client = tls.connect({ ...opts, allowPartialTrustChain: true });
    await once(client, 'secureConnect'); // Should not throw
    console.log('Successfully connected with allowPartialTrustChain: true');
  });

  it('fails without with allowPartialTrustChain: true for an intermediate cert in the CA', async function() {
    console.log('Testing connection without allowPartialTrustChain');
    // Consistency check: Connecting fails without allowPartialTrustChain: true
    await assert.rejects(async () => {
      console.log('Attempting connection without allowPartialTrustChain...');
      const client = tls.connect(opts);
      await once(client, 'secureConnect');
    }, { code: 'UNABLE_TO_GET_ISSUER_CERT' });
    console.log('Connection failed as expected without allowPartialTrustChain');
  });
});
