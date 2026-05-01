'use strict';

const common = require('../common');
if (!common.hasCrypto)
  common.skip('missing crypto');

const assert = require('assert');

const {
  generateKeyPairSync,
} = require('crypto');

// Test invalid parameter encoding.

// BoringSSL does not support DSA key generation.
if (!common.openSSLIsBoringSSL) {
  assert.throws(() => generateKeyPairSync('dsa', {
    modulusLength: 1024,
    publicKeyEncoding: {
      format: 'jwk'
    },
    privateKeyEncoding: {
      format: 'jwk'
    }
  }), {
    name: 'Error',
    code: 'ERR_CRYPTO_JWK_UNSUPPORTED_KEY_TYPE',
    message: 'Unsupported JWK Key Type.'
  });
}
