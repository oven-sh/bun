import { describe, expect, test } from "bun:test";

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

  for (let algorithm of ["sha1", "sha256", "sha512", "md5"] as const) {
    describe(algorithm, () => {
      const Class = globalThis.Bun[algorithm.toUpperCase() as "SHA1" | "SHA256" | "SHA512" | "MD5"];
      test("base64", () => {
        for (let buffer of inputs) {
          for (let i = 0; i < 100; i++) {
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
    });
  }
});
