"use strict";

import {
  createCipheriv,
  createDecipheriv,
  createSign,
  createVerify,
  createSecretKey,
  createPublicKey,
  createPrivateKey,
  KeyObject,
  randomBytes,
  publicDecrypt,
  publicEncrypt,
  privateDecrypt,
  privateEncrypt,
  generateKeyPairSync,
  generateKeySync,
} from "crypto";
import { test, it, expect, describe } from "bun:test";
import fs from "fs";
import path from "path";

const publicPem = fs.readFileSync(path.join(import.meta.dir, "fixtures", "rsa_public.pem"), "ascii");
const privatePem = fs.readFileSync(path.join(import.meta.dir, "fixtures", "rsa_private.pem"), "ascii");
const privateEncryptedPem = fs.readFileSync(
  path.join(import.meta.dir, "fixtures", "rsa_private_encrypted.pem"),
  "ascii",
);

describe("crypto.KeyObjects", () => {
  test("Attempting to create a key using other than CryptoKey should throw", async () => {
    expect(() => new KeyObject("secret", "")).toThrow();
    expect(() => new KeyObject("secret")).toThrow();
    expect(() => KeyObject.from("invalid_key")).toThrow();
  });
  test("basics of createSecretKey should work", async () => {
    const keybuf = randomBytes(32);
    const key = createSecretKey(keybuf);
    expect(key.type).toBe("secret");
    expect(key.toString()).toBe("[object KeyObject]");
    expect(key.symmetricKeySize).toBe(32);
    expect(key.asymmetricKeyType).toBe(undefined);
    expect(key.asymmetricKeyDetails).toBe(undefined);

    const exportedKey = key.export();
    expect(keybuf).toEqual(exportedKey);

    const plaintext = Buffer.from("Hello world", "utf8");

    const cipher = createCipheriv("aes-256-ecb", key, null);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

    const decipher = createDecipheriv("aes-256-ecb", key, null);
    const deciphered = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

    expect(plaintext).toEqual(deciphered);
  });

  test("Passing an existing public key object to createPublicKey should throw", async () => {
    // Passing an existing public key object to createPublicKey should throw.
    const publicKey = createPublicKey(publicPem);
    expect(() => createPublicKey(publicKey)).toThrow();

    // Constructing a private key from a public key should be impossible, even
    // if the public key was derived from a private key.
    expect(() => createPrivateKey(createPublicKey(privatePem))).toThrow();

    // Similarly, passing an existing private key object to createPrivateKey
    // should throw.
    const privateKey = createPrivateKey(privatePem);
    expect(() => createPrivateKey(privateKey)).toThrow();
  });

  test("basics should work", async () => {
    const jwk = {
      e: "AQAB",
      n:
        "t9xYiIonscC3vz_A2ceR7KhZZlDu_5bye53nCVTcKnWd2seY6UAdKersX6njr83Dd5OVe" +
        "1BW_wJvp5EjWTAGYbFswlNmeD44edEGM939B6Lq-_8iBkrTi8mGN4YCytivE24YI0D4XZ" +
        "MPfkLSpab2y_Hy4DjQKBq1ThZ0UBnK-9IhX37Ju_ZoGYSlTIGIhzyaiYBh7wrZBoPczIE" +
        "u6et_kN2VnnbRUtkYTF97ggcv5h-hDpUQjQW0ZgOMcTc8n-RkGpIt0_iM_bTjI3Tz_gsF" +
        "di6hHcpZgbopPL630296iByyigQCPJVzdusFrQN5DeC-zT_nGypQkZanLb4ZspSx9Q",
      d:
        "ktnq2LvIMqBj4txP82IEOorIRQGVsw1khbm8A-cEpuEkgM71Yi_0WzupKktucUeevQ5i0" +
        "Yh8w9e1SJiTLDRAlJz66kdky9uejiWWl6zR4dyNZVMFYRM43ijLC-P8rPne9Fz16IqHFW" +
        "5VbJqA1xCBhKmuPMsD71RNxZ4Hrsa7Kt_xglQTYsLbdGIwDmcZihId9VGXRzvmCPsDRf2" +
        "fCkAj7HDeRxpUdEiEDpajADc-PWikra3r3b40tVHKWm8wxJLivOIN7GiYXKQIW6RhZgH-" +
        "Rk45JIRNKxNagxdeXUqqyhnwhbTo1Hite0iBDexN9tgoZk0XmdYWBn6ElXHRZ7VCDQ",
      p:
        "8UovlB4nrBm7xH-u7XXBMbqxADQm5vaEZxw9eluc-tP7cIAI4sglMIvL_FMpbd2pEeP_B" +
        "kR76NTDzzDuPAZvUGRavgEjy0O9j2NAs_WPK4tZF-vFdunhnSh4EHAF4Ij9kbsUi90NOp" +
        "bGfVqPdOaHqzgHKoR23Cuusk9wFQ2XTV8",
      q:
        "wxHdEYT9xrpfrHPqSBQPpO0dWGKJEkrWOb-76rSfuL8wGR4OBNmQdhLuU9zTIh22pog-X" +
        "PnLPAecC-4yu_wtJ2SPCKiKDbJBre0CKPyRfGqzvA3njXwMxXazU4kGs-2Fg-xu_iKbaI" +
        "jxXrclBLhkxhBtySrwAFhxxOk6fFcPLSs",
      dp:
        "qS_Mdr5CMRGGMH0bKhPUWEtAixUGZhJaunX5wY71Xoc_Gh4cnO-b7BNJ_-5L8WZog0vr" +
        "6PgiLhrqBaCYm2wjpyoG2o2wDHm-NAlzN_wp3G2EFhrSxdOux-S1c0kpRcyoiAO2n29rN" +
        "Da-jOzwBBcU8ACEPdLOCQl0IEFFJO33tl8",
      dq:
        "WAziKpxLKL7LnL4dzDcx8JIPIuwnTxh0plCDdCffyLaT8WJ9lXbXHFTjOvt8WfPrlDP_" +
        "Ylxmfkw5BbGZOP1VLGjZn2DkH9aMiwNmbDXFPdG0G3hzQovx_9fajiRV4DWghLHeT9wzJ" +
        "fZabRRiI0VQR472300AVEeX4vgbrDBn600",
      qi:
        "k7czBCT9rHn_PNwCa17hlTy88C4vXkwbz83Oa-aX5L4e5gw5lhcR2ZuZHLb2r6oMt9rl" +
        "D7EIDItSs-u21LOXWPTAlazdnpYUyw_CzogM_PN-qNwMRXn5uXFFhmlP2mVg2EdELTahX" +
        "ch8kWqHaCSX53yvqCtRKu_j76V31TfQZGM",
      kty: "RSA",
    };
    const publicJwk = { kty: jwk.kty, e: jwk.e, n: jwk.n };

    const publicKey = createPublicKey(publicPem);
    expect(publicKey.type).toBe("public");
    expect(publicKey.toString()).toBe("[object KeyObject]");
    expect(publicKey.asymmetricKeyType).toBe("rsa");
    expect(publicKey.symmetricKeySize).toBe(undefined);

    const privateKey = createPrivateKey(privatePem);
    expect(privateKey.type).toBe("private");
    expect(privateKey.toString()).toBe("[object KeyObject]");
    expect(privateKey.asymmetricKeyType).toBe("rsa");
    expect(privateKey.symmetricKeySize).toBe(undefined);

    // It should be possible to derive a public key from a private key.
    const derivedPublicKey = createPublicKey(privateKey);
    expect(derivedPublicKey.type).toBe("public");
    expect(derivedPublicKey.toString()).toBe("[object KeyObject]");
    expect(derivedPublicKey.asymmetricKeyType).toBe("rsa");
    expect(derivedPublicKey.symmetricKeySize).toBe(undefined);

    const publicKeyFromJwk = createPublicKey({ key: publicJwk, format: "jwk" });
    expect(publicKey.type).toBe("public");
    expect(publicKey.toString()).toBe("[object KeyObject]");
    expect(publicKey.asymmetricKeyType).toBe("rsa");
    expect(publicKey.symmetricKeySize).toBe(undefined);

    const privateKeyFromJwk = createPrivateKey({ key: jwk, format: "jwk" });
    expect(privateKey.type).toBe("private");
    expect(privateKey.toString()).toBe("[object KeyObject]");
    expect(privateKey.asymmetricKeyType).toBe("rsa");
    expect(privateKey.symmetricKeySize).toBe(undefined);

    // It should also be possible to import an encrypted private key as a public
    // key.
    const decryptedKey = createPublicKey({
      key: privateKey.export({
        type: "pkcs8",
        format: "pem",
        passphrase: Buffer.from("123"),
        cipher: "aes-128-cbc",
      }),
      format: "pem",
      passphrase: "123", // this is not documented, but it works
    });
    expect(decryptedKey.type).toBe("public");
    expect(decryptedKey.asymmetricKeyType).toBe("rsa");

    // Exporting the key using JWK should not work since this format does not
    // support key encryption
    expect(() => {
      privateKey.export({ format: "jwk", passphrase: "secret" });
    }).toThrow();

    // Test exporting with an invalid options object, this should throw.
    for (const opt of [undefined, null, "foo", 0, NaN]) {
      expect(() => publicKey.export(opt)).toThrow();
    }

    for (const keyObject of [publicKey, derivedPublicKey, publicKeyFromJwk]) {
      const exported = keyObject.export({ format: "jwk" });
      expect(exported).toBeDefined();
      const { kty, n, e } = exported as { kty: string; n: string; e: string };
      expect({ kty, n, e }).toEqual({ kty: "RSA", n: jwk.n, e: jwk.e });
    }

    for (const keyObject of [privateKey, privateKeyFromJwk]) {
      const exported = keyObject.export({ format: "jwk" });
      expect(exported).toEqual(jwk);
    }

    const publicDER = publicKey.export({
      format: "der",
      type: "pkcs1",
    });

    const privateDER = privateKey.export({
      format: "der",
      type: "pkcs1",
    });

    expect(Buffer.isBuffer(publicDER)).toBe(true);
    expect(Buffer.isBuffer(privateDER)).toBe(true);
    const plaintext = Buffer.from("Hello world", "utf8");

    const testDecryption = (fn, ciphertexts, decryptionKeys) => {
      for (const ciphertext of ciphertexts) {
        for (const key of decryptionKeys) {
          const deciphered = fn(key, ciphertext);
          expect(deciphered).toEqual(plaintext);
        }
      }
    };

    testDecryption(
      privateDecrypt,
      [
        // Encrypt using the public key.
        publicEncrypt(publicKey, plaintext),
        publicEncrypt({ key: publicKey }, plaintext),
        publicEncrypt({ key: publicJwk, format: "jwk" }, plaintext),

        // Encrypt using the private key.
        publicEncrypt(privateKey, plaintext),
        publicEncrypt({ key: privateKey }, plaintext),
        publicEncrypt({ key: jwk, format: "jwk" }, plaintext),

        // Encrypt using a public key derived from the private key.
        publicEncrypt(derivedPublicKey, plaintext),
        publicEncrypt({ key: derivedPublicKey }, plaintext),

        // Test distinguishing PKCS#1 public and private keys based on the
        // DER-encoded data only.
        publicEncrypt({ format: "der", type: "pkcs1", key: publicDER }, plaintext),
        publicEncrypt({ format: "der", type: "pkcs1", key: privateDER }, plaintext),
      ],
      [
        privateKey,
        { format: "pem", key: privatePem },
        { format: "der", type: "pkcs1", key: privateDER },
        { key: jwk, format: "jwk" },
      ],
    );

    testDecryption(
      publicDecrypt,
      [privateEncrypt(privateKey, plaintext)],
      [
        // Decrypt using the public key.
        publicKey,
        { format: "pem", key: publicPem },
        { format: "der", type: "pkcs1", key: publicDER },
        { key: publicJwk, format: "jwk" },

        // Decrypt using the private key.
        privateKey,
        { format: "pem", key: privatePem },
        { format: "der", type: "pkcs1", key: privateDER },
        { key: jwk, format: "jwk" },
      ],
    );
  });

  test("This should not cause a crash: https://github.com/nodejs/node/issues/25247", async () => {
    expect(() => createPrivateKey({ key: "" })).toThrow();
  });
  test("This should not abort either: https://github.com/nodejs/node/issues/29904", async () => {
    expect(() => createPrivateKey({ key: Buffer.alloc(0), format: "der", type: "spki" })).toThrow();
  });

  test("BoringSSL will not parse PKCS#1", async () => {
    // Unlike SPKI, PKCS#1 is a valid encoding for private keys (and public keys),
    // so it should be accepted by createPrivateKey, but OpenSSL won't parse it.
    expect(() => {
      const key = createPublicKey(publicPem).export({
        format: "der",
        type: "pkcs1",
      });
      createPrivateKey({ key, format: "der", type: "pkcs1" });
    }).toThrow("Invalid use of PKCS#1 as private key");
  });

  [
    {
      private: fs.readFileSync(path.join(import.meta.dir, "fixtures", "ed25519_private.pem"), "ascii"),
      public: fs.readFileSync(path.join(import.meta.dir, "fixtures", "ed25519_public.pem"), "ascii"),
      keyType: "ed25519",
      jwk: {
        crv: "Ed25519",
        x: "K1wIouqnuiA04b3WrMa-xKIKIpfHetNZRv3h9fBf768",
        d: "wVK6M3SMhQh3NK-7GRrSV-BVWQx1FO5pW8hhQeu_NdA",
        kty: "OKP",
      },
    },
    {
      private: fs.readFileSync(path.join(import.meta.dir, "fixtures", "ed448_private.pem"), "ascii"),
      public: fs.readFileSync(path.join(import.meta.dir, "fixtures", "ed448_public.pem"), "ascii"),
      keyType: "ed448",
      jwk: {
        crv: "Ed448",
        x: "oX_ee5-jlcU53-BbGRsGIzly0V-SZtJ_oGXY0udf84q2hTW2RdstLktvwpkVJOoNb7o" + "Dgc2V5ZUA",
        d: "060Ke71sN0GpIc01nnGgMDkp0sFNQ09woVo4AM1ffax1-mjnakK0-p-S7-Xf859QewX" + "jcR9mxppY",
        kty: "OKP",
      },
    },
    {
      private: fs.readFileSync(path.join(import.meta.dir, "fixtures", "x25519_private.pem"), "ascii"),
      public: fs.readFileSync(path.join(import.meta.dir, "fixtures", "x25519_public.pem"), "ascii"),
      keyType: "x25519",
      jwk: {
        crv: "X25519",
        x: "aSb8Q-RndwfNnPeOYGYPDUN3uhAPnMLzXyfi-mqfhig",
        d: "mL_IWm55RrALUGRfJYzw40gEYWMvtRkesP9mj8o8Omc",
        kty: "OKP",
      },
    },
    {
      private: fs.readFileSync(path.join(import.meta.dir, "fixtures", "x448_private.pem"), "ascii"),
      public: fs.readFileSync(path.join(import.meta.dir, "fixtures", "x448_public.pem"), "ascii"),
      keyType: "x448",
      jwk: {
        crv: "X448",
        x: "ioHSHVpTs6hMvghosEJDIR7ceFiE3-Xccxati64oOVJ7NWjfozE7ae31PXIUFq6cVYg" + "vSKsDFPA",
        d: "tMNtrO_q8dlY6Y4NDeSTxNQ5CACkHiPvmukidPnNIuX_EkcryLEXt_7i6j6YZMKsrWy" + "S0jlSYJk",
        kty: "OKP",
      },
    },
  ].forEach(info => {
    const keyType = info.keyType;
    // X25519 implementation is incomplete, Ed448 and X448 are not supported yet
    const test = keyType === "ed25519" ? it : it.skip;
    let privateKey: KeyObject;
    test(`${keyType} from Buffer should work`, async () => {
      const key = createPrivateKey(info.private);
      privateKey = key;
      expect(key.type).toBe("private");
      expect(key.asymmetricKeyType).toBe(keyType);
      expect(key.symmetricKeySize).toBe(undefined);
      expect(key.export({ type: "pkcs8", format: "pem" })).toEqual(info.private);
      const jwt = key.export({ format: "jwk" });
      expect(jwt).toEqual(info.jwk);
    });

    test(`${keyType} createPrivateKey from jwk should work`, async () => {
      const key = createPrivateKey({ key: info.jwk, format: "jwk" });
      expect(key.type).toBe("private");
      expect(key.asymmetricKeyType).toBe(keyType);
      expect(key.symmetricKeySize).toBe(undefined);
      expect(key.export({ type: "pkcs8", format: "pem" })).toEqual(info.private);
      const jwt = key.export({ format: "jwk" });
      expect(jwt).toEqual(info.jwk);
    });

    [
      ["public", info.public],
      ["private", info.private],
      ["jwk", { key: info.jwk, format: "jwk" }],
    ].forEach(([name, input]) => {
      test(`${keyType} createPublicKey using ${name} key should work`, async () => {
        const key = createPublicKey(input);
        expect(key.type).toBe("public");
        expect(key.asymmetricKeyType).toBe(keyType);
        expect(key.symmetricKeySize).toBe(undefined);
        if (name == "public") {
          expect(key.export({ type: "spki", format: "pem" })).toEqual(info.public);
        }
        if (name == "jwk") {
          const jwt = { ...info.jwk };
          delete jwt.d;
          const jwk_exported = key.export({ format: "jwk" });
          expect(jwk_exported).toEqual(jwt);
        }
      });
    });
  });

  [
    {
      private: fs.readFileSync(path.join(import.meta.dir, "fixtures", "ec_p256_private.pem"), "ascii"),
      public: fs.readFileSync(path.join(import.meta.dir, "fixtures", "ec_p256_public.pem"), "ascii"),
      keyType: "ec",
      namedCurve: "prime256v1",
      jwk: {
        crv: "P-256",
        d: "DxBsPQPIgMuMyQbxzbb9toew6Ev6e9O6ZhpxLNgmAEo",
        kty: "EC",
        x: "X0mMYR_uleZSIPjNztIkAS3_ud5LhNpbiIFp6fNf2Gs",
        y: "UbJuPy2Xi0lW7UYTBxPK3yGgDu9EAKYIecjkHX5s2lI",
      },
    },
    {
      private: fs.readFileSync(path.join(import.meta.dir, "fixtures", "ec_secp256k1_private.pem"), "ascii"),
      public: fs.readFileSync(path.join(import.meta.dir, "fixtures", "ec_secp256k1_public.pem"), "ascii"),
      keyType: "ec",
      namedCurve: "secp256k1",
      jwk: {
        crv: "secp256k1",
        d: "c34ocwTwpFa9NZZh3l88qXyrkoYSxvC0FEsU5v1v4IM",
        kty: "EC",
        x: "cOzhFSpWxhalCbWNdP2H_yUkdC81C9T2deDpfxK7owA",
        y: "-A3DAZTk9IPppN-f03JydgHaFvL1fAHaoXf4SX4NXyo",
      },
    },
    {
      private: fs.readFileSync(path.join(import.meta.dir, "fixtures", "ec_p384_private.pem"), "ascii"),
      public: fs.readFileSync(path.join(import.meta.dir, "fixtures", "ec_p384_public.pem"), "ascii"),
      keyType: "ec",
      namedCurve: "secp384r1",
      jwk: {
        crv: "P-384",
        d: "dwfuHuAtTlMRn7ZBCBm_0grpc1D_4hPeNAgevgelljuC0--k_LDFosDgBlLLmZsi",
        kty: "EC",
        x: "hON3nzGJgv-08fdHpQxgRJFZzlK-GZDGa5f3KnvM31cvvjJmsj4UeOgIdy3rDAjV",
        y: "fidHhtecNCGCfLqmrLjDena1NSzWzWH1u_oUdMKGo5XSabxzD7-8JZxjpc8sR9cl",
      },
    },
    {
      private: fs.readFileSync(path.join(import.meta.dir, "fixtures", "ec_p521_private.pem"), "ascii"),
      public: fs.readFileSync(path.join(import.meta.dir, "fixtures", "ec_p521_public.pem"), "ascii"),
      keyType: "ec",
      namedCurve: "secp521r1",
      jwk: {
        crv: "P-521",
        d: "ABIIbmn3Gm_Y11uIDkC3g2ijpRxIrJEBY4i_JJYo5OougzTl3BX2ifRluPJMaaHcNer" + "bQH_WdVkLLX86ShlHrRyJ",
        kty: "EC",
        x: "AaLFgjwZtznM3N7qsfb86awVXe6c6djUYOob1FN-kllekv0KEXV0bwcDjPGQz5f6MxL" + "CbhMeHRavUS6P10rsTtBn",
        y: "Ad3flexBeAfXceNzRBH128kFbOWD6W41NjwKRqqIF26vmgW_8COldGKZjFkOSEASxPB" + "cvA2iFJRUyQ3whC00j0Np",
      },
    },
  ].forEach(info => {
    const { keyType, namedCurve } = info;
    const test = namedCurve === "secp256k1" ? it.skip : it;
    let privateKey: KeyObject;
    test(`${keyType} ${namedCurve} createPrivateKey from Buffer should work`, async () => {
      const key = createPrivateKey(info.private);
      privateKey = key;
      expect(key.type).toBe("private");
      expect(key.asymmetricKeyType).toBe(keyType);
      expect(key.asymmetricKeyDetails?.namedCurve).toBe(namedCurve);
      expect(key.symmetricKeySize).toBe(undefined);
      expect(key.export({ type: "pkcs8", format: "pem" })).toEqual(info.private);
      const jwt = key.export({ format: "jwk" });
      expect(jwt).toEqual(info.jwk);
    });

    test(`${keyType} ${namedCurve} createPrivateKey from jwk should work`, async () => {
      const key = createPrivateKey({ key: info.jwk, format: "jwk" });
      expect(key.type).toBe("private");
      expect(key.asymmetricKeyType).toBe(keyType);
      expect(key.asymmetricKeyDetails?.namedCurve).toBe(namedCurve);
      expect(key.symmetricKeySize).toBe(undefined);
      expect(key.export({ type: "pkcs8", format: "pem" })).toEqual(info.private);
      const jwt = key.export({ format: "jwk" });
      expect(jwt).toEqual(info.jwk);
    });

    [
      ["public", info.public],
      ["private", info.private],
      ["jwk", { key: info.jwk, format: "jwk" }],
    ].forEach(([name, input]) => {
      test(`${keyType} ${namedCurve} createPublicKey using ${name} should work`, async () => {
        const key = createPublicKey(input);
        expect(key.type).toBe("public");
        expect(key.asymmetricKeyType).toBe(keyType);
        expect(key.asymmetricKeyDetails?.namedCurve).toBe(namedCurve);
        expect(key.symmetricKeySize).toBe(undefined);
        if (name == "public") {
          expect(key.export({ type: "spki", format: "pem" })).toEqual(info.public);
        }
        if (name == "jwk") {
          const jwt = { ...info.jwk };
          delete jwt.d;
          const jwk_exported = key.export({ format: "jwk" });
          expect(jwk_exported).toEqual(jwt);
        }

        const pkey = privateKey || info.private;
        const signature = createSign("sha256").update("foo").sign({ key: pkey });
        const okay = createVerify("sha256").update("foo").verify({ key: key }, signature);
        expect(okay).toBeTrue();
      });
    });
  });

  test("private encrypted should work", async () => {
    // Reading an encrypted key without a passphrase should fail.
    expect(() => createPrivateKey(privateEncryptedPem)).toThrow();
    // Reading an encrypted key with a passphrase that exceeds OpenSSL's buffer
    // size limit should fail with an appropriate error code.
    expect(() =>
      createPrivateKey({
        key: privateEncryptedPem,
        format: "pem",
        passphrase: Buffer.alloc(1025, "a"),
      }),
    ).toThrow();
    // The buffer has a size of 1024 bytes, so this passphrase should be permitted
    // (but will fail decryption).
    expect(() =>
      createPrivateKey({
        key: privateEncryptedPem,
        format: "pem",
        passphrase: Buffer.alloc(1024, "a"),
      }),
    ).toThrow();
    const publicKey = createPublicKey({
      key: privateEncryptedPem,
      format: "pem",
      passphrase: "password", // this is not documented but should work
    });
    expect(publicKey.type).toBe("public");
    expect(publicKey.asymmetricKeyType).toBe("rsa");
    expect(publicKey.symmetricKeySize).toBe(undefined);

    const privateKey = createPrivateKey({
      key: privateEncryptedPem,
      format: "pem",
      passphrase: "password",
    });
    expect(privateKey.type).toBe("private");
    expect(privateKey.asymmetricKeyType).toBe("rsa");
    expect(privateKey.symmetricKeySize).toBe(undefined);
  });

  [2048, 4096].forEach(suffix => {
    test(`RSA-${suffix} should work`, async () => {
      {
        const publicPem = fs.readFileSync(path.join(import.meta.dir, "fixtures", `rsa_public_${suffix}.pem`), "ascii");
        const privatePem = fs.readFileSync(
          path.join(import.meta.dir, "fixtures", `rsa_private_${suffix}.pem`),
          "ascii",
        );
        const publicKey = createPublicKey(publicPem);
        const expectedKeyDetails = {
          modulusLength: suffix,
          publicExponent: 65537n,
        };
        expect(publicKey.type).toBe("public");
        expect(publicKey.asymmetricKeyType).toBe("rsa");
        expect(publicKey.asymmetricKeyDetails).toEqual(expectedKeyDetails);

        const privateKey = createPrivateKey(privatePem);
        expect(privateKey.type).toBe("private");
        expect(privateKey.asymmetricKeyType).toBe("rsa");
        expect(privateKey.asymmetricKeyDetails).toEqual(expectedKeyDetails);

        for (const key of [privatePem, privateKey]) {
          // Any algorithm should work.
          for (const algo of ["sha1", "sha256"]) {
            // Any salt length should work.
            for (const saltLength of [undefined, 8, 10, 12, 16, 18, 20]) {
              const signature = createSign(algo).update("foo").sign({ key, saltLength });
              for (const pkey of [key, publicKey, publicPem]) {
                const okay = createVerify(algo).update("foo").verify({ key: pkey, saltLength }, signature);
                expect(okay).toBeTrue();
              }
            }
          }
        }
      }
    });
  });

  test("Exporting an encrypted private key requires a cipher", async () => {
    // Exporting an encrypted private key requires a cipher
    const privateKey = createPrivateKey(privatePem);
    expect(() => {
      privateKey.export({
        format: "pem",
        type: "pkcs8",
        passphrase: "super-secret",
      });
    }).toThrow(/cipher is required when passphrase is specified/);
  });

  test("secret export buffer format (default)", async () => {
    const buffer = Buffer.from("Hello World");
    const keyObject = createSecretKey(buffer);
    expect(keyObject.export()).toEqual(buffer);
    expect(keyObject.export({})).toEqual(buffer);
    expect(keyObject.export({ format: "buffer" })).toEqual(buffer);
    expect(keyObject.export({ format: undefined })).toEqual(buffer);
  });

  test('exporting an "oct" JWK from a secret', async () => {
    const buffer = Buffer.from("Hello World");
    const keyObject = createSecretKey(buffer);
    const jwk = keyObject.export({ format: "jwk" });
    expect(jwk).toEqual({ kty: "oct", k: "SGVsbG8gV29ybGQ" });
  });

  test("secret equals", async () => {
    {
      const first = Buffer.from("Hello");
      const second = Buffer.from("World");
      const keyObject = createSecretKey(first);
      expect(createSecretKey(first).equals(createSecretKey(first))).toBeTrue();
      expect(createSecretKey(first).equals(createSecretKey(second))).toBeFalse();

      expect(() => keyObject.equals(0)).toThrow(/otherKey must be a KeyObject/);

      expect(keyObject.equals(keyObject)).toBeTrue();
      expect(keyObject.equals(createPublicKey(publicPem))).toBeFalse();
      expect(keyObject.equals(createPrivateKey(privatePem))).toBeFalse();
    }

    {
      const first = createSecretKey(Buffer.alloc(0));
      const second = createSecretKey(new ArrayBuffer(0));
      const third = createSecretKey(Buffer.alloc(1));
      expect(first.equals(first)).toBeTrue();
      expect(first.equals(second)).toBeTrue();
      expect(first.equals(third)).toBeFalse();
      expect(third.equals(first)).toBeFalse();
    }
  });

  ["ed25519", "x25519"].forEach(keyType => {
    const test = keyType === "ed25519" ? it : it.skip;
    test(`${keyType} equals should work`, async () => {
      const first = generateKeyPairSync(keyType);
      const second = generateKeyPairSync(keyType);

      const secret = generateKeySync("aes", { length: 128 });

      expect(first.publicKey.equals(first.publicKey)).toBeTrue();

      expect(first.publicKey.equals(createPublicKey(first.publicKey.export({ format: "pem", type: "spki" }))));

      expect(first.publicKey.equals(second.publicKey)).toBeFalse();
      expect(first.publicKey.equals(second.privateKey)).toBeFalse();
      expect(first.publicKey.equals(secret)).toBeFalse();

      expect(first.privateKey.equals(first.privateKey)).toBeTrue();
      expect(
        first.privateKey.equals(createPrivateKey(first.privateKey.export({ format: "pem", type: "pkcs8" }))),
      ).toBeTrue();
      expect(first.privateKey.equals(second.privateKey)).toBeFalse();
      expect(first.privateKey.equals(second.publicKey)).toBeFalse();
      expect(first.privateKey.equals(secret)).toBeFalse();
    });
  });

  test("This should not cause a crash: https://github.com/nodejs/node/issues/44471", async () => {
    for (const key of ["", "foo", null, undefined, true, Boolean]) {
      expect(() => {
        createPublicKey({ key, format: "jwk" });
      }).toThrow();
      expect(() => {
        createPrivateKey({ key, format: "jwk" });
      }).toThrow();
    }
  });
});

