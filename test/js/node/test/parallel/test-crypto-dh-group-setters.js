/*
Skipped test
https://github.com/electron/electron/blob/e57b69f106ae9c53a527038db4e8222692fa0ce7/script/node-disabled-tests.json#L14

'use strict';
const common = require('../common');
if (!common.hasCrypto)
  common.skip('missing crypto');

const assert = require('assert');
const crypto = require('crypto');

// Unlike DiffieHellman, DiffieHellmanGroup does not have any setters.
const dhg = crypto.getDiffieHellman('modp1');
assert.strictEqual(dhg.constructor, crypto.DiffieHellmanGroup);
assert.strictEqual(dhg.setPrivateKey, undefined);
assert.strictEqual(dhg.setPublicKey, undefined);

// */