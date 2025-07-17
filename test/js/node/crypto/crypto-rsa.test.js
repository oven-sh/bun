// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

// Copied from https://github.com/nodejs/node/blob/dcc2ed944f641004c0339bf76db58ccfefedd138/test/parallel/test-crypto-rsa-dsa.js

const crypto = require("crypto");
const constants = crypto.constants;
const fixtures = require("../test/common/fixtures");

// Test certificates
const certPem = fixtures.readKey("rsa_cert.crt");
const keyPem = fixtures.readKey("rsa_private.pem");
const rsaKeySize = 2048;
const rsaPubPem = fixtures.readKey("rsa_public.pem", "ascii");
const rsaKeyPem = fixtures.readKey("rsa_private.pem", "ascii");
const rsaKeyPemEncrypted = fixtures.readKey("rsa_private_encrypted.pem", "ascii");
const rsaPkcs8KeyPem = fixtures.readKey("rsa_private_pkcs8.pem");

const ec = new TextEncoder();

const decryptError = {
  message: expect.any(String),
};

function getBufferCopy(buf) {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

describe("RSA encryption/decryption", () => {
  const input = "I AM THE WALRUS";
  const bufferToEncrypt = Buffer.from(input);
  const bufferPassword = Buffer.from("password");

  let encryptedBuffer;
  let otherEncrypted;

  beforeAll(() => {
    encryptedBuffer = crypto.publicEncrypt(rsaPubPem, bufferToEncrypt);

    const ab = getBufferCopy(ec.encode(rsaPubPem));
    const ab2enc = getBufferCopy(bufferToEncrypt);

    crypto.publicEncrypt(ab, ab2enc);
    crypto.publicEncrypt(new Uint8Array(ab), new Uint8Array(ab2enc));
    crypto.publicEncrypt(new DataView(ab), new DataView(ab2enc));
    otherEncrypted = crypto.publicEncrypt(
      {
        key: Buffer.from(ab).toString("hex"),
        encoding: "hex",
      },
      Buffer.from(ab2enc).toString("hex"),
    );
  });

  test("privateDecrypt with rsaKeyPem", () => {
    const decryptedBuffer = crypto.privateDecrypt(rsaKeyPem, encryptedBuffer);
    expect(decryptedBuffer.toString()).toBe(input);
  });

  test("privateDecrypt with otherEncrypted", () => {
    const otherDecrypted = crypto.privateDecrypt(rsaKeyPem, otherEncrypted);
    expect(otherDecrypted.toString()).toBe(input);
  });

  test("privateDecrypt with rsaPkcs8KeyPem", () => {
    const decryptedBuffer = crypto.privateDecrypt(rsaPkcs8KeyPem, encryptedBuffer);
    expect(decryptedBuffer.toString()).toBe(input);
  });

  test("privateDecrypt with password", () => {
    const decryptedBufferWithPassword = crypto.privateDecrypt(
      {
        key: rsaKeyPemEncrypted,
        passphrase: "password",
      },
      encryptedBuffer,
    );
    expect(decryptedBufferWithPassword.toString()).toBe(input);

    const otherDecryptedBufferWithPassword = crypto.privateDecrypt(
      {
        key: rsaKeyPemEncrypted,
        passphrase: ec.encode("password"),
      },
      encryptedBuffer,
    );
    expect(otherDecryptedBufferWithPassword.toString()).toBe(decryptedBufferWithPassword.toString());
  });

  test("publicEncrypt and privateDecrypt with password", () => {
    const encryptedBuffer = crypto.publicEncrypt(
      {
        key: rsaKeyPemEncrypted,
        passphrase: "password",
      },
      bufferToEncrypt,
    );

    const decryptedBufferWithPassword = crypto.privateDecrypt(
      {
        key: rsaKeyPemEncrypted,
        passphrase: "password",
      },
      encryptedBuffer,
    );
    expect(decryptedBufferWithPassword.toString()).toBe(input);
  });

  test("privateEncrypt and publicDecrypt with buffer password", () => {
    const encryptedBuffer = crypto.privateEncrypt(
      {
        key: rsaKeyPemEncrypted,
        passphrase: bufferPassword,
      },
      bufferToEncrypt,
    );

    const decryptedBufferWithPassword = crypto.publicDecrypt(
      {
        key: rsaKeyPemEncrypted,
        passphrase: bufferPassword,
      },
      encryptedBuffer,
    );
    expect(decryptedBufferWithPassword.toString()).toBe(input);
  });

  test("privateEncrypt and publicDecrypt with RSA_PKCS1_PADDING", () => {
    const encryptedBuffer = crypto.privateEncrypt(
      {
        padding: crypto.constants.RSA_PKCS1_PADDING,
        key: rsaKeyPemEncrypted,
        passphrase: bufferPassword,
      },
      bufferToEncrypt,
    );

    const decryptedBufferWithPassword = crypto.publicDecrypt(
      {
        padding: crypto.constants.RSA_PKCS1_PADDING,
        key: rsaKeyPemEncrypted,
        passphrase: bufferPassword,
      },
      encryptedBuffer,
    );
    expect(decryptedBufferWithPassword.toString()).toBe(input);

    const decryptedBufferWithoutPadding = crypto.publicDecrypt(
      {
        key: rsaKeyPemEncrypted,
        passphrase: bufferPassword,
      },
      encryptedBuffer,
    );
    expect(decryptedBufferWithoutPadding.toString()).toBe(input);
  });

  test("publicEncrypt and privateDecrypt with certPem and keyPem", () => {
    const encryptedBuffer = crypto.publicEncrypt(certPem, bufferToEncrypt);
    const decryptedBuffer = crypto.privateDecrypt(keyPem, encryptedBuffer);
    expect(decryptedBuffer.toString()).toBe(input);
  });

  test("publicEncrypt and privateDecrypt with keyPem", () => {
    const encryptedBuffer = crypto.publicEncrypt(keyPem, bufferToEncrypt);
    const decryptedBuffer = crypto.privateDecrypt(keyPem, encryptedBuffer);
    expect(decryptedBuffer.toString()).toBe(input);
  });

  test("privateEncrypt and publicDecrypt with keyPem", () => {
    const encryptedBuffer = crypto.privateEncrypt(keyPem, bufferToEncrypt);
    const decryptedBuffer = crypto.publicDecrypt(keyPem, encryptedBuffer);
    expect(decryptedBuffer.toString()).toBe(input);
  });

  test("privateDecrypt with wrong password", () => {
    expect(() => {
      crypto.privateDecrypt(
        {
          key: rsaKeyPemEncrypted,
          passphrase: "wrong",
        },
        bufferToEncrypt,
      );
    }).toThrow(expect.objectContaining(decryptError));
  });

  test("publicEncrypt with wrong password", () => {
    expect(() => {
      crypto.publicEncrypt(
        {
          key: rsaKeyPemEncrypted,
          passphrase: "wrong",
        },
        encryptedBuffer,
      );
    }).toThrow(expect.objectContaining(decryptError));
  });

  test("publicDecrypt with wrong password", () => {
    const encryptedBuffer = crypto.privateEncrypt(
      {
        key: rsaKeyPemEncrypted,
        passphrase: Buffer.from("password"),
      },
      bufferToEncrypt,
    );

    expect(() => {
      crypto.publicDecrypt(
        {
          key: rsaKeyPemEncrypted,
          passphrase: Buffer.from("wrong"),
        },
        encryptedBuffer,
      );
    }).toThrow(expect.objectContaining(decryptError));
  });
});

function test_rsa(padding, encryptOaepHash, decryptOaepHash, exceptionThrown) {
  const size = padding === "RSA_NO_PADDING" ? rsaKeySize / 8 : 32;
  const input = Buffer.allocUnsafe(size);
  for (let i = 0; i < input.length; i++) input[i] = (i * 7 + 11) & 0xff;
  const bufferToEncrypt = Buffer.from(input);

  padding = constants[padding];

  const encryptedBuffer = crypto.publicEncrypt(
    {
      key: rsaPubPem,
      padding: padding,
      oaepHash: encryptOaepHash,
    },
    bufferToEncrypt,
  );

  if (padding === constants.RSA_PKCS1_PADDING) {
    expect(() => {
      crypto.privateDecrypt(
        {
          key: rsaKeyPem,
          padding: padding,
          oaepHash: decryptOaepHash,
        },
        encryptedBuffer,
      );
    }).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }));

    expect(() => {
      crypto.privateDecrypt(
        {
          key: rsaPkcs8KeyPem,
          padding: padding,
          oaepHash: decryptOaepHash,
        },
        encryptedBuffer,
      );
    }).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }));
  } else {
    const decryptedBuffer = crypto.privateDecrypt(
      {
        key: rsaKeyPem,
        padding: padding,
        oaepHash: decryptOaepHash,
      },
      encryptedBuffer,
    );
    expect(decryptedBuffer).toEqual(input);

    const decryptedBufferPkcs8 = crypto.privateDecrypt(
      {
        key: rsaPkcs8KeyPem,
        padding: padding,
        oaepHash: decryptOaepHash,
      },
      encryptedBuffer,
    );
    expect(decryptedBufferPkcs8).toEqual(input);
  }
}

