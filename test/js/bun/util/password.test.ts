import { describe, expect, test } from "bun:test";

import { password } from "bun";

const placeholder = "hey";

describe("hash", () => {
  describe("arguments parsing", () => {
    for (let hash of [password.hash, password.hashSync]) {
      test("no blank password allowed", () => {
        expect(() => hash("")).toThrow("password must not be empty");
      });

      test("password is required", () => {
        // @ts-expect-error
        expect(() => hash()).toThrow();
      });

      test("invalid algorithm throws", () => {
        // @ts-expect-error
        expect(() => hash(placeholder, "scrpyt")).toThrow();
        // @ts-expect-error
        expect(() => hash(placeholder, 123)).toThrow();

        expect(() =>
          hash(placeholder, {
            // @ts-expect-error
            toString() {
              return "scrypt";
            },
          }),
        ).toThrow();

        expect(() =>
          hash(placeholder, {
            // @ts-expect-error
            algorithm: "poop",
          }),
        ).toThrow();

        expect(() =>
          hash(placeholder, {
            algorithm: "bcrypt",
            cost: Infinity,
          }),
        ).toThrow();

        expect(() =>
          hash(placeholder, {
            algorithm: "argon2id",
            memoryCost: -1,
          }),
        ).toThrow();

        expect(() =>
          hash(placeholder, {
            algorithm: "argon2id",
            timeCost: -1,
          }),
        ).toThrow();

        expect(() =>
          hash(placeholder, {
            algorithm: "bcrypt",
            cost: -999,
          }),
        ).toThrow();
      });

      test("coercion throwing doesn't crash", () => {
        // @ts-expect-error
        expect(() => hash(Symbol())).toThrow();
        expect(() =>
          // @ts-expect-error
          hash({
            toString() {
              throw new Error("toString() failed");
            },
          }),
        ).toThrow();
      });

      for (let ArrayBufferView of [
        Uint8Array,
        Uint16Array,
        Uint32Array,
        Int8Array,
        Int16Array,
        Int32Array,
        Float16Array,
        Float32Array,
        Float64Array,
        ArrayBuffer,
      ]) {
        test(`empty ${ArrayBufferView.name} throws`, () => {
          expect(() => hash(new ArrayBufferView(0))).toThrow("password must not be empty");
        });
      }
    }
  });
});

describe("verify", () => {
  describe("arguments parsing", () => {
    for (let verify of [password.verify, password.verifySync]) {
      test("minimum args", () => {
        // @ts-expect-error
        expect(() => verify()).toThrow();
        // @ts-expect-error
        expect(() => verify("")).toThrow();
      });

      test("empty values return false", async () => {
        expect(await verify("", "$")).toBeFalse();
        expect(await verify("$", "")).toBeFalse();
      });

      test("invalid algorithm throws", () => {
        // @ts-expect-error
        expect(() => verify(placeholder, "$", "scrpyt")).toThrow();
        // @ts-expect-error
        expect(() => verify(placeholder, "$", 123)).toThrow();
        expect(() =>
          // @ts-expect-error
          verify(placeholder, "$", {
            toString() {
              return "scrypt";
            },
          }),
        ).toThrow();
      });

      test("coercion throwing doesn't crash", () => {
        // @ts-expect-error
        expect(() => verify(Symbol(), Symbol())).toThrow();
        expect(() =>
          verify(
            // @ts-expect-error
            {
              toString() {
                throw new Error("toString() failed");
              },
            },
            "valid",
          ),
        ).toThrow();
        expect(() =>
          // @ts-expect-error
          verify("valid", {
            toString() {
              throw new Error("toString() failed");
            },
          }),
        ).toThrow();
      });

      for (let ArrayBufferView of [
        Uint8Array,
        Uint16Array,
        Uint32Array,
        Int8Array,
        Int16Array,
        Int32Array,
        Float32Array,
        Float64Array,
        ArrayBuffer,
      ]) {
        test(`empty ${ArrayBufferView.name} returns false`, async () => {
          expect(await verify(new ArrayBufferView(0), new ArrayBufferView(0))).toBeFalse();
          expect(await verify("", new ArrayBufferView(0))).toBeFalse();
          expect(await verify(new ArrayBufferView(0), "")).toBeFalse();
        });
      }
    }
  });
});

test("bcrypt uses the SHA-512 of passwords longer than 72 characters", async () => {
  const boop = Buffer.from("hey".repeat(100));
  const hashed = await password.hash(boop, "bcrypt");
  expect(await password.verify(boop, hashed, "bcrypt")).toBeTrue();
  const boop2 = Buffer.from("hey".repeat(24));
  expect(await password.verify(boop2, hashed, "bcrypt")).toBeFalse();
});

