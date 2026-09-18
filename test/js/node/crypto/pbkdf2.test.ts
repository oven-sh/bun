const crypto = require("crypto");
const common = require("../test/common");

import { describe, expect, jest, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { AsyncLocalStorage } from "node:async_hooks";
import { promisify } from "node:util";
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

describe("keylen is the length of the derived key", () => {
  // RFC 7914 section 11: PBKDF2-HMAC-SHA-256, P="passwd", S="salt", c=1, dkLen=64.
  // 64 bytes is two sha256 blocks, and PBKDF2 output is prefix consistent, so a
  // shorter keylen must return exactly the first keylen bytes of this key.
  const rfc7914 = Buffer.from(
    "55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc" +
      "49ca9cccf179b645991664b39d77ef317c71b845b1e30bd509112041d3a19783",
    "hex",
  );

  test.each([1, 31, 32, 33, 63, 64])("keylen=%d", async keylen => {
    const expected = rfc7914.subarray(0, keylen);

    const sync = crypto.pbkdf2Sync("passwd", "salt", 1, keylen, "sha256");
    expect(Buffer.isBuffer(sync)).toBe(true);
    expect(sync.length).toBe(keylen);
    expect(sync).toStrictEqual(expected);

    const { promise, resolve } = Promise.withResolvers();
    crypto.pbkdf2("passwd", "salt", 1, keylen, "sha256", (err, key) => resolve({ err, key }));
    const { err, key } = await promise;
    expect(err).toBeNull();
    expect(Buffer.isBuffer(key)).toBe(true);
    expect(key.length).toBe(keylen);
    expect(key).toStrictEqual(expected);
  });
});

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

test("pbkdf2Sync reads the salt buffer only after every argument has been coerced", () => {
  const salt = new Uint8Array(64).fill(3);
  const password = new String("password");
  password.toString = () => {
    structuredClone(salt.buffer, { transfer: [salt.buffer] });
    Bun.gc(true);
    return "password";
  };
  const key = crypto.pbkdf2Sync(password, salt, 1, 32, "sha256");
  expect(salt.byteLength).toBe(0);
  expect(key).toStrictEqual(crypto.pbkdf2Sync("password", new Uint8Array(0), 1, 32, "sha256"));
});

test("pbkdf2 callback gets (null, Buffer) and keeps the AsyncLocalStorage context", async () => {
  const als = new AsyncLocalStorage();
  const { promise, resolve } = Promise.withResolvers<unknown[]>();
  const returned = als.run("ctx", () =>
    crypto.pbkdf2("pw", "salt", 1, 8, "sha256", function (...args) {
      resolve([args.length, args[0], Buffer.isBuffer(args[1]), args[1].toString("hex"), als.getStore()]);
    }),
  );
  expect(returned).toBeUndefined();
  expect(await promise).toEqual([2, null, true, "6f4ad8c78ec365c0", "ctx"]);
});

test("pbkdf2 keeps the callback alive across GC until the job completes", async () => {
  const expected = crypto.pbkdf2Sync("pw", "salt", 1, 16, "sha256").toString("hex");
  const count = 200;
  const results: string[] = [];
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  for (let i = 0; i < count; i++) {
    // Nothing but the pending job references these callbacks.
    crypto.pbkdf2("pw", "salt", 1, 16, "sha256", (err, key) => {
      if (err) return reject(err);
      results.push(key.toString("hex"));
      if (results.length === count * 2) resolve();
    });
    crypto.pbkdf2("pw", "salt", 1, 0, "sha256", err => {
      results.push(err instanceof Error ? err.message : String(err));
      if (results.length === count * 2) resolve();
    });
    if (i % 50 === 0) Bun.gc(true);
  }
  Bun.gc(true);
  await promise;
  expect(results.filter(r => r === expected)).toHaveLength(count);
  expect(results.filter(r => r === "PBKDF2 derivation failed")).toHaveLength(count);
});

test("pbkdf2 copies password and salt at call time, so the caller can zero them right after the call", async () => {
  const password = Buffer.alloc(4096, "p");
  const salt = Buffer.alloc(16, "s");
  const expected = crypto.pbkdf2Sync(password, salt, 1, 32, "sha256").toString("hex");
  const results: string[] = [];
  for (let i = 0; i < 20; i++) {
    password.fill("p");
    salt.fill("s");
    const { promise, resolve, reject } = Promise.withResolvers<string>();
    crypto.pbkdf2(password, salt, 1, 32, "sha256", (err, key) => (err ? reject(err) : resolve(key.toString("hex"))));
    password.fill(0);
    salt.fill(0);
    results.push(await promise);
  }
  expect(results).toEqual(Array(20).fill(expected));
});

test("pbkdf2 copies the salt buffer only after every argument has been coerced", async () => {
  const salt = new Uint8Array(64).fill(3);
  const password = new String("password");
  password.toString = () => {
    structuredClone(salt.buffer, { transfer: [salt.buffer] });
    Bun.gc(true);
    return "password";
  };
  const key = await promisify(crypto.pbkdf2)(password, salt, 1, 32, "sha256");
  expect(salt.byteLength).toBe(0);
  expect(key).toStrictEqual(crypto.pbkdf2Sync("password", new Uint8Array(0), 1, 32, "sha256"));
});

test("pbkdf2 does not read a resizable ArrayBuffer that shrinks after the call", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const crypto = require("crypto");
        const expected = crypto.pbkdf2Sync(Buffer.alloc(65536, 0x41), "salt", 1, 32, "sha256").toString("hex");
        let wrong = 0;
        for (let i = 0; i < 20; i++) {
          const ab = new ArrayBuffer(65536, { maxByteLength: 1 << 20 });
          new Uint8Array(ab).fill(0x41);
          const { promise, resolve, reject } = Promise.withResolvers();
          crypto.pbkdf2(new Uint8Array(ab), "salt", 1, 32, "sha256", (err, key) => (err ? reject(err) : resolve(key.toString("hex"))));
          ab.resize(0);
          if ((await promise) !== expected) wrong++;
        }
        console.log("wrong:", wrong);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("wrong: 0\n");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test("pbkdf2 copies the salt buffer after a later argument's toString resized it to 0", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const crypto = require("crypto");
        const expected = crypto.pbkdf2Sync("password", new Uint8Array(0), 1, 32, "sha256").toString("hex");
        const salt = new Uint8Array(new ArrayBuffer(65536, { maxByteLength: 65536 })).fill(0x41);
        const password = new String("password");
        password.toString = () => {
          salt.buffer.resize(0);
          return "password";
        };
        crypto.pbkdf2(password, salt, 1, 32, "sha256", (err, key) => {
          if (err) throw err;
          console.log(key.toString("hex") === expected ? "ok" : "wrong");
        });
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("ok\n");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test("pbkdf2 works with util.promisify", async () => {
  const key = await promisify(crypto.pbkdf2)("pw", "salt", 1, 8, "sha256");
  expect(Buffer.isBuffer(key)).toBe(true);
  expect(key.toString("hex")).toBe("6f4ad8c78ec365c0");
});

test("pbkdf2 has the same arity as Node", () => {
  expect([crypto.pbkdf2.name, crypto.pbkdf2.length]).toEqual(["pbkdf2", 6]);
});

test("pbkdf2 validates digest and callback synchronously, like Node", () => {
  // digest omitted: the callback shifts into the digest slot and digest is reported as undefined
  expect(() => crypto.pbkdf2("pw", "salt", 1, 8, (() => {}) as any)).toThrow(
    expect.objectContaining({
      code: "ERR_INVALID_ARG_TYPE",
      message: 'The "digest" argument must be of type string. Received undefined',
    }),
  );
  expect(() => (crypto.pbkdf2 as any)("pw", "salt", 1, 8, "sha256")).toThrow(
    expect.objectContaining({
      code: "ERR_INVALID_ARG_TYPE",
      message: 'The "callback" argument must be of type function. Received undefined',
    }),
  );
  expect(() => crypto.pbkdf2("pw", "salt", 1, 8, "sha256", "not a function" as any)).toThrow(
    expect.objectContaining({
      code: "ERR_INVALID_ARG_TYPE",
      message: `The "callback" argument must be of type function. Received type string ('not a function')`,
    }),
  );
});

test("a throw inside the pbkdf2 callback is an uncaughtException, not an unhandled rejection", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        process.on("uncaughtException", err => console.log("uncaughtException:", err.message));
        process.on("unhandledRejection", err => console.log("unhandledRejection:", err.message));
        require("crypto").pbkdf2("pw", "salt", 1, 8, "sha256", (err, key) => {
          console.log("callback:", err, key.toString("hex"));
          throw new Error("boom");
        });
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("callback: null 6f4ad8c78ec365c0\nuncaughtException: boom\n");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});
