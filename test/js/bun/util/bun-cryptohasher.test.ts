import { describe, expect, test } from "bun:test";
import { withoutAggressiveGC } from "harness";

test("Bun.file in CryptoHasher is not supported yet", () => {
  expect(() => Bun.SHA1.hash(Bun.file(import.meta.path))).toThrow();
  expect(() => Bun.CryptoHasher.hash("sha1", Bun.file(import.meta.path))).toThrow();
  expect(() => new Bun.CryptoHasher("sha1").update(Bun.file(import.meta.path))).toThrow();
  expect(() => new Bun.SHA1().update(Bun.file(import.meta.path))).toThrow();
});
test("CryptoHasher update should throw when no parameter/null/undefined is passed", () => {
  // @ts-expect-error
  expect(() => new Bun.CryptoHasher("sha1").update()).toThrow();
  // @ts-expect-error
  expect(() => new Bun.CryptoHasher("sha1").update(undefined)).toThrow();
  // @ts-expect-error
  expect(() => new Bun.CryptoHasher("sha1").update(null)).toThrow();
});

describe("HMAC", () => {
  const hashes = {
    "sha1": "e2e1f7f597941d9b0021978618218a9e08731426",
    "sha256": "c7a7c96c73af32ea6e5b1ca6768b1d822249eb88f85160433d7b09bb2b21e170",
    "sha384": "2483522dcb7cb65fa13f0a3c1efe867abbd79ecb19a6ba4bac45d4f4bac31de2e2463b11838b8055601fad73d0b5af4c",
    "sha512":
      "f82266c950db24eba03f899466fdf905494709f09f98f4b7d7db31f1443a33b4fe5ca82f74fb360609d8a05a87fb065dd77bee912c27de89cbba7897061ac735",
    "blake2b512":
      "9e66ba10f4d7e80abc2584150fc5f9a246634118280fd9ae086794d37cb9919d681ee285b68f9cec2eda9f878d157125cc465c8b0e3c023a7040ed0be7f25023",
    "md5": "4e7eb9f9332e4eb1dc5a2d7d065ba1bf",
    "sha224": "d34c3a2647d4f82a4e6baeaa7d94379eafd931e0c16cbc44b4ba4d1e",
    "sha512-224": "af398c7f21f58e1377580227a89590d3ab8be52b31182fad9ec4d667",
    "sha512-256": "0ed15b2750a2a7281e96af006ab79e82ed54a7a2081bdb49e70a70d8c6bfeff0",
  };
  for (let key of ["key", Buffer.from("key"), Buffer.from("key").buffer]) {
    test.each(Object.entries(hashes))("%s (key: " + key.constructor.name + ")", (algorithm, expected) => {
      const hmac = new Bun.CryptoHasher(algorithm, key);
      hmac.update("data\n");
      const copied = hmac.copy();
      expect(hmac.algorithm).toEqual(algorithm);
      expect(hmac.byteLength).toEqual(hashes[algorithm].length / 2);
      expect(copied.copy()).toBeInstanceOf(Bun.CryptoHasher);

      expect(hmac.digest("hex")).toEqual(expected);

      expect(copied.algorithm).toEqual(algorithm);
      expect(copied.byteLength).toEqual(hashes[algorithm].length / 2);

      expect(copied.digest("hex")).toEqual(expected);
      expect(() => hmac.digest()).toThrow();
      expect(() => copied.digest()).toThrow();
      expect(() => hmac.byteLength).toThrow();
      expect(() => copied.byteLength).toThrow();
      expect(() => copied.copy()).toThrow();
      expect(() => hmac.copy()).toThrow();

      // Note that algorithm may throw if the first time the property was accessed is after it was already consumed.
      // This is a property caching edgecase that it does not always throw.
      // But let's see if anyone complains about it. It is extremely minor
    });
  }

  const unsupported = [
    ["sha3-224"],
    ["sha3-256"],
    ["sha3-384"],
    ["sha3-512"],
    ["shake128"],
    ["shake256"],
    ["ripemd160"],
  ] as const;
  test.each(unsupported)("%s is not supported", algorithm => {
    expect(() => new Bun.CryptoHasher(algorithm, "key")).toThrow();
    expect(() => new Bun.CryptoHasher(algorithm)).not.toThrow();
  });
});

