import { CryptoHasher, MD4, MD5, SHA1, SHA224, SHA256, SHA384, SHA512, SHA512_256, gc } from "bun";
import { describe, expect, it } from "bun:test";
import crypto from "crypto";
import { bunEnv, bunExe, tmpdirSync } from "harness";
import path from "path";
import { hashesFixture } from "./fixtures/sign.fixture.ts";
const HashClasses = [MD5, MD4, SHA1, SHA224, SHA256, SHA384, SHA512, SHA512_256];

describe("CryptoHasher", () => {
  it("CryptoHasher.algorithms", () => {
    expect(CryptoHasher.algorithms).toEqual([
      "blake2b256",
      "blake2b512",
      "blake2s256",
      "md4",
      "md5",
      "ripemd160",
      "sha1",
      "sha224",
      "sha256",
      "sha384",
      "sha512",
      "sha512-224",
      "sha512-256",
      "sha3-224",
      "sha3-256",
      "sha3-384",
      "sha3-512",
      "shake128",
      "shake256",
    ]);
  });

  // prettier-ignore
  const expected = {
    blake2b256: "256c83b297114d201b30179f3f0ef0cace9783622da5974326b436178aeef610",
    blake2b512: "021ced8799296ceca557832ab941a50b4a11f83478cf141f51f933f653ab9fbcc05a037cddbed06e309bf334942c4e58cdf1a46e237911ccd7fcf9787cbc7fd0",
    blake2s256: "9aec6806794561107e594b1f6a8a6b0c92a0cba9acf5e5e93cca06f781813b0b",
    md4: "aa010fbc1d14c795d86ef98c95479d17",
    md5: "5eb63bbbe01eeed093cb22bb8f5acdc3",
    ripemd160: "98c615784ccb5fe5936fbc0cbe9dfdb408d92f0f",
    sha1: "2aae6c35c94fcfb415dbe95f408b9ce91ee846ed",
    sha224: "2f05477fc24bb4faefd86517156dafdecec45b8ad3cf2522a563582b",
    sha256: "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
    sha384: "fdbd8e75a67f29f701a4e040385e2e23986303ea10239211af907fcbb83578b3e417cb71ce646efd0819dd8c088de1bd",
    sha512: "309ecc489c12d6eb4cc40f50c902f2b4d0ed77ee511a7c7a9bcd3ca86d4cd86f989dd35bc5ff499670da34255b45b0cfd830e81f605dcf7dc5542e93ae9cd76f",
    "sha512-224": "22e0d52336f64a998085078b05a6e37b26f8120f43bf4db4c43a64ee",
    "sha512-256": "0ac561fac838104e3f2e4ad107b4bee3e938bf15f2b15f009ccccd61a913f017",
    "sha3-224": "dfb7f18c77e928bb56faeb2da27291bd790bc1045cde45f3210bb6c5",
    "sha3-256": "644bcc7e564373040999aac89e7622f3ca71fba1d972fd94a31c3bfbf24e3938",
    "sha3-384": "83bff28dde1b1bf5810071c6643c08e5b05bdb836effd70b403ea8ea0a634dc4997eb1053aa3593f590f9c63630dd90b",
    "sha3-512": "840006653e9ac9e95117a15c915caab81662918e925de9e004f774ff82d7079a40d4d27b1b372657c61d46d470304c88c788b3a4527ad074d1dccbee5dbaa99a",
    shake128: "3a9159f071e4dd1c8c4f968607c30942",
    shake256: "369771bb2cb9d2b04c1d54cca487e372d9f187f73f7ba3f65b95c8ee7798c527",
  } as const;

  const expectedBitLength = {
    blake2b256: 256,
    blake2b512: 512,
    blake2s256: 256,
    md4: 128,
    md5: 128,
    ripemd160: 160,
    sha1: 160,
    sha224: 224,
    sha256: 256,
    sha384: 384,
    sha512: 512,
    "sha512-224": 224,
    "sha512-256": 256,
    "sha3-224": 224,
    "sha3-256": 256,
    "sha3-384": 384,
    "sha3-512": 512,
    shake128: 128,
    shake256: 256,
  } as const;

  for (const algorithm of CryptoHasher.algorithms) {
    it(`new CryptoHasher ${algorithm}`, () => {
      var hasher = new CryptoHasher(algorithm);
      expect(hasher.algorithm).toEqual(algorithm);
      expect(hasher.byteLength).toEqual(expectedBitLength[algorithm] / 8);
      hasher.update("hello world");
      expect(hasher.digest("hex")).toEqual(expected[algorithm]);
    });

    it(`CryptoHasher.hash ${algorithm}`, () => {
      expect(CryptoHasher.hash(algorithm, "hello world").toString("hex")).toEqual(expected[algorithm]);
    });

    it(`new CryptoHasher ${algorithm} multi-part`, () => {
      var hasher = new CryptoHasher(algorithm);
      hasher.update("hello ");
      hasher.update("world");
      expect(hasher.digest("hex")).toBe(expected[algorithm]);
      expect(hasher.algorithm).toBe(algorithm);
    });

    it(`new CryptoHasher ${algorithm} to Buffer`, () => {
      var hasher = new CryptoHasher(algorithm);
      expect(hasher.algorithm).toEqual(algorithm);
      hasher.update("hello world");
      expect(hasher.digest()).toEqual(Buffer.from(expected[algorithm], "hex"));
    });
  }

  it("CryptoHasher resets when digest is called", () => {
    var hasher = new CryptoHasher("sha256");
    hasher.update("hello");
    expect(hasher.digest("hex")).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
    hasher.update("world");
    expect(hasher.digest("hex")).toBe("486ea46224d1bb4fb680f34f7c9ad96a8f24ec88be73ea8e5a6c65260e9cb8a7");
  });

  for (let alg of CryptoHasher.algorithms) {
    it(`CryptoHasher ${alg} copy is the same`, () => {
      const orig = new CryptoHasher(alg);
      orig.update("hello");
      const copy = orig.copy();

      expect(copy.digest("hex")).toBe(orig.digest("hex"));
      expect(copy.algorithm).toBe(orig.algorithm);
    });

    it(`CryptoHasher ${alg} copy is not linked`, () => {
      const orig = new CryptoHasher(alg);
      orig.update("hello");
      const copy = orig.copy();

      orig.update("world");
      expect(copy.digest("hex")).not.toBe(orig.digest("hex"));
    });

    it(`CryptoHasher ${alg} copy can be used after digest()`, () => {
      const orig = new CryptoHasher(alg);
      orig.update("hello");
      orig.digest("hex");
      const copy = orig.copy();

      expect(() => copy.digest("hex")).not.toThrow();
    });

    it(`CryptoHasher ${alg} copy updates the same`, () => {
      const orig = new CryptoHasher(alg);
      orig.update("hello");
      const copy = orig.copy();

      orig.update("world");
      copy.update("world");
      expect(copy.digest("hex")).toBe(orig.digest("hex"));
    });
  }
});