test(`RSA with RSA_NO_PADDING`, () => {
  test_rsa("RSA_NO_PADDING");
});

test(`RSA with RSA_PKCS1_PADDING`, () => {
  test_rsa("RSA_PKCS1_PADDING");
});

test(`RSA with RSA_PKCS1_OAEP_PADDING`, () => {
  test_rsa("RSA_PKCS1_OAEP_PADDING");
  test_rsa("RSA_PKCS1_OAEP_PADDING", undefined, "sha1");
  test_rsa("RSA_PKCS1_OAEP_PADDING", "sha1", undefined);
  test_rsa("RSA_PKCS1_OAEP_PADDING", "sha256", "sha256");
  test_rsa("RSA_PKCS1_OAEP_PADDING", "sha512", "sha512");
});

test(`RSA with hash mismatch`, () => {
  expect(() => {
    test_rsa("RSA_PKCS1_OAEP_PADDING", "sha256", "sha512");
  }).toThrow(expect.objectContaining(decryptError));
});

test("RSA-OAEP test vectors", () => {
  const { decryptionTests } = JSON.parse(fixtures.readSync("rsa-oaep-test-vectors.js", "utf8"));

  for (const { ct, oaepHash, oaepLabel } of decryptionTests) {
    const label = oaepLabel ? Buffer.from(oaepLabel, "hex") : undefined;
    const copiedLabel = oaepLabel ? getBufferCopy(label) : undefined;

    const decrypted = crypto.privateDecrypt(
      {
        key: rsaPkcs8KeyPem,
        oaepHash,
        oaepLabel: oaepLabel ? label : undefined,
      },
      Buffer.from(ct, "hex"),
    );

    expect(decrypted.toString("utf8")).toBe("Hello Node.js");

    const otherDecrypted = crypto.privateDecrypt(
      {
        key: rsaPkcs8KeyPem,
        oaepHash,
        oaepLabel: copiedLabel,
      },
      Buffer.from(ct, "hex"),
    );

    expect(otherDecrypted.toString("utf8")).toBe("Hello Node.js");
  }
});

