/*
Skipped test
https://github.com/electron/electron/blob/5680c628b6718385bbd975b51ec2640aa7df226b/script/node-disabled-tests.json#L22

'use strict';

const common = require('../common');
if (!common.hasCrypto)
  common.skip('missing crypto');

const DeprecationWarning = [];
DeprecationWarning.push([
  '"options.hash" is deprecated, use "options.hashAlgorithm" instead.',
  'DEP0154']);
DeprecationWarning.push([
  '"options.mgf1Hash" is deprecated, use "options.mgf1HashAlgorithm" instead.',
  'DEP0154']);

common.expectWarning({ DeprecationWarning });

const assert = require('assert');
const { generateKeyPair } = require('crypto');

{
  // This test makes sure deprecated options still work as intended

  generateKeyPair('rsa-pss', {
    modulusLength: 512,
    saltLength: 16,
    hash: 'sha256',
    mgf1Hash: 'sha256'
  }, common.mustSucceed((publicKey, privateKey) => {
    assert.strictEqual(publicKey.type, 'public');
    assert.strictEqual(publicKey.asymmetricKeyType, 'rsa-pss');
    assert.deepStrictEqual(publicKey.asymmetricKeyDetails, {
      modulusLength: 512,
      publicExponent: 65537n,
      hashAlgorithm: 'sha256',
      mgf1HashAlgorithm: 'sha256',
      saltLength: 16
    });

    assert.strictEqual(privateKey.type, 'private');
    assert.strictEqual(privateKey.asymmetricKeyType, 'rsa-pss');
    assert.deepStrictEqual(privateKey.asymmetricKeyDetails, {
      modulusLength: 512,
      publicExponent: 65537n,
      hashAlgorithm: 'sha256',
      mgf1HashAlgorithm: 'sha256',
      saltLength: 16
    });
  }));
}

*/