const crypto = require("crypto");
const common = require("../test/common");

import { describe, expect, jest, test } from "bun:test";
function testPBKDF2_(password, salt, iterations, keylen, expected) {
  async function runPBKDF2(password, salt, iterations, keylen, hash) {
    const syncResult = crypto.pbkdf2Sync(password, salt, iterations, keylen, hash);
    const { promise, resolve } = Promise.withResolvers();

    crypto.pbkdf2(password, salt, iterations, keylen, hash, (err, result) => {
      resolve([err, result]);
    });

    expect(syncResult).toStrictEqual(expected);

    const [err, result] = await promise;
    expect(err).toBeNull();
    expect(result).toStrictEqual(expected);
  }

  return runPBKDF2(password, salt, iterations, keylen, "sha256");
}

function testPBKDF2(password, salt, iterations, keylen, expected, encoding = "latin1") {
  test(Buffer.from(expected, encoding).toString("hex"), async () => {
    return testPBKDF2_(password, salt, iterations, keylen, Buffer.from(expected, encoding));
  });
}

//
// Test PBKDF2 with RFC 6070 test vectors (except #4)
//

testPBKDF2(
  "password",
  "salt",
  1,
  20,
  "\x12\x0f\xb6\xcf\xfc\xf8\xb3\x2c\x43\xe7\x22\x52" + "\x56\xc4\xf8\x37\xa8\x65\x48\xc9",
);

testPBKDF2(
  "password",
  "salt",
  2,
  20,
  "\xae\x4d\x0c\x95\xaf\x6b\x46\xd3\x2d\x0a\xdf\xf9" + "\x28\xf0\x6d\xd0\x2a\x30\x3f\x8e",
);

testPBKDF2(
  "password",
  "salt",
  4096,
  20,
  "\xc5\xe4\x78\xd5\x92\x88\xc8\x41\xaa\x53\x0d\xb6" + "\x84\x5c\x4c\x8d\x96\x28\x93\xa0",
);

testPBKDF2(
  "passwordPASSWORDpassword",
  "saltSALTsaltSALTsaltSALTsaltSALTsalt",
  4096,
  25,
  "\x34\x8c\x89\xdb\xcb\xd3\x2b\x2f\x32\xd8\x14\xb8\x11" + "\x6e\x84\xcf\x2b\x17\x34\x7e\xbc\x18\x00\x18\x1c",
);

testPBKDF2("pass\0word", "sa\0lt", 4096, 16, "\x89\xb6\x9d\x05\x16\xf8\x29\x89\x3c\x69\x62\x26\x65" + "\x0a\x86\x87");

testPBKDF2("password", "salt", 32, 32, "64c486c55d30d4c5a079b8823b7d7cb37ff0556f537da8410233bcec330ed956", "hex");

testPBKDF2("", "", 1, 32, "f7ce0b653d2d72a4108cf5abe912ffdd777616dbbb27a70e8204f3ae2d0f6fad", "hex");

describe("invalid inputs", () => {
  for (let input of ["test", [], true, undefined, null]) {
    test(`${input} is invalid`, () => {
      expect(() => crypto.pbkdf2("pass", "salt", input, 8, "sha256")).toThrow(
        `The "iterations" argument must be of type number.${common.invalidArgTypeHelper(input)}`,
      );
    });
  }
  test(`{} is invalid`, () => {
    expect(() => crypto.pbkdf2("pass", "salt", {}, 8, "sha256")).toThrow(
      `The "iterations" argument must be of type number.${common.invalidArgTypeHelper({})}`,
    );
  });

  test("invalid length", () => {
    expect(() => crypto.pbkdf2("password", "salt", 1, -1, "sha256")).toThrow();
  });

  test("%", () => {
    expect(() => crypto.pbkdf2Sync("1", "2", 1, 1, "%")).toThrow();
  });

  [-1, 2147483648, 4294967296].forEach(input => {
    test(`${input}`, () => {
      const outer = jest.fn(() => {
        expect.unreachable();
      });
      expect(() => {
        crypto.pbkdf2("password", "salt", 1, input, "sha256", outer);
      }).toThrow(`The value of "keylen" is out of range. It must be >= 0 and <= 2147483647. Received ${input}`);
      expect(outer).not.toHaveBeenCalled();
    });
  });

  test("digest", () => {
    const err = new Error('Unsupported algorithm "md55"');
    err.code = "ERR_CRYPTO_INVALID_DIGEST";
    let thrown: Error;
    try {
      crypto.pbkdf2("password", "salt", 1, 1, "md55");
      expect.unreachable();
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown.code).toBe("ERR_CRYPTO_INVALID_DIGEST");
    expect(thrown.message).toBe("Invalid digest: md55");
  });
});

[Infinity, -Infinity, NaN].forEach(input => {
  test(`${input} keylen`, () => {
    expect(() => crypto.pbkdf2("password", "salt", 1, input, "sha256")).toThrow(
      `The value of "keylen" is out of range. It must be an integer. Received ${input}`,
    );
  });
});

[-1, 2147483648, 4294967296].forEach(input => {
  test(`${input} keylen`, () => {
    expect(() => crypto.pbkdf2("password", "salt", 1, input, "sha256")).toThrow(
      `The value of "keylen" is out of range. It must be >= 0 and <= 2147483647. Received ${input}`,
    );
  });
});
