import { describe, expect, test } from "bun:test";
import crypto from "crypto";
import { readFileSync } from "fs";
import { path } from "../test/common/fixtures";

describe("crypto.hash", () => {
  test("throws for invalid arguments", () => {
    ([undefined, null, true, 1, () => {}, {}] as const).forEach(invalid => {
      expect(() => crypto.hash(invalid, "test")).toThrow(
        expect.objectContaining({
          code: "ERR_INVALID_ARG_TYPE",
        }),
      );
    });

    [undefined, null, true, 1, () => {}, {}].forEach(invalid => {
      expect(() => crypto.hash("sha1", invalid)).toThrow(
        expect.objectContaining({
          code: "ERR_INVALID_ARG_TYPE",
        }),
      );
    });

    [null, true, 1, () => {}, {}].forEach(invalid => {
      expect(() => crypto.hash("sha1", "test", invalid)).toThrow(
        expect.objectContaining({
          code: "ERR_INVALID_ARG_TYPE",
        }),
      );
    });

    expect(() => crypto.hash("sha1", "test", "not an encoding")).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_VALUE",
      }),
    );
  });
  const input = readFileSync(path("utf8_test_text.txt"));
  [
    "blake2b256",
    "blake2b512",
    "blake2s256",
    "ripemd160",
    "rmd160",
    "md4",
    "md5",
    "sha1",
    "sha128",
    "sha224",
    "sha256",
    "sha384",
    "sha512",
    "sha-1",
    "sha-224",
    "sha-256",
    "sha-384",
    "sha-512",
    "sha-512/224",
    "sha-512_224",
    "sha-512224",
    "sha512-224",
    "sha-512/256",
    "sha-512_256",
    "sha-512256",
    "sha512-256",
    "sha384",
    "sha3-224",
    "sha3-256",
    "sha3-384",
    "sha3-512",
    "shake128",
    "shake256",
  ].forEach(method => {
    test(`output matches crypto.createHash(${method})`, () => {
      for (const outputEncoding of ["buffer", "hex", "base64", undefined]) {
        const oldDigest = crypto
          .createHash(method)
          .update(input)
          .digest(outputEncoding || "hex");
        const digestFromBuffer = crypto.hash(method, input, outputEncoding);
        expect(digestFromBuffer).toEqual(oldDigest);

        const digestFromString = crypto.hash(method, input.toString(), outputEncoding);
        expect(digestFromString).toEqual(oldDigest);
      }
    });
  });
});

describe("crypto.verify", () => {
  test("uses the signature bytes provided at call time", () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const data = Buffer.from("data to sign");
    const signature = crypto.sign("sha256", data, privateKey);
    expect(crypto.verify("sha256", data, publicKey, signature)).toBe(true);

    const publicPem = publicKey.export({ type: "spki", format: "pem" });
    let passphraseReads = 0;
    const verified = crypto.verify(
      "sha256",
      data,
      {
        key: publicPem,
        format: "pem",
        get passphrase() {
          passphraseReads++;
          signature.fill(0);
          return undefined;
        },
      },
      signature,
    );
    expect(passphraseReads).toBe(1);
    expect(verified).toBe(true);
  });
});