describe("Hash is consistent", () => {
  const sourceInputs = [
    Buffer.from([
      103, 87, 129, 242, 154, 82, 159, 206, 176, 124, 10, 39, 235, 214, 121, 13, 34, 155, 131, 178, 40, 34, 252, 134, 7,
      203, 130, 187, 207, 49, 26, 59,
    ]),
    Buffer.from([
      68, 19, 111, 163, 85, 179, 103, 138, 17, 70, 173, 22, 247, 232, 100, 158, 148, 251, 79, 194, 31, 231, 126, 131,
      16, 192, 96, 246, 28, 170, 255, 138,
    ]),
    Buffer.from([
      219, 133, 5, 84, 59, 236, 191, 241, 104, 167, 186, 223, 204, 158, 177, 43, 205, 52, 120, 28, 60, 233, 156, 159,
      125, 64, 171, 91, 240, 17, 71, 210,
    ]),
    Buffer.from([
      34, 93, 2, 87, 76, 190, 175, 238, 185, 96, 201, 38, 104, 215, 236, 99, 223, 134, 157, 237, 254, 36, 49, 242, 100,
      135, 198, 114, 49, 71, 220, 79,
    ]),
  ];

  const inputs = [...sourceInputs, ...sourceInputs.map(x => new Blob([x]))];

  for (let algorithm of [
    Bun.SHA1,
    Bun.SHA224,
    Bun.SHA256,
    Bun.SHA384,
    Bun.SHA512,
    Bun.SHA512_256,
    Bun.MD4,
    Bun.MD5,
  ] as const) {
    test(`second digest should throw an error ${algorithm.name}`, () => {
      const hasher = new algorithm().update("hello");
      hasher.digest();
      expect(() => hasher.digest()).toThrow(
        `${algorithm.name} hasher already digested, create a new instance to digest again`,
      );
      expect(() => hasher.update("world")).toThrow(
        `${algorithm.name} hasher already digested, create a new instance to update`,
      );
    });
  }

  for (let algorithm of ["sha1", "sha256", "sha512", "md5"] as const) {
    describe(algorithm, () => {
      const Class = globalThis.Bun[algorithm.toUpperCase() as "SHA1" | "SHA256" | "SHA512" | "MD5"];
      test("base64", () => {
        for (let buffer of inputs) {
          for (let i = 0; i < 100; i++) {
            const hasher = new Bun.CryptoHasher(algorithm);
            expect(hasher.update(buffer, "base64")).toBeInstanceOf(Bun.CryptoHasher);
            expect(Bun.CryptoHasher.hash(algorithm, buffer, "base64")).toEqual(
              Bun.CryptoHasher.hash(algorithm, buffer, "base64"),
            );

            const instance1 = new Class();
            instance1.update(buffer);
            const instance2 = new Class();
            instance2.update(buffer);

            expect(instance1.digest("base64")).toEqual(instance2.digest("base64"));
            expect(Class.hash(buffer, "base64")).toEqual(Class.hash(buffer, "base64"));
          }
        }
      });

      test("hex", () => {
        for (let buffer of inputs) {
          for (let i = 0; i < 100; i++) {
            const hasher = new Bun.CryptoHasher(algorithm);
            expect(hasher.update(buffer, "hex")).toBeInstanceOf(Bun.CryptoHasher);
            expect(Bun.CryptoHasher.hash(algorithm, buffer, "hex")).toEqual(
              Bun.CryptoHasher.hash(algorithm, buffer, "hex"),
            );

            const instance1 = new Class();
            instance1.update(buffer);
            const instance2 = new Class();
            instance2.update(buffer);

            expect(instance1.digest("hex")).toEqual(instance2.digest("hex"));
            expect(Class.hash(buffer, "hex")).toEqual(Class.hash(buffer, "hex"));
          }
        }
      });

      test("blob", () => {
        for (let buffer of inputs) {
          for (let i = 0; i < 100; i++) {
            const hasher = new Bun.CryptoHasher(algorithm);
            expect(hasher.update(buffer)).toBeInstanceOf(Bun.CryptoHasher);
            expect(Bun.CryptoHasher.hash(algorithm, buffer)).toEqual(Bun.CryptoHasher.hash(algorithm, buffer));

            const instance1 = new Class();
            instance1.update(buffer);
            const instance2 = new Class();
            instance2.update(buffer);

            expect(instance1.digest()).toEqual(instance2.digest());
            expect(Class.hash(buffer)).toEqual(Class.hash(buffer));
          }
        }
      });
    });
  }
});

describe("CryptoHasher", () => {
  const algorithms = [
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
  ] as const;

  for (let algorithm of algorithms) {
    describe(algorithm, () => {
      for (let encoding of ["hex", "base64", "buffer", undefined, "base64url"] as const) {
        describe(encoding || "default", () => {
          test("instance", () => {
            const hasher = new Bun.CryptoHasher(algorithm || undefined);
            hasher.update("hello");
            expect(hasher.digest(encoding)).toEqual(Bun.CryptoHasher.hash(algorithm, "hello", encoding));
          });

          test("consistent", () => {
            const first = Bun.CryptoHasher.hash(algorithm, "hello", encoding);
            withoutAggressiveGC(() => {
              for (let i = 0; i < 100; i++) {
                expect(Bun.CryptoHasher.hash(algorithm, "hello", encoding)).toStrictEqual(first);
              }
            });
          });
        });
      }
    });
  }
});