test("bcrypt pre-hashing does not break compatibility across Bun versions", async () => {
  // hash generated by Bun 1.2.4
  // if we change the mechanism used to pre-hash long passwords so bcrypt doesn't truncate them,
  // then this hash will not be considered valid by later versions of Bun.
  const hash = "$2b$10$PsJ3/W82mzNJoP0rSblfvet2ab9jZg2aH7tIxr1B8uFLJwuWk/jTi";
  const secret = "hello".repeat(100);
  expect(await password.verify(secret, hash)).toBeTrue();
});

const defaultAlgorithm = "argon2id";
const algorithms = [undefined, "argon2id", "bcrypt"];
const argons = ["argon2i", "argon2id", "argon2d"];

for (let algorithmValue of algorithms) {
  const prefix = algorithmValue === "bcrypt" ? "$2" : "$" + (algorithmValue || defaultAlgorithm);

  describe(algorithmValue ? algorithmValue : "default", () => {
    const hash = (value: string | TypedArray) => {
      return algorithmValue ? password.hashSync(value, algorithmValue as any) : password.hashSync(value);
    };

    const hashSync = (value: string | TypedArray) => {
      return algorithmValue ? password.hashSync(value, algorithmValue as any) : password.hashSync(value);
    };

    const verify = (pw: string | TypedArray, value: string | TypedArray) => {
      return algorithmValue ? password.verify(pw, value, algorithmValue as any) : password.verify(pw, value);
    };

    const verifySync = (pw: string | TypedArray, value: string | TypedArray) => {
      return algorithmValue ? password.verifySync(pw, value, algorithmValue as any) : password.verifySync(pw, value);
    };

    for (let input of [placeholder, Buffer.from(placeholder)]) {
      describe(typeof input === "string" ? "string" : "buffer", () => {
        test("password sync", () => {
          const hashed = hashSync(input);
          expect(hashed).toStartWith(prefix);
          expect(verifySync(input, hashed)).toBeTrue();
          expect(() => verifySync(hashed, input)).toThrow();
          expect(verifySync(input + "\0", hashed)).toBeFalse();
        });

        describe("password", async () => {
          async function runSlowTest(algorithm = algorithmValue as any) {
            const hashed = await password.hash(input, algorithm);
            const prefix = "$" + algorithm;
            expect(hashed).toStartWith(prefix);
            expect(await password.verify(input, hashed, algorithm)).toBeTrue();
            expect(() => password.verify(hashed, input, algorithm)).toThrow();
            expect(await password.verify(input + "\0", hashed, algorithm)).toBeFalse();
          }

          async function runSlowTestWithOptions(algorithmLabel: any) {
            const algorithm = { algorithm: algorithmLabel, timeCost: 5, memoryCost: 8 };
            const hashed = await password.hash(input, algorithm);
            const prefix = "$" + algorithmLabel;
            expect(hashed).toStartWith(prefix);
            expect(hashed).toContain("t=5");
            expect(hashed).toContain("m=8");
            expect(hashed).toContain("p=1");
            expect(await password.verify(input, hashed, algorithmLabel)).toBeTrue();
            expect(() => password.verify(hashed, input, algorithmLabel)).toThrow();
            expect(await password.verify(input + "\0", hashed, algorithmLabel)).toBeFalse();
          }

          async function runSlowBCryptTest() {
            const algorithm = { algorithm: "bcrypt", cost: 4 } as const;
            const hashed = await password.hash(input, algorithm);
            const prefix = "$" + "2b";
            expect(hashed).toStartWith(prefix);
            expect(await password.verify(input, hashed, "bcrypt")).toBeTrue();
            expect(() => password.verify(hashed, input, "bcrypt")).toThrow();
            expect(await password.verify(input + "\0", hashed, "bcrypt")).toBeFalse();
          }

          if (algorithmValue === defaultAlgorithm) {
            // these tests are very slow
            // run the hashing tests in parallel
            for (const a of argons) {
              test(`${a}`, async () => {
                await runSlowTest(a);
                await runSlowTestWithOptions(a);
              });
            }
            return;
          }

          async function defaultTest() {
            const hashed = await hash(input);
            expect(hashed).toStartWith(prefix);
            expect(await verify(input, hashed)).toBeTrue();
            expect(() => verify(hashed, input)).toThrow();
            expect(await verify(input + "\0", hashed)).toBeFalse();
          }

          if (algorithmValue === "bcrypt") {
            test("bcrypt", async () => {
              await defaultTest();
              await runSlowBCryptTest();
            });
          } else {
            test("default", async () => {
              await defaultTest();
            });
          }
        });
      });
    }
  });
}