describe("Invalid oaepHash and oaepLabel options", () => {
  const testCases = [
    { fn: crypto.publicEncrypt, name: "publicEncrypt", key: rsaPubPem },
    { fn: crypto.privateDecrypt, name: "privateDecrypt", key: rsaKeyPem },
  ];

  testCases.forEach(({ fn, name, key }) => {
    test(`${name} with invalid oaepHash`, () => {
      expect(() => {
        fn(
          {
            key,
            oaepHash: "Hello world",
          },
          Buffer.alloc(10),
        );
      }).toThrow(
        expect.objectContaining({
          code: "ERR_OSSL_EVP_INVALID_DIGEST",
        }),
      );

      [0, false, null, Symbol(), () => {}].forEach(oaepHash => {
        expect(() => {
          fn(
            {
              key,
              oaepHash,
            },
            Buffer.alloc(10),
          );
        }).toThrow(
          expect.objectContaining({
            code: "ERR_INVALID_ARG_TYPE",
          }),
        );
      });
    });

    test(`${name} with invalid oaepLabel`, () => {
      [0, false, null, Symbol(), () => {}, {}].forEach(oaepLabel => {
        expect(() => {
          fn(
            {
              key,
              oaepLabel,
            },
            Buffer.alloc(10),
          );
        }).toThrow(
          expect.objectContaining({
            code: "ERR_INVALID_ARG_TYPE",
          }),
        );
      });
    });
  });
});
