'use strict';

const common = require('../common');
if (!common.hasCrypto)
  common.skip('missing crypto');

const assert = require('assert');
const crypto = require('crypto');
const {
  createSign,
  createVerify,
  publicEncrypt,
  privateDecrypt,
  sign,
  verify,
} = crypto;

// The values below (modp2/modp2buf) are for a 1024 bits long prime from
// RFC 2412 E.2, see https://tools.ietf.org/html/rfc2412. */
const modp2buf = Buffer.from([
  0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xc9, 0x0f,
  0xda, 0xa2, 0x21, 0x68, 0xc2, 0x34, 0xc4, 0xc6, 0x62, 0x8b,
  0x80, 0xdc, 0x1c, 0xd1, 0x29, 0x02, 0x4e, 0x08, 0x8a, 0x67,
  0xcc, 0x74, 0x02, 0x0b, 0xbe, 0xa6, 0x3b, 0x13, 0x9b, 0x22,
  0x51, 0x4a, 0x08, 0x79, 0x8e, 0x34, 0x04, 0xdd, 0xef, 0x95,
  0x19, 0xb3, 0xcd, 0x3a, 0x43, 0x1b, 0x30, 0x2b, 0x0a, 0x6d,
  0xf2, 0x5f, 0x14, 0x37, 0x4f, 0xe1, 0x35, 0x6d, 0x6d, 0x51,
  0xc2, 0x45, 0xe4, 0x85, 0xb5, 0x76, 0x62, 0x5e, 0x7e, 0xc6,
  0xf4, 0x4c, 0x42, 0xe9, 0xa6, 0x37, 0xed, 0x6b, 0x0b, 0xff,
  0x5c, 0xb6, 0xf4, 0x06, 0xb7, 0xed, 0xee, 0x38, 0x6b, 0xfb,
  0x5a, 0x89, 0x9f, 0xa5, 0xae, 0x9f, 0x24, 0x11, 0x7c, 0x4b,
  0x1f, 0xe6, 0x49, 0x28, 0x66, 0x51, 0xec, 0xe6, 0x53, 0x81,
  0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
]);

function testDH({ publicKey: alicePublicKey, privateKey: alicePrivateKey },
                { publicKey: bobPublicKey, privateKey: bobPrivateKey },
                expectedValue) {
  const buf1 = crypto.diffieHellman({
    privateKey: alicePrivateKey,
    publicKey: bobPublicKey,
  });
  const buf2 = crypto.diffieHellman({
    privateKey: bobPrivateKey,
    publicKey: alicePublicKey,
  });
  assert.deepStrictEqual(buf1, buf2);

  if (expectedValue !== undefined)
    assert.deepStrictEqual(buf1, expectedValue);
}

// Asserts that the size of the given key (in chars or bytes) is within 10% of
// the expected size.
function assertApproximateSize(key, expectedSize) {
  const u = typeof key === 'string' ? 'chars' : 'bytes';
  const min = Math.floor(0.9 * expectedSize);
  const max = Math.ceil(1.1 * expectedSize);
  assert(key.length >= min,
         `Key (${key.length} ${u}) is shorter than expected (${min} ${u})`);
  assert(key.length <= max,
         `Key (${key.length} ${u}) is longer than expected (${max} ${u})`);
}

// Tests that a key pair can be used for encryption / decryption.
function testEncryptDecrypt(publicKey, privateKey) {
  const message = 'Hello Node.js world!';
  const plaintext = Buffer.from(message, 'utf8');
  for (const key of [publicKey, privateKey]) {
    const ciphertext = publicEncrypt(key, plaintext);
    const received = privateDecrypt(privateKey, ciphertext);
    assert.strictEqual(received.toString('utf8'), message);
  }
}

// Tests that a key pair can be used for signing / verification.
function testSignVerify(publicKey, privateKey) {
  const message = Buffer.from('Hello Node.js world!');

  function oldSign(algo, data, key) {
    return createSign(algo).update(data).sign(key);
  }

  function oldVerify(algo, data, key, signature) {
    return createVerify(algo).update(data).verify(key, signature);
  }

  for (const signFn of [sign, oldSign]) {
    const signature = signFn('SHA256', message, privateKey);
    for (const verifyFn of [verify, oldVerify]) {
      for (const key of [publicKey, privateKey]) {
        const okay = verifyFn('SHA256', message, key, signature);
        assert(okay);
      }
    }
  }
}

// Constructs a regular expression for a PEM-encoded key with the given label.
function getRegExpForPEM(label, cipher) {
  const head = `\\-\\-\\-\\-\\-BEGIN ${label}\\-\\-\\-\\-\\-`;
  const rfc1421Header = cipher == null ? '' :
    `\nProc-Type: 4,ENCRYPTED\nDEK-Info: ${cipher},[^\n]+\n`;
  const body = '([a-zA-Z0-9\\+/=]{64}\n)*[a-zA-Z0-9\\+/=]{1,64}';
  const end = `\\-\\-\\-\\-\\-END ${label}\\-\\-\\-\\-\\-`;
  return new RegExp(`^${head}${rfc1421Header}\n${body}\n${end}\n$`);
}

const pkcs1PubExp = getRegExpForPEM('RSA PUBLIC KEY');
const pkcs1PrivExp = getRegExpForPEM('RSA PRIVATE KEY');
const pkcs1EncExp = (cipher) => getRegExpForPEM('RSA PRIVATE KEY', cipher);
const spkiExp = getRegExpForPEM('PUBLIC KEY');
const pkcs8Exp = getRegExpForPEM('PRIVATE KEY');
const pkcs8EncExp = getRegExpForPEM('ENCRYPTED PRIVATE KEY');
const sec1Exp = getRegExpForPEM('EC PRIVATE KEY');
const sec1EncExp = (cipher) => getRegExpForPEM('EC PRIVATE KEY', cipher);

module.exports = {
  modp2buf,
  testDH,
  assertApproximateSize,
  testEncryptDecrypt,
  testSignVerify,
  pkcs1PubExp,
  pkcs1PrivExp,
  pkcs1EncExp,  // used once
  spkiExp,
  pkcs8Exp, // used once
  pkcs8EncExp,  // used once
  sec1Exp,
  sec1EncExp,
};
