'use strict';

const common = require('../common');

if (!common.hasCrypto)
  common.skip('missing crypto');

const assert = require('assert');
const { subtle } = globalThis.crypto;

const AsyncFunction = async function() {}.constructor;

const methods = [
  'decrypt',
  'decapsulateBits',
  'decapsulateKey',
  'deriveBits',
  'deriveKey',
  'digest',
  'encapsulateBits',
  'encapsulateKey',
  'encrypt',
  'exportKey',
  'generateKey',
  'getPublicKey',
  'importKey',
  'sign',
  'unwrapKey',
  'verify',
  'wrapKey',
];

(async function() {
  // Bun: getPublicKey and the ML-KEM encapsulate/decapsulate methods are not
  // implemented yet; verify the non-async invariant for the methods that exist.
  const implemented = methods.filter((name) => typeof subtle[name] === 'function');
  assert.ok(implemented.length >= 12);

  for (const name of implemented) {
    assert.notStrictEqual(subtle[name].constructor, AsyncFunction);

    const promise = subtle[name].call({});
    assert.strictEqual(Object.getPrototypeOf(promise), Promise.prototype);
    await assert.rejects(promise, {
      code: 'ERR_INVALID_THIS',
    });
  }
})().then(common.mustCall());