describe("crypto.getCurves", () => {
  it("should return an array of strings", () => {
    expect(Array.isArray(crypto.getCurves())).toBe(true);
    expect(typeof crypto.getCurves()[0]).toBe("string");
  });
});

describe("chacha20-poly1305", () => {
  // RFC 8439, section 2.8.2.
  const key = Buffer.from("808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f", "hex");
  const iv = Buffer.from("070000004041424344454647", "hex");
  const aad = Buffer.from("50515253c0c1c2c3c4c5c6c7", "hex");
  const plaintext = Buffer.from(
    "Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it.",
  );
  const ciphertext = Buffer.from(
    "d31a8d34648e60db7b86afbc53ef7ec2a4aded51296e08fea9e2b5a736ee62d6" +
      "3dbea45e8ca9671282fafb69da92728b1a71de0a9e060b2905d6a5b67ecd3b36" +
      "92ddbd7f2d778b8c9803aee328091b58fab324e4fad675945585808b4831d7bc" +
      "3ff4def08e4b7a9de576d26586cec64b6116",
    "hex",
  );
  const authTag = Buffer.from("1ae10b594f09e26a7e902ecbd0600691", "hex");

  it("is listed by getCiphers()", () => {
    expect(crypto.getCiphers()).toContain("chacha20-poly1305");
  });

  it("is described by getCipherInfo()", () => {
    const { mode, name, keyLength, ivLength } = crypto.getCipherInfo("chacha20-poly1305")!;
    expect({ mode, name, keyLength, ivLength }).toEqual({
      mode: "stream",
      name: "chacha20-poly1305",
      keyLength: 32,
      ivLength: 12,
    });
  });

  it("encrypts the RFC 8439 vector", () => {
    const cipher = crypto.createCipheriv("chacha20-poly1305", key, iv, { authTagLength: 16 });
    cipher.setAAD(aad);
    const out = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    expect(out.toString("hex")).toBe(ciphertext.toString("hex"));
    expect(cipher.getAuthTag().toString("hex")).toBe(authTag.toString("hex"));
  });

  it("decrypts the RFC 8439 vector", () => {
    const decipher = crypto.createDecipheriv("chacha20-poly1305", key, iv, { authTagLength: 16 });
    decipher.setAAD(aad);
    decipher.setAuthTag(authTag);
    const out = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    expect(out.toString("utf8")).toBe(plaintext.toString("utf8"));
  });

  it("defaults authTagLength to 16 bytes", () => {
    const cipher = crypto.createCipheriv("chacha20-poly1305", key, iv);
    cipher.update(plaintext);
    cipher.final();
    expect(cipher.getAuthTag().length).toBe(16);
  });

  // ChaCha20 keeps 64-byte keystream blocks, so chunks that straddle a block
  // boundary are the interesting case.
  for (const chunkSize of [1, 7, 16, 31, 63, 64, 65, 127, 128]) {
    it(`produces the same output in ${chunkSize}-byte chunks`, () => {
      const cipher = crypto.createCipheriv("chacha20-poly1305", key, iv, { authTagLength: 16 });
      cipher.setAAD(aad);
      const chunks: Buffer[] = [];
      for (let i = 0; i < plaintext.length; i += chunkSize) {
        const chunk = plaintext.subarray(i, i + chunkSize);
        const out = cipher.update(chunk);
        // A stream cipher emits exactly as many bytes as it is fed.
        expect(out.length).toBe(chunk.length);
        chunks.push(out);
      }
      const final = cipher.final();
      expect(final.length).toBe(0);
      chunks.push(final);
      expect(Buffer.concat(chunks).toString("hex")).toBe(ciphertext.toString("hex"));
      expect(cipher.getAuthTag().toString("hex")).toBe(authTag.toString("hex"));

      const decipher = crypto.createDecipheriv("chacha20-poly1305", key, iv, { authTagLength: 16 });
      decipher.setAAD(aad);
      decipher.setAuthTag(authTag);
      const plain: Buffer[] = [];
      for (let i = 0; i < ciphertext.length; i += chunkSize) {
        plain.push(decipher.update(ciphertext.subarray(i, i + chunkSize)));
      }
      plain.push(decipher.final());
      expect(Buffer.concat(plain).toString("utf8")).toBe(plaintext.toString("utf8"));
    });
  }

  it("round-trips an empty message", () => {
    const cipher = crypto.createCipheriv("chacha20-poly1305", key, iv);
    expect(cipher.final().length).toBe(0);
    const tag = cipher.getAuthTag();

    const decipher = crypto.createDecipheriv("chacha20-poly1305", key, iv);
    decipher.setAuthTag(tag);
    expect(decipher.final().length).toBe(0);
  });

  it("round-trips additional data that is not a multiple of 16 bytes", () => {
    const oddAad = Buffer.from("0102030405", "hex");
    const cipher = crypto.createCipheriv("chacha20-poly1305", key, iv);
    cipher.setAAD(oddAad);
    const out = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    // The AAD is not encrypted, so only the tag changes.
    expect(out.toString("hex")).toBe(ciphertext.toString("hex"));

    const decipher = crypto.createDecipheriv("chacha20-poly1305", key, iv);
    decipher.setAAD(oddAad);
    decipher.setAuthTag(cipher.getAuthTag());
    expect(Buffer.concat([decipher.update(out), decipher.final()]).toString("utf8")).toBe(plaintext.toString("utf8"));
  });

  it("rejects a corrupted authentication tag", () => {
    const tampered = Buffer.from(authTag);
    tampered[0] ^= 1;
    const decipher = crypto.createDecipheriv("chacha20-poly1305", key, iv, { authTagLength: 16 });
    decipher.setAAD(aad);
    decipher.setAuthTag(tampered);
    decipher.update(ciphertext);
    expect(() => decipher.final()).toThrow("Unsupported state or unable to authenticate data");
  });

  it("rejects corrupted ciphertext", () => {
    const tampered = Buffer.from(ciphertext);
    tampered[0] ^= 1;
    const decipher = crypto.createDecipheriv("chacha20-poly1305", key, iv, { authTagLength: 16 });
    decipher.setAAD(aad);
    decipher.setAuthTag(authTag);
    decipher.update(tampered);
    expect(() => decipher.final()).toThrow("Unsupported state or unable to authenticate data");
  });

  it("rejects corrupted additional data", () => {
    const tampered = Buffer.from(aad);
    tampered[0] ^= 1;
    const decipher = crypto.createDecipheriv("chacha20-poly1305", key, iv, { authTagLength: 16 });
    decipher.setAAD(tampered);
    decipher.setAuthTag(authTag);
    decipher.update(ciphertext);
    expect(() => decipher.final()).toThrow("Unsupported state or unable to authenticate data");
  });

  // Node releases unauthenticated plaintext here for this cipher, unlike every
  // other AEAD it exposes. Fail instead.
  it("rejects decryption without an authentication tag", () => {
    const decipher = crypto.createDecipheriv("chacha20-poly1305", key, iv, { authTagLength: 16 });
    decipher.setAAD(aad);
    decipher.update(ciphertext);
    expect(() => decipher.final()).toThrow("Unsupported state or unable to authenticate data");
  });

  it("honours a truncated authTagLength", () => {
    for (let authTagLength = 1; authTagLength <= 16; authTagLength++) {
      const cipher = crypto.createCipheriv("chacha20-poly1305", key, iv, { authTagLength });
      cipher.setAAD(aad);
      const out = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      expect(out.toString("hex")).toBe(ciphertext.toString("hex"));
      const tag = cipher.getAuthTag();
      expect(tag.toString("hex")).toBe(authTag.subarray(0, authTagLength).toString("hex"));

      const decipher = crypto.createDecipheriv("chacha20-poly1305", key, iv, { authTagLength });
      decipher.setAAD(aad);
      decipher.setAuthTag(tag);
      expect(Buffer.concat([decipher.update(out), decipher.final()]).toString("utf8")).toBe(plaintext.toString("utf8"));
    }
  });

  it("rejects an authentication tag of the wrong length", () => {
    const decipher = crypto.createDecipheriv("chacha20-poly1305", key, iv, { authTagLength: 12 });
    expect(() => decipher.setAuthTag(authTag)).toThrow("Invalid authentication tag length: 16");
  });

  it("rejects additional data after the first update()", () => {
    const cipher = crypto.createCipheriv("chacha20-poly1305", key, iv);
    cipher.update(plaintext);
    expect(() => cipher.setAAD(aad)).toThrow(expect.objectContaining({ code: "ERR_CRYPTO_INVALID_STATE" }));
  });

  it("requires a 96-bit nonce", () => {
    for (const ivLength of [0, 1, 8, 11, 13, 16, 24]) {
      expect(() => crypto.createCipheriv("chacha20-poly1305", key, Buffer.alloc(ivLength))).toThrow(
        expect.objectContaining({ code: "ERR_CRYPTO_INVALID_IV" }),
      );
    }
  });

  it("requires a 256-bit key", () => {
    for (const keyLength of [16, 24, 31, 33]) {
      expect(() => crypto.createCipheriv("chacha20-poly1305", Buffer.alloc(keyLength), iv)).toThrow(
        expect.objectContaining({ code: "ERR_CRYPTO_INVALID_KEYLEN" }),
      );
    }
  });

  it("rejects an out-of-range authTagLength", () => {
    for (const authTagLength of [0, 17, 32]) {
      expect(() => crypto.createCipheriv("chacha20-poly1305", key, iv, { authTagLength })).toThrow(
        `Invalid authentication tag length: ${authTagLength}`,
      );
    }
  });
});