test.todo("RSA-PSS should work", async () => {
  // Test RSA-PSS.
  {
    // This key pair does not restrict the message digest algorithm or salt
    // length.
    // const publicPem = fs.readFileSync(path.join(import.meta.dir, "fixtures", "rsa_pss_public_2048.pem"), "ascii");
    // const privatePem = fs.readFileSync(path.join(import.meta.dir, "fixtures", "rsa_pss_private_2048.pem"), "ascii");
    // const publicKey = createPublicKey(publicPem);
    // const privateKey = createPrivateKey(privatePem);
    // // Because no RSASSA-PSS-params appears in the PEM, no defaults should be
    // // added for the PSS parameters. This is different from an empty
    // // RSASSA-PSS-params sequence (see test below).
    // const expectedKeyDetails = {
    //   modulusLength: 2048,
    //   publicExponent: 65537n,
    // };
    // expect(publicKey.type).toBe("public");
    // expect(publicKey.asymmetricKeyType).toBe("rsa-pss");
    // expect(publicKey.asymmetricKeyDetails).toBe(expectedKeyDetails);
    // expect(privateKey.type).toBe("private");
    // expect(privateKey.asymmetricKeyType).toBe("rsa-pss");
    // expect(privateKey.asymmetricKeyDetails).toBe(expectedKeyDetails);
    // assert.throws(
    //   () => publicKey.export({ format: 'jwk' }),
    //   { code: 'ERR_CRYPTO_JWK_UNSUPPORTED_KEY_TYPE' });
    // assert.throws(
    //   () => privateKey.export({ format: 'jwk' }),
    //   { code: 'ERR_CRYPTO_JWK_UNSUPPORTED_KEY_TYPE' });
    // for (const key of [privatePem, privateKey]) {
    //   // Any algorithm should work.
    //   for (const algo of ['sha1', 'sha256']) {
    //     // Any salt length should work.
    //     for (const saltLength of [undefined, 8, 10, 12, 16, 18, 20]) {
    //       const signature = createSign(algo)
    //                         .update('foo')
    //                         .sign({ key, saltLength });
    //       for (const pkey of [key, publicKey, publicPem]) {
    //         const okay = createVerify(algo)
    //                      .update('foo')
    //                      .verify({ key: pkey, saltLength }, signature);
    //         assert.ok(okay);
    //       }
    //     }
    //   }
    // }
    // // Exporting the key using PKCS#1 should not work since this would discard
    // // any algorithm restrictions.
    // assert.throws(() => {
    //   publicKey.export({ format: 'pem', type: 'pkcs1' });
    // }, {
    //   code: 'ERR_CRYPTO_INCOMPATIBLE_KEY_OPTIONS'
    // });
    //   {
    //     // This key pair enforces sha1 as the message digest and the MGF1
    //     // message digest and a salt length of 20 bytes.
    //     const publicPem = fixtures.readKey('rsa_pss_public_2048_sha1_sha1_20.pem');
    //     const privatePem =
    //         fixtures.readKey('rsa_pss_private_2048_sha1_sha1_20.pem');
    //     const publicKey = createPublicKey(publicPem);
    //     const privateKey = createPrivateKey(privatePem);
    //     // Unlike the previous key pair, this key pair contains an RSASSA-PSS-params
    //     // sequence. However, because all values in the RSASSA-PSS-params are set to
    //     // their defaults (see RFC 3447), the ASN.1 structure contains an empty
    //     // sequence. Node.js should add the default values to the key details.
    //     const expectedKeyDetails = {
    //       modulusLength: 2048,
    //       publicExponent: 65537n,
    //       hashAlgorithm: 'sha1',
    //       mgf1HashAlgorithm: 'sha1',
    //       saltLength: 20
    //     };
    //     assert.strictEqual(publicKey.type, 'public');
    //     assert.strictEqual(publicKey.asymmetricKeyType, 'rsa-pss');
    //     assert.deepStrictEqual(publicKey.asymmetricKeyDetails, expectedKeyDetails);
    //     assert.strictEqual(privateKey.type, 'private');
    //     assert.strictEqual(privateKey.asymmetricKeyType, 'rsa-pss');
    //     assert.deepStrictEqual(privateKey.asymmetricKeyDetails, expectedKeyDetails);
    //   }
    //   {
    //     // This key pair enforces sha256 as the message digest and the MGF1
    //     // message digest and a salt length of at least 16 bytes.
    //     const publicPem =
    //       fixtures.readKey('rsa_pss_public_2048_sha256_sha256_16.pem');
    //     const privatePem =
    //       fixtures.readKey('rsa_pss_private_2048_sha256_sha256_16.pem');
    //     const publicKey = createPublicKey(publicPem);
    //     const privateKey = createPrivateKey(privatePem);
    //     assert.strictEqual(publicKey.type, 'public');
    //     assert.strictEqual(publicKey.asymmetricKeyType, 'rsa-pss');
    //     assert.strictEqual(privateKey.type, 'private');
    //     assert.strictEqual(privateKey.asymmetricKeyType, 'rsa-pss');
    //     for (const key of [privatePem, privateKey]) {
    //       // Signing with anything other than sha256 should fail.
    //       assert.throws(() => {
    //         createSign('sha1').sign(key);
    //       }, /digest not allowed/);
    //       // Signing with salt lengths less than 16 bytes should fail.
    //       for (const saltLength of [8, 10, 12]) {
    //         assert.throws(() => {
    //           createSign('sha1').sign({ key, saltLength });
    //         }, /pss saltlen too small/);
    //       }
    //       // Signing with sha256 and appropriate salt lengths should work.
    //       for (const saltLength of [undefined, 16, 18, 20]) {
    //         const signature = createSign('sha256')
    //                           .update('foo')
    //                           .sign({ key, saltLength });
    //         for (const pkey of [key, publicKey, publicPem]) {
    //           const okay = createVerify('sha256')
    //                        .update('foo')
    //                        .verify({ key: pkey, saltLength }, signature);
    //           assert.ok(okay);
    //         }
    //       }
    //     }
    //   }
    //   {
    //     // This key enforces sha512 as the message digest and sha256 as the MGF1
    //     // message digest.
    //     const publicPem =
    //       fixtures.readKey('rsa_pss_public_2048_sha512_sha256_20.pem');
    //     const privatePem =
    //       fixtures.readKey('rsa_pss_private_2048_sha512_sha256_20.pem');
    //     const publicKey = createPublicKey(publicPem);
    //     const privateKey = createPrivateKey(privatePem);
    //     const expectedKeyDetails = {
    //       modulusLength: 2048,
    //       publicExponent: 65537n,
    //       hashAlgorithm: 'sha512',
    //       mgf1HashAlgorithm: 'sha256',
    //       saltLength: 20
    //     };
    //     assert.strictEqual(publicKey.type, 'public');
    //     assert.strictEqual(publicKey.asymmetricKeyType, 'rsa-pss');
    //     assert.deepStrictEqual(publicKey.asymmetricKeyDetails, expectedKeyDetails);
    //     assert.strictEqual(privateKey.type, 'private');
    //     assert.strictEqual(privateKey.asymmetricKeyType, 'rsa-pss');
    //     assert.deepStrictEqual(privateKey.asymmetricKeyDetails, expectedKeyDetails);
    //     // Node.js usually uses the same hash function for the message and for MGF1.
    //     // However, when a different MGF1 message digest algorithm has been
    //     // specified as part of the key, it should automatically switch to that.
    //     // This behavior is required by sections 3.1 and 3.3 of RFC4055.
    //     for (const key of [privatePem, privateKey]) {
    //       // sha256 matches the MGF1 hash function and should be used internally,
    //       // but it should not be permitted as the main message digest algorithm.
    //       for (const algo of ['sha1', 'sha256']) {
    //         assert.throws(() => {
    //           createSign(algo).sign(key);
    //         }, /digest not allowed/);
    //       }
    //       // sha512 should produce a valid signature.
    //       const signature = createSign('sha512')
    //                         .update('foo')
    //                         .sign(key);
    //       for (const pkey of [key, publicKey, publicPem]) {
    //         const okay = createVerify('sha512')
    //                      .update('foo')
    //                      .verify(pkey, signature);
    //         assert.ok(okay);
    //       }
    //     }
    //   }
    // }
  }
});
