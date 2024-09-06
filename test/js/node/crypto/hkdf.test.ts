import { describe, test, expect } from "bun:test";
import crypto from "node:crypto";

test("rejects fewer than 5 args", () => {
  try {
    crypto.hkdfSync();
    expect(false).toBeTrue();
  } catch (e) {
    expect(e).toBeInstanceOf(TypeError);
    expect(e.toString()).toInclude("The \"algorithm\" argument must be of type string");
  }
  try {
    crypto.hkdf();
    expect(false).toBeTrue();
  } catch (e) {
    expect(e).toBeInstanceOf(TypeError);
    expect(e.toString()).toInclude("The \"algorithm\" argument must be of type string");
  }
});

test("rejects invalid hash algorithm", () => {
  try {
    crypto.hkdfSync("notahash", "key", "salt", "info", 64)
    expect(false).toBeTrue();
  } catch (e) {
    expect(e).toBeInstanceOf(TypeError);
    expect(e.toString()).toInclude("Unsupported algorithm");
  }

  try {
    crypto.hkdf("notahash", "key", "salt", "info", 64, (err, ab) => {})
    expect(false).toBeTrue();
  } catch (e) {
    expect(e).toBeInstanceOf(TypeError);
    expect(e.toString()).toInclude("Unsupported algorithm");
  }
});

test('rejects bad callback type', () => {
  try {
    crypto.hkdf("sha512", "key", "salt", "info", 64, "notacallback");
    expect(false).toBeTrue();
  } catch (e){
    expect(e).toBeInstanceOf(TypeError);
    expect(e.toString()).toInclude("TypeError");
    expect(e.toString()).toInclude("not a function");
  }
});

test("rejects negative key size", () => {
  try {
    crypto.hkdfSync("sha512", "key", "salt", "info", -10);
    expect(false).toBeTrue();
  } catch (e) {
    expect(e).toBeInstanceOf(RangeError);
    expect(e.toString()).toInclude("range");
  }

  try {
    crypto.hkdf("sha512", "key", "salt", "info", -10, (err, ab) => {});
    expect(false).toBeTrue();
  } catch (e) {
    expect(e.toString()).toInclude("range");
  }
});

test("rejects excessive key size", () => {
  try {
    crypto.hkdfSync("sha512", "key", "salt", "info", 200000)
  } catch (e) {
    expect(e.toString()).toInclude("cannot be larger");
  }

  try {
    crypto.hkdf("sha512", "key", "salt", "info", 200000, (err, ab) => {})
  } catch (e) {
    expect(e.toString()).toInclude("cannot be larger");
  }
});

test("trivial", async () => {
  const key = crypto.createSecretKey("key");

  let outSync = crypto.hkdfSync("sha512", key, "salt", "info", 64);

  const { promise, resolve } = Promise.withResolvers();

  crypto.hkdf("sha512", "key", "salt", "info", 64, (err, result) => {
    resolve([err, result]);
  });
  const [err, out] = await promise;

  expect(err).toBeNull();
  expect(outSync).toStrictEqual(out);
  expect(Buffer.from(out).toString("hex")).toStrictEqual("24156e2c35525baaf3d0fbb92b734c8032a110a3f12e2596e441e1924870d84c3a500652a723738024432451046fd237efad8392fb686c5277a59e0105391653");
});

const rfcTestCase = async (testNo, digest, ikm, salt, info, keylen, expected) => {
  test(`RFC 5869 Test Vector ${testNo}`, async () => {
    let outSync = crypto.hkdfSync(digest, Buffer.from(ikm, "hex"), Buffer.from(salt, "hex"), Buffer.from(info, "hex"), keylen);

    const { promise, resolve } = Promise.withResolvers();

    crypto.hkdf(digest, Buffer.from(ikm, "hex"), Buffer.from(salt, "hex"), Buffer.from(info, "hex"), keylen, (err, result) => {
      resolve([err, result]);
    });
    const [err, out] = await promise;

    expect(err).toBeNull();
    expect(outSync).toStrictEqual(out);
    expect(Buffer.from(out).toString("hex")).toStrictEqual(expected);
  })
}

rfcTestCase(
  1,
  "sha256",
  "0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b",
  "000102030405060708090a0b0c",
  "f0f1f2f3f4f5f6f7f8f9",
  42,
  "3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865",
);

rfcTestCase(
  2,
  "sha256",
  "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f404142434445464748494a4b4c4d4e4f",
  "606162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9fa0a1a2a3a4a5a6a7a8a9aaabacadaeaf",
  "b0b1b2b3b4b5b6b7b8b9babbbcbdbebfc0c1c2c3c4c5c6c7c8c9cacbcccdcecfd0d1d2d3d4d5d6d7d8d9dadbdcdddedfe0e1e2e3e4e5e6e7e8e9eaebecedeeeff0f1f2f3f4f5f6f7f8f9fafbfcfdfeff",
  82,
  "b11e398dc80327a1c8e7f78c596a49344f012eda2d4efad8a050cc4c19afa97c59045a99cac7827271cb41c65e590e09da3275600c2f09b8367793a9aca3db71cc30c58179ec3e87c14c01d5c1f3434f1d87",
);

rfcTestCase(
  3,
  "sha256",
  "0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b",
  "",
  "",
  42,
  "8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d9d201395faa4b61a96c8",
);

rfcTestCase(
  4,
  "sha1",
  "0b0b0b0b0b0b0b0b0b0b0b",
  "000102030405060708090a0b0c",
  "f0f1f2f3f4f5f6f7f8f9",
  42,
  "085a01ea1b10f36933068b56efa5ad81a4f14b822f5b091568a9cdd4f155fda2c22e422478d305f3f896",
);

rfcTestCase(
  5,
  "sha1",
  "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f404142434445464748494a4b4c4d4e4f",
  "606162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9fa0a1a2a3a4a5a6a7a8a9aaabacadaeaf",
  "b0b1b2b3b4b5b6b7b8b9babbbcbdbebfc0c1c2c3c4c5c6c7c8c9cacbcccdcecfd0d1d2d3d4d5d6d7d8d9dadbdcdddedfe0e1e2e3e4e5e6e7e8e9eaebecedeeeff0f1f2f3f4f5f6f7f8f9fafbfcfdfeff",
  82,
  "0bd770a74d1160f7c9f12cd5912a06ebff6adcae899d92191fe4305673ba2ffe8fa3f1a4e5ad79f3f334b3b202b2173c486ea37ce3d397ed034c7f9dfeb15c5e927336d0441f4c4300e2cff0d0900b52d3b4",
);

rfcTestCase(
  6,
  "sha1",
  "0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b",
  "",
  "",
  42,
  "0ac1af7002b3d761d1e55298da9d0506b9ae52057220a306e07b6b87e8df21d0ea00033de03984d34918",
);

