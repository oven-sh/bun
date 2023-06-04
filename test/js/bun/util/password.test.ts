import { test, expect, describe } from "bun:test";

import { password, passwordSync } from "bun";

const placeholder = "hey";

describe("hash", () => {
  describe("arguments parsing", () => {
    for (let { hash } of [password, passwordSync]) {
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
          // @ts-expect-error
          hash(placeholder, {
            toString() {
              return "scrypt";
            },
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
    for (let { verify } of [password, passwordSync]) {
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

test("bcrypt longer than 72 characters is the SHA-256", async () => {
  const boop = Buffer.from("hey".repeat(100));
  const hashed = await password.hash(boop, "bcrypt");
  expect(await password.verify(Bun.SHA256.hash(boop), hashed, "bcrypt")).toBeTrue();
});

test("bcrypt shorter than 72 characters is NOT the SHA-256", async () => {
  const boop = Buffer.from("hey".repeat(3));
  const hashed = await password.hash(boop, "bcrypt");
  expect(await password.verify(Bun.SHA256.hash(boop), hashed, "bcrypt")).toBeFalse();
});

const defaultAlgorithm = "argon2";
const algorithms = [undefined, "argon2", "bcrypt"];
const argons = ["argon2", "argon2i", "argon2id", "argon2d"];

for (let algorithmValue of algorithms) {
  const prefix = algorithmValue === "bcrypt" ? "$2" : "$" + (algorithmValue || defaultAlgorithm);

  describe(algorithmValue ? algorithmValue : "default", () => {
    const hash = (value: string | TypedArray) => {
      return algorithmValue ? passwordSync.hash(value, algorithmValue as any) : passwordSync.hash(value);
    };

    const hashSync = (value: string | TypedArray) => {
      return algorithmValue ? passwordSync.hash(value, algorithmValue as any) : passwordSync.hash(value);
    };

    const verify = (pw: string | TypedArray, value: string | TypedArray) => {
      return algorithmValue ? password.verify(pw, value, algorithmValue as any) : password.verify(pw, value);
    };

    const verifySync = (pw: string | TypedArray, value: string | TypedArray) => {
      return algorithmValue ? passwordSync.verify(pw, value, algorithmValue as any) : passwordSync.verify(pw, value);
    };

    for (let input of [placeholder, Buffer.from(placeholder)]) {
      describe(typeof input === "string" ? "string" : "buffer", () => {
        test("passwordSync", () => {
          const hashed = hashSync(input);
          expect(hashed).toStartWith(prefix);
          expect(verifySync(input, hashed)).toBeTrue();
          expect(() => verifySync(hashed, input)).toThrow();
          expect(verifySync(input + "\0", hashed)).toBeFalse();
        });

        test("password", async () => {
          async function runSlowTest(algorithm = algorithmValue as any) {
            const hashed = await password.hash(input, algorithm);

            expect(hashed).toStartWith(prefix);
            expect(await password.verify(input, hashed, algorithm)).toBeTrue();
            expect(() => password.verify(hashed, input, algorithm)).toThrow();
            expect(await password.verify(input + "\0", hashed, algorithm)).toBeFalse();
          }

          if (algorithmValue === "argon2") {
            // these tests are very slow
            // run the hashing tests in parallel
            await Promise.all(argons.map(runSlowTest));
            return;
          }

          const hashed = await hash(input);
          expect(hashed).toStartWith(prefix);
          expect(await verify(input, hashed)).toBeTrue();
          expect(() => verify(hashed, input)).toThrow();
          expect(await verify(input + "\0", hashed)).toBeFalse();
        });
      });
    }
  });
}
