import { CryptoHasher, MD4, MD5, SHA1, SHA224, SHA256, SHA384, SHA512, SHA512_256, gc } from "bun";
import { describe, expect, it, test } from "bun:test";
import crypto from "crypto";
import { readFileSync } from "fs";
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

describe("SHA-3 sign/verify", () => {
  const digests = ["sha3-224", "sha3-256", "sha3-384", "sha3-512"];
  const message = Buffer.from("sha3 signature conformance");
  const fixture = (name: string) => readFileSync(`${__dirname}/fixtures/${name}`, "utf8");

  const rsaPrivate = fixture("rsa_private_2048.pem");
  const rsaPublic = fixture("rsa_public_2048.pem");
  const ecPrivate = fixture("ec_p256_private.pem");
  const ecPublic = fixture("ec_p256_public.pem");

  // Signatures produced by Node.js (OpenSSL) over `message` with the fixtures
  // above. RSA PKCS#1 v1.5 is deterministic, so these pin the exact DigestInfo
  // encoding rather than just proving we can verify what we sign.
  const rsaPkcs1: Record<string, string> = {
    "sha3-224":
      "cwg74JeWAJXCefVOYQgIxnlbFi3m1SffbUkF0IULmqNsveVeTaJCGFIVHw2b7GkxbkoWZ8wqBf5dNkcS3KuwPqg2qqPCXQ6lec5kr9guPML8ElsxC5lHtggHqGYmx+sVKSBQCikhkOIr0KrpiHFbYFeObmThMJGAHdoq5jag/AQMdgTCYT+4dvnFtNqrgzZIlkw9NRkGcARA7UubOpxGI3y6zk8VEQU7RTbftdrah5y4s28TskKvGlqRNGrW/5/v5gcau+9JE9K+Q6AP0NmjEkMxEX5yWMA8LxMFCrMYFDRKqwkE78LD1k787c7Q3I6fRFDShWFlpyWrY+TLF+XJpg==",
    "sha3-256":
      "k3SvWv55Mc5CiM/gzYvRhWvpGz3viwy4eCmjioa4WB/BlEoINJLpZvVd5YwX/y3X2/4Ty6Iepebb1/v2DdoMReNAva18eziMdFSiTtnGmmx+p21jySrDxFAv/bQJBQFEXVMv8S62wlCo93X+qHMGl5KG/dvrDZDz571pjfjI+AchRZcpPO70GPY8fQ0e8IB7Mu0PqEXgRS7aF1C/J4hFciC4iO6w6GOnnn/SGp/QiP0+26g3yGDXGUIpyYjI9dcRAW2ZXwmhwTMB5ub421WwbZTDtVst+irnvnGFXmzEfiKq0bRmTXFtOfoToAjhWOkaiBju4QxBlzPALEzawj6Ofg==",
    "sha3-384":
      "XGbLh+G95zyRZBTFV2Xd5wJkySWVhe/Rrepp+w9vAxAAkyaCLFYzHdvmGGfFq6iD9aUNSf8OPmoZlsGdmE2NN7cUS6G2npk89oLu14HAs+UhBXGf476YKXPuGOC92Poqu9QTZOE+x0ez1QcPLW3o8Z0Uc4lklLwQJnfxsdCG3Dd24WR1xG352Db6iGl6KO01WRLH8YC0M3rkc4+I6a7sJRtXrnxpkepK/fDxnw9cZEdZZ0wX2a7E+q4fG13NvNVBDOpfU/kUjz5X27wmveq+FPqFl2FWTsryBC/FawItCMCJJU7Aj3CNAAoj1FPWBowErKRua62an0tmOC+bLruXvA==",
    "sha3-512":
      "o1KRgi1cc3DdEfUUZZMMo+G+/Bvq48JtU/Q3mx7dCtwR5utC8XpgWzpimiHdKVrVPbxoy/G9mdYX+l2m6HbxnwaPrkz1v7WnvODZF6idH85DZysaWDMkjSn/HzsKcHFMQupaOQKe4LPFdYZlgzmTwz0Prp0Pdu1wXFjjWUU/yncCPbEe7QLFPeoSrtIYOBsWm/L1o9OMOzKhLg4KNp6Pf9gKwIiCkf8MzT0gEoiXE3v/g54TAsDFl3pSr5bWBIlaveJUL0LNkRN/jOYFH8DNqtRjadAtwmlxZeXvY6HxBEHFA40UNq7nmrsrTnuQEd7bU+n0xFvDwydY/DtlPtBRqg==",
  };

  // PSS and ECDSA are randomized, so these only exercise the verify path.
  const rsaPss: Record<string, string> = {
    "sha3-224":
      "SnseUwZpHfKQjiYxxGSi3aT+ztuCSFaxzKe63jqr2Xqym5wkXGQkIBImI17wYAGed6n26mzKMzeCWZATF6I9QIsKs0LeB94NMR5czejrHiGCSM1TNfcisYhYGUFE0GLcDmIWCT6KPV6v13UQtlZgBJjuIpia3nhDQe6lg5n2sG991eAMftYhUDxcJtaJgIGCDJ/0JIz326o39xXBVFdRMmh4O4iEUt+5Ze/hoIqabYi6JmVfXucrmVj86CLV6Vfm2TJqGFgwtWS4MuGvLAGPs8wz4WskBezDd3n7n8K89bGis/YP043BLM2b/pn1rNyvKzMBLK6fsx8p7QT6Xy+YaQ==",
    "sha3-256":
      "krVNLzVUZhXhVY0amrYbQXLqN+snC6wfgkeaqQ1YzlyCV7/pBg4pBsUZ7os+TkOCAB98w8EV9UDMiPzMIcWzbOCS5ajRbY3TTsgEw7oZheAst4IOoUfDO+mecLdzd2wPY2ROFKPzQn3Y+U2mrUKy7DKW1XefttW0YmLX8Dvq5C3stZK+HugvokQlcrFQxcQZ5hg/7uKARHNVYzcBF/FoVAO6Z02G9GnWD5I/d/Bx6Te1PV7RBnsEKn6Q/UQassRslUzwism1+aYCOwAXuCfniwznlnW5TKKKcrVy28763Bv7Qxx9l8gqFySjf82gmiaqQTHKbKVnVFCCFsd8783Crg==",
    "sha3-384":
      "RIVSIoiFztt2H8m5H58h+aS2s724SlFyOvvT8+/LaatIIqfnDEi7OZbaBSTtob+QjG4ZaOext8eMx473KppmbxautH+spKSWX2ObPjzN4xuQRFnXCvoO3oDy4kWaIhbfCNr5ZpSDcj+ob66PmNBCw+73CMXxr1RapNyG40nCVbLR4GZmetBMOHMaUfertLI/lbeh0HqPwMs24XMw2f4B5AK/bgVy7EAXj5rIvxIA0wG0mTWMDV9wesqIiL29qrZhJqDGM2VU7/sehw3Tyc3+Ug3+54CvffM9NQpekyVW6W6ygaD2aISV4mwJgZ3r2gbIWoAiOaJUEyLBPCF9ySpi6A==",
    "sha3-512":
      "ovdYhzGTXGxL2yDWnIE78V39FI3ex1io9I/FwLzTYJgShW4q1F1xdCP6OqzcFGKHw/BKbKO28OYH682YCHhW48PvgfJfxF9CKcHg6O4fEAKvQiuJ3sgGY4yiwOpTqeKOgKICBDQJ7H7zhHPINuNMjxrNVwKfaGCGbyum+7vnPDBd32f2MOhVaYZcBRRwaeGUJD3QvKqVL7+u/8fiYFh4nrzGhyJ+K5jVUdAS3U1BsH+UGb/3Ypq6AhX4Vjpwe/Ed8WCFeGO3iiWIKyh1fGWNViWokgKPO4VEfK2Y8w32zbq/DV1y2tPXkaUyEoCWKQYTZeoBzmZ7PRpQi9ugJosIXA==",
  };

  const ecdsa: Record<string, string> = {
    "sha3-224": "MEUCIG5dISk+pWQw9/WdZOIn9rGPtHOcHzpQt3yrSIbl9st3AiEAv7KOnT3qZ+HiuD8ILscMW7qfnZ1WFQvf/uIVskdZiFI=",
    "sha3-256": "MEUCIGS2+YLUUBSo+X75ydaCsPwBgxp8lta06qvsR+tXuiTTAiEAuSIId6BzVqktRWe5kDjvUlQbUPFxzZEdiKPaecH2mXM=",
    "sha3-384": "MEUCIQCBYf0P9HW/S4YYmLZQi6d17Mxs47fPK8M3a2NEh7TLXwIgVjjYG9t6qz2P0gHm/LPj5O/9X2MIpeVodlmerf5+YAY=",
    "sha3-512": "MEUCIFINSe6XmIatanHebPIwsvcYc5JGY8meV/SZD62A53FeAiEAzamJEHod/DFtAQtd+ylU+0413FWUUxQmtf1GsRSzO6Y=",
  };

  describe.each(digests)("%s", digest => {
    test("crypto.sign() and createSign() reproduce OpenSSL's RSA PKCS#1 v1.5 bytes", () => {
      expect({
        oneShot: crypto.sign(digest, message, rsaPrivate).toString("base64"),
        streaming: crypto.createSign(digest).update(message).sign(rsaPrivate, "base64"),
      }).toEqual({ oneShot: rsaPkcs1[digest], streaming: rsaPkcs1[digest] });
    });

    test("crypto.verify() accepts OpenSSL's signatures", () => {
      expect({
        pkcs1: crypto.verify(digest, message, rsaPublic, Buffer.from(rsaPkcs1[digest], "base64")),
        pss: crypto.verify(
          digest,
          message,
          { key: rsaPublic, padding: crypto.constants.RSA_PKCS1_PSS_PADDING },
          Buffer.from(rsaPss[digest], "base64"),
        ),
        ecdsa: crypto.verify(digest, message, ecPublic, Buffer.from(ecdsa[digest], "base64")),
      }).toEqual({ pkcs1: true, pss: true, ecdsa: true });
    });

    test("createVerify() accepts OpenSSL's signatures", () => {
      expect({
        pkcs1: crypto.createVerify(digest).update(message).verify(rsaPublic, rsaPkcs1[digest], "base64"),
        ecdsa: crypto.createVerify(digest).update(message).verify(ecPublic, ecdsa[digest], "base64"),
      }).toEqual({ pkcs1: true, ecdsa: true });
    });

    test("ECDSA signatures round-trip", () => {
      // ECDSA is randomized, so assert a round-trip instead of exact bytes.
      const oneShot = crypto.sign(digest, message, ecPrivate);
      const streaming = crypto.createSign(digest).update(message).sign(ecPrivate);
      expect({
        oneShot: crypto.verify(digest, message, ecPublic, oneShot),
        streaming: crypto.createVerify(digest).update(message).verify(ecPublic, streaming),
      }).toEqual({ oneShot: true, streaming: true });
    });

    test("bad signatures are rejected", () => {
      const tamperedRsa = Buffer.from(rsaPkcs1[digest], "base64");
      tamperedRsa[tamperedRsa.length - 1] ^= 1;
      const tamperedEcdsa = Buffer.from(ecdsa[digest], "base64");
      tamperedEcdsa[tamperedEcdsa.length - 1] ^= 1;

      expect({
        tamperedRsa: crypto.verify(digest, message, rsaPublic, tamperedRsa),
        tamperedEcdsa: crypto.verify(digest, message, ecPublic, tamperedEcdsa),
        wrongMessage: crypto.verify(digest, Buffer.from("other"), rsaPublic, Buffer.from(rsaPkcs1[digest], "base64")),
        wrongDigest: crypto.verify("sha256", message, rsaPublic, Buffer.from(rsaPkcs1[digest], "base64")),
      }).toEqual({ tamperedRsa: false, tamperedEcdsa: false, wrongMessage: false, wrongDigest: false });
    });
  });
});

test("createSign().sign() surfaces the OpenSSL error the way crypto.sign() does", () => {
  // A 512-bit modulus cannot hold a SHA-512 PKCS#1 v1.5 block, so both entry
  // points hit the same OpenSSL failure and must report it the same way.
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 512 });
  const message = Buffer.from("too big for this key");

  const capture = (fn: () => unknown) => {
    try {
      fn();
    } catch (err) {
      return err as Error & { code?: string };
    }
    throw new Error("expected signing to throw");
  };

  const oneShot = capture(() => crypto.sign("sha512", message, privateKey));
  const streaming = capture(() => crypto.createSign("sha512").update(message).sign(privateKey));

  expect(oneShot.code).toMatch(/^ERR_OSSL_/);
  expect({ name: streaming.name, code: streaming.code }).toEqual({ name: oneShot.name, code: oneShot.code });
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
