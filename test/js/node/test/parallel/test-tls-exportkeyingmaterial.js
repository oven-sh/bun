'use strict';

// Test return value of tlsSocket.exportKeyingMaterial

const common = require('../common');

if (!common.hasCrypto)
  common.skip('missing crypto');

const assert = require('assert');
const net = require('net');
const tls = require('tls');
const fixtures = require('../common/fixtures');

const key = fixtures.readKey('agent1-key.pem');
const cert = fixtures.readKey('agent1-cert.pem');

console.log('Creating server...');
const server = net.createServer(common.mustCall((s) => {
  console.log('Server received connection');
  const tlsSocket = new tls.TLSSocket(s, {
    isServer: true,
    server: server,
    secureContext: tls.createSecureContext({ key, cert })
  });

  console.log('Testing exportKeyingMaterial before secure connection...');
  assert.throws(() => {
    tlsSocket.exportKeyingMaterial(128, 'label');
  }, {
    name: 'Error',
    message: 'TLS socket connection must be securely established',
    code: 'ERR_TLS_INVALID_STATE'
  });
  console.log('Assert complete.');

  tlsSocket.on('secure', common.mustCall(() => {
    console.log('TLS connection secured');
    const label = 'client finished';

    console.log('Testing valid keying material export...');
    const validKeyingMaterial = tlsSocket.exportKeyingMaterial(128, label);
    assert.strictEqual(validKeyingMaterial.length, 128);
    console.log('Valid keying material length:', validKeyingMaterial.length);

    console.log('Testing keying material with context...');
    const validKeyingMaterialWithContext = tlsSocket
      .exportKeyingMaterial(128, label, Buffer.from([0, 1, 2, 3]));
    assert.strictEqual(validKeyingMaterialWithContext.length, 128);
    console.log('Keying material with context length:', validKeyingMaterialWithContext.length);

    // Ensure providing a context results in a different key than without
    assert.notStrictEqual(validKeyingMaterial, validKeyingMaterialWithContext);
    console.log('Verified different keys for with/without context');

    console.log('Testing keying material with empty context...');
    const validKeyingMaterialWithEmptyContext = tlsSocket
      .exportKeyingMaterial(128, label, Buffer.from([]));
    assert.strictEqual(validKeyingMaterialWithEmptyContext.length, 128);
    console.log('Empty context keying material length:', validKeyingMaterialWithEmptyContext.length);

    console.log('Testing invalid argument types...');
    assert.throws(() => {
      tlsSocket.exportKeyingMaterial(128, label, 'stringAsContextNotSupported');
    }, {
      name: 'TypeError',
      code: 'ERR_INVALID_ARG_TYPE'
    });

    assert.throws(() => {
      tlsSocket.exportKeyingMaterial(128, label, 1234);
    }, {
      name: 'TypeError',
      code: 'ERR_INVALID_ARG_TYPE'
    });

    assert.throws(() => {
      tlsSocket.exportKeyingMaterial(10, null);
    }, {
      name: 'TypeError',
      code: 'ERR_INVALID_ARG_TYPE'
    });

    assert.throws(() => {
      tlsSocket.exportKeyingMaterial('length', 1234);
    }, {
      name: 'TypeError',
      code: 'ERR_INVALID_ARG_TYPE'
    });

    console.log('Testing invalid range values...');
    assert.throws(() => {
      tlsSocket.exportKeyingMaterial(-3, 'a');
    }, {
      name: 'RangeError',
      code: 'ERR_OUT_OF_RANGE'
    });

    assert.throws(() => {
      tlsSocket.exportKeyingMaterial(0, 'a');
    }, {
      name: 'RangeError',
      code: 'ERR_OUT_OF_RANGE'
    });

    console.log('Closing TLS socket and server...');
    tlsSocket.end();
    server.close();
  }));
})).listen(0, () => {
  console.log('Server listening on port:', server.address().port);
  const opts = {
    port: server.address().port,
    rejectUnauthorized: false
  };

  console.log('Connecting client...');
  tls.connect(opts, common.mustCall(function() { 
    console.log('Client connected');
    this.end(); 
  }));
});