describe("crypto", () => {
  for (let Hash of HashClasses) {
    for (let [input, label] of [
      ["hello world", '"hello world"'],
      ["hello world".repeat(20).slice(), '"hello world" x 20'],
      ["", "empty string"],
      ["a", '"a"'],
    ]) {
      describe(label, () => {
        gc(true);

        it(`${Hash.name} base64`, () => {
          gc(true);
          const result = new Hash();
          result.update(input);
          expect(typeof result.digest("base64")).toBe("string");
          gc(true);
        });

        it(`${Hash.name} hash base64`, () => {
          Hash.hash(input, "base64");
          gc(true);
        });

        it(`${Hash.name} hex`, () => {
          const result = new Hash();
          result.update(input);
          expect(typeof result.digest("hex")).toBe("string");
          gc(true);
        });

        it(`${Hash.name} hash hex`, () => {
          expect(typeof Hash.hash(input, "hex")).toBe("string");
          gc(true);
        });

        it(`${Hash.name} buffer`, () => {
          var buf = new Uint8Array(256);
          const result = new Hash();

          result.update(input);
          expect(result.digest(buf)).toBe(buf);
          expect(buf[0] != 0).toBe(true);
          gc(true);
        });

        it(`${Hash.name} buffer`, () => {
          var buf = new Uint8Array(256);

          expect(Hash.hash(input, buf) instanceof Uint8Array).toBe(true);
          gc(true);
        });
      });
    }
  }
});