describe("SHA-512/224 and SHA-512/256 sign/verify", () => {
  const digests = ["sha512-224", "sha512-256"];
  const message = Buffer.from("sha512/t truncated digest conformance");
  const fixture = (name: string) => readFileSync(`${__dirname}/fixtures/${name}`, "utf8");

  const rsaPrivate = fixture("rsa_private_2048.pem");
  const rsaPublic = fixture("rsa_public_2048.pem");
  const ecPrivate = fixture("ec_p256_private.pem");
  const ecPublic = fixture("ec_p256_public.pem");

  // Signatures produced by Node.js (OpenSSL) over `message` with the fixtures
  // above. RSA PKCS#1 v1.5 is deterministic, so these pin the exact DigestInfo
  // encoding rather than just proving we can verify what we sign.
  const rsaPkcs1: Record<string, string> = {
    "sha512-224":
      "psEUABh24pmkwPp4prxY2T0QzxpunNaOnfadI/WBRkQzP15tQcKh1bV1ZGeGo4YmmyfMdib/QhFbadd2FSdsqS5LJKcnZlj9gb3kTHgu6YyiQiLyeq9z0SWz4pdkKc1iq7KAa5TMIgak7b6SqVMI5iA+x80Bi2Xh9qAGE0IZuIuRWEnVNQYEZK9ORau8lNxn9Ib7DwdKcCsLS626H+cxm8YHu3QcVT4YV5mPZ+E6WhtNV0Ff1r7myMoXFefrDsDyPVSED0bGrKBbbawR1Y8s+I0c+YAaGVLlO2ZSFdbqAC+VkeNEy1lxNFrNKavf9UM6s6Ml85yRcnaa1Kwue3BTjw==",
    "sha512-256":
      "CnZSfkxxTlGqykoCLNolJpRi0pHmEQ0JV6YgtEB/weA/zB4RWK6D3s6ZJ9+Xo10ld0DmMpTBG61Nck6qm8MevsWdePR0Ldj/jHSEnvEyS6K4RhOjAfXxqbAWdoh04JEaz6v72LSLFqEAs4siJcaKFZ/d9HPTVXgkSD2wOjlDAvKgu+5UMh/5FxXJAXPhr5K1YdU/Uie2lbQ5VwzRJq8dG9afT0UgpTyUdr9XGuPr09HRrflsedSElarsGorUa1O1V1l7L8Btj29shDX0NBTl5niA7SwnzeAawW3dfakRPeDGqn/we94kyK8vw71oCpVySg/PLQNt6ArUBN23Zcbs1A==",
  };

  // PSS and ECDSA are randomized, so these only exercise the verify path.
  const rsaPss: Record<string, string> = {
    "sha512-224":
      "HYlsKCnKIZIoaQ2mqS5+eTdypx2ypQlOV+qfJYWT/8350FpqFO5fugLTT6ap68AeAVwSTJayTwwjb6uelIMnJsHLAmeaFwFnA34lrhv5CMhzgThxoN/hLlo7PmTItXOHzATEqSuWOlCT8JmcCYTRkXWNmPCvRPO6b4cFiB1w1XD99l8sb90FBOEuNjnVL872O0pdFcA87Z6wdXpVMIn2OmD+KwvR3c8f+Yck6vo9QwXpiKNaEuwdRhQV++ZvxfI5XHqHT+lkBToXgRGuHJda9wLvzvdJ+HoGpqIigglNLPXaOyLqDbK4KIBjchzNf77az9DqtADGKtetQikru4DILQ==",
    "sha512-256":
      "InLtCNTKfBkPlVKGdzOVeSeloObt0E1+03AfxZ5EvIH8XBmT8nJhuDBJoA/02ndpJCQmEPuGOYhDm5f8ZOjwwfkTGGhAG2D77k9xvVzrPeJYkZsff13/2LwwgI36P7/TXjBgCNsUly0Y9WkuM1JVg/rSDUsrw+YDCfocP3My8AkgxCfE7fLQQW+Jb0rjFgyaRUz6wItzB/+aXjKpJl1oWZj8GDjZToWTThumHLIn4sm/MFOXyoCuLv59qiPApYD14uvTckA98TkeeBOT9upehNt5GGLjeRJNK8n2jjWtscKBya5tZ01JwFppXjwqE/X832yuHoc6YcLtHBEARp82Dw==",
  };

  const ecdsa: Record<string, string> = {
    "sha512-224": "MEUCIQCicz3JtMf0wDnpIH21Ux9roA+zcG8cqdKCvL3Qe/PprQIgK7waBH2z/G5+TrEsZ+zuov+C52V6WpH5WlbjaM5SU5A=",
    "sha512-256": "MEQCICjmdz59MesS8BnyG0pzPeRZ70BApipq99pTGmguTwA1AiBGhRw1PBYI6fO09gN1aAkdwfFjo+6Jma/b8LizYA8F8A==",
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
      const oneShot = crypto.sign(digest, message, ecPrivate);
      const streaming = crypto.createSign(digest).update(message).sign(ecPrivate);
      expect({
        oneShot: crypto.verify(digest, message, ecPublic, oneShot),
        streaming: crypto.createVerify(digest).update(message).verify(ecPublic, streaming),
      }).toEqual({ oneShot: true, streaming: true });
    });

    test("RSA-PSS signatures round-trip", () => {
      const padding = crypto.constants.RSA_PKCS1_PSS_PADDING;
      const oneShot = crypto.sign(digest, message, { key: rsaPrivate, padding });
      const streaming = crypto.createSign(digest).update(message).sign({ key: rsaPrivate, padding });
      expect({
        oneShotVerify: crypto.verify(digest, message, { key: rsaPublic, padding }, oneShot),
        streamingVerify: crypto.createVerify(digest).update(message).verify({ key: rsaPublic, padding }, streaming),
        // PSS output is randomized, so the two signatures must differ.
        randomized: !oneShot.equals(streaming),
      }).toEqual({ oneShotVerify: true, streamingVerify: true, randomized: true });
    });

    test("the RSA-SHA512/<t> alias resolves", () => {
      const alias = digest === "sha512-224" ? "RSA-SHA512/224" : "RSA-SHA512/256";
      expect({
        sign: crypto.sign(alias, message, rsaPrivate).toString("base64"),
        verify: crypto.verify(alias, message, rsaPublic, Buffer.from(rsaPkcs1[digest], "base64")),
      }).toEqual({ sign: rsaPkcs1[digest], verify: true });
    });

    test("tampered and mismatched signatures are rejected", () => {
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
