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

[Infinity, -Infinity, NaN, 32.9, 1.5, 0.5, -0.5].forEach(input => {
  test(`${input} keylen`, () => {
    expect(() => crypto.pbkdf2("password", "salt", 1, input, "sha256")).toThrow(
      expect.objectContaining({
        name: "RangeError",
        code: "ERR_OUT_OF_RANGE",
        message: `The value of "keylen" is out of range. It must be an integer. Received ${input}`,
      }),
    );
    expect(() => crypto.pbkdf2Sync("password", "salt", 1, input, "sha256")).toThrow(
      expect.objectContaining({
        name: "RangeError",
        code: "ERR_OUT_OF_RANGE",
        message: `The value of "keylen" is out of range. It must be an integer. Received ${input}`,
      }),
    );
  });
});

[Infinity, -Infinity, NaN, 1.5, 0.5].forEach(input => {
  test(`${input} iterations`, () => {
    expect(() => crypto.pbkdf2("password", "salt", input, 8, "sha256", () => {})).toThrow(
      expect.objectContaining({
        name: "RangeError",
        code: "ERR_OUT_OF_RANGE",
        message: `The value of "iterations" is out of range. It must be an integer. Received ${input}`,
      }),
    );
    expect(() => crypto.pbkdf2Sync("password", "salt", input, 8, "sha256")).toThrow(
      expect.objectContaining({
        name: "RangeError",
        code: "ERR_OUT_OF_RANGE",
        message: `The value of "iterations" is out of range. It must be an integer. Received ${input}`,
      }),
    );
  });
});

[0, -0].forEach(input => {
  test(`keylen=${Object.is(input, -0) ? "-0" : "0"} fails sync`, () => {
    expect(() => crypto.pbkdf2Sync("p", "s", 1, input, "sha256")).toThrow(
      expect.objectContaining({ name: "Error", message: "PBKDF2 derivation failed" }),
    );
  });
});

// The password's toString() runs after the salt slice is captured; detaching
// the salt there must not let the KDF read freed memory.
test("pbkdf2Sync derives from the salt bytes at call time when a String-object password detaches them", () => {
  const keep = [];
  const size = 1 << 16;
  const salt = Buffer.from(new ArrayBuffer(size));
  salt.fill(0x41);
  const pwStr = Buffer.alloc(32, 0x41).toString();

  class DetachingPassword extends String {
    toString() {
      salt.buffer.transfer(0);
      Bun.gc(true);
      for (let i = 0; i < 96; i++) {
        const x = new Uint8Array(size);
        x.fill(0x5a);
        keep.push(x);
      }
      Bun.gc(true);
      return pwStr;
    }
  }

  const got = crypto.pbkdf2Sync(new DetachingPassword(pwStr), salt, 1000, 16, "sha256").toString("hex");
  const expected = crypto.pbkdf2Sync(pwStr, Buffer.alloc(size, 0x41), 1000, 16, "sha256").toString("hex");
  const recycled = crypto.pbkdf2Sync(pwStr, Buffer.alloc(size, 0x5a), 1000, 16, "sha256").toString("hex");

  expect({ got, matchesRecycled: got === recycled }).toEqual({ got: expected, matchesRecycled: false });
});

test("keylen=0 fails async via callback", async () => {
  const { promise, resolve } = Promise.withResolvers();
  let threwSync = false;
  try {
    crypto.pbkdf2("p", "s", 1, 0, "sha256", (err, key) => resolve({ err, key }));
  } catch {
    threwSync = true;
  }
  expect(threwSync).toBe(false);
  const { err, key } = await promise;
  expect(key).toBeUndefined();
  expect(err).toBeInstanceOf(Error);
  expect(err.message).toBe("PBKDF2 derivation failed");
});

[-1, 2147483648, 4294967296, 2 ** 52].forEach(input => {
  test(`${input} keylen`, () => {
    expect(() => crypto.pbkdf2("password", "salt", 1, input, "sha256")).toThrow(
      `The value of "keylen" is out of range. It must be >= 0 and <= 2147483647. Received ${input}`,
    );
  });
});