describe("crypto.createSign()/.verifySign()", () => {
  it.each(hashesFixture)(
    "should create and verify digital signature for %s",
    async (alg, privKey, pubKey, expectedSign) => {
      const p = await Bun.file(`${__dirname}/${privKey}`).text();
      const sign = crypto.createSign(alg).update("text").sign(p, "base64");

      expect(sign).toEqual(expectedSign);

      const verify = crypto
        .createVerify(alg)
        .update("text")
        .verify(await Bun.file(`${__dirname}/${pubKey}`).text(), sign, "base64");
      expect(verify).toBeTrue();
    },
  );
});

it("should send cipher events in the right order", async () => {
  const package_dir = tmpdirSync();
  const fixture_path = path.join(package_dir, "fixture.js");

  await Bun.write(
    fixture_path,
    String.raw`
    function patchEmitter(emitter, prefix) {
      var oldEmit = emitter.emit;

      emitter.emit = function () {
        console.log([prefix, arguments[0]]);
        oldEmit.apply(emitter, arguments);
      };
    }

    const crypto = require("node:crypto");

    const plaintext = "Out of the mountain of despair, a stone of hope.";

    const key = Buffer.from("3fad401bb178066f201b55368712530229d6329a5e2c05f48ff36ca65792d21d", "hex");
    const iv = Buffer.from("22371787d3e04a6589d8a1de50c81208", "hex");

    // Since Node 26, read() with no size returns one buffered chunk at a time,
    // so drain the stream instead of assuming a single read returns everything.
    function readAll(stream) {
      const chunks = [];
      for (let chunk; (chunk = stream.read()) !== null; ) chunks.push(chunk);
      return Buffer.concat(chunks);
    }

    const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
    patchEmitter(cipher, "cipher");
    cipher.end(plaintext);
    let ciph = readAll(cipher);
    console.log([1, ciph.toString("hex")]);

    const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
    patchEmitter(decipher, "decipher");
    decipher.end(ciph);
    let dciph = readAll(decipher);
    console.log([2, dciph.toString("hex")]);
    let txt = dciph.toString("utf8");

    console.log([3, plaintext]);
    console.log([4, txt]);
    `,
  );

  const { stdout, stderr } = Bun.spawn({
    cmd: [bunExe(), "run", fixture_path],
    stdout: "pipe",
    stdin: "ignore",
    stderr: "pipe",
    env: bunEnv,
  });
  const err = await stderr.text();
  expect(err).toBeEmpty();
  const out = await stdout.text();
  // Matches Node 26 output for the same fixture (verified byte-for-byte
  // modulo quote style).
  expect(out.split("\n")).toEqual([
    `[ "cipher", "readable" ]`,
    `[ "cipher", "prefinish" ]`,
    `[ "cipher", "data" ]`,
    `[ "cipher", "data" ]`,
    `[ 1, "dfb6b7e029be3ad6b090349ed75931f28f991b52ca9a89f5bf6f82fa1c87aa2d624bd77701dcddfcceaf3add7d66ce06ced17aebca4cb35feffc4b8b9008b3c4" ]`,
    `[ "decipher", "readable" ]`,
    `[ "decipher", "prefinish" ]`,
    `[ "decipher", "data" ]`,
    `[ 2, "4f7574206f6620746865206d6f756e7461696e206f6620646573706169722c20612073746f6e65206f6620686f70652e" ]`,
    `[ 3, "Out of the mountain of despair, a stone of hope." ]`,
    `[ 4, "Out of the mountain of despair, a stone of hope." ]`,
    `[ "cipher", "finish" ]`,
    `[ "cipher", "end" ]`,
    `[ "decipher", "finish" ]`,
    `[ "decipher", "end" ]`,
    `[ "cipher", "close" ]`,
    `[ "decipher", "close" ]`,
    ``,
  ]);
});
