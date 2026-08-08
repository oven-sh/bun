import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import nodeCrypto from "node:crypto";

// Not yet in @types/node 25.
const crypto = nodeCrypto as typeof nodeCrypto & {
  argon2: (
    algorithm: string,
    parameters: Record<string, unknown>,
    callback: (err: Error | null, result?: Buffer) => void,
  ) => void;
  argon2Sync: (algorithm: string, parameters: Record<string, unknown>) => Buffer;
};

const message = Buffer.alloc(32, 0x01);
const nonce = Buffer.alloc(16, 0x02);
const secret = Buffer.alloc(8, 0x03);
const associatedData = Buffer.alloc(12, 0x04);
const defaults = { message, nonce, parallelism: 1, tagLength: 64, memory: 8, passes: 3 };

function argon2Async(algorithm: string, parameters: Record<string, unknown>): Promise<Buffer> {
  const { promise, resolve, reject } = Promise.withResolvers<Buffer>();
  crypto.argon2(algorithm, parameters, (err, result) => (err ? reject(err) : resolve(result!)));
  return promise;
}

function expectNodeError(fn: () => unknown, ctor: ErrorConstructor, code: string, message: string) {
  let error: any;
  try {
    fn();
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(ctor);
  expect(error.code).toBe(code);
  expect(error.message).toBe(message);
}

// Same parameter sets and expected outputs as the upstream
// test/js/node/test/parallel/test-crypto-argon2.js (RFC 9106 and OpenSSL 3.2
// test vectors; that file skips under bun because it gates on OpenSSL >= 3.2),
// except the two memory:65536 entries are downsized to memory:4096 to fit
// debug/ASAN time budgets, plus two extras; every output below was generated
// by Node.js v26.3.0.
const vectors: [algorithm: string, overrides: Record<string, unknown>, expectedHex: string][] = [
  [
    "argon2d",
    { secret, associatedData, parallelism: 4, tagLength: 32, memory: 32 },
    "512b391b6f1162975371d30919734294f868e3be3984f3c1a13a4db9fabe4acb",
  ],
  [
    "argon2i",
    { secret, associatedData, parallelism: 4, tagLength: 32, memory: 32 },
    "c814d9d1dc7f37aa13f0d77f2494bda1c8de6b016dd388d29952a4c4672b6ce8",
  ],
  [
    "argon2id",
    { secret, associatedData, parallelism: 4, tagLength: 32, memory: 32 },
    "0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659",
  ],
  [
    "argon2d",
    { message: "1234567890", nonce: "saltsalt" },
    "d16ad773b1c6400d3193bc3e66271603e9de72bace20af3f89c236f5434cdec9" +
      "9072ddfc6b9c77ea9f386c0e8d7cb0c37cec6ec3277a22c92d5be58ef67c7eaa",
  ],
  [
    "argon2id",
    { message: "", parallelism: 4, tagLength: 32, memory: 32 },
    "0a34f1abde67086c82e785eaf17c68382259a264f4e61b91cd2763cb75ac189a",
  ],
  [
    "argon2d",
    { message: "1234567890", nonce: "saltsalt", parallelism: 2, memory: 4096 },
    "491760c694fe6a7c94ab4e6a6344b55115565a6dbb3e078567b3f75c92a6dc5d" +
      "03e823078bfa9811e7be1cc94fa2d9d167ab316aada7d846845ac288aa7e07c7",
  ],
  [
    "argon2i",
    { parallelism: 4, tagLength: 32, memory: 32 },
    "a9a7510e6db4d588ba3414cd0e094d480d683f97b9ccb612a544fe8ef65ba8e0",
  ],
  [
    "argon2id",
    { parallelism: 4, tagLength: 32, memory: 32 },
    "03aab965c12001c9d7d0d2de33192c0494b684bb148196d73c1df1acaf6d0c2e",
  ],
  [
    "argon2d",
    { message: "1234567890", nonce: "saltsalt", parallelism: 2, tagLength: 128, memory: 4096 },
    "4e644cec0ff484c60f220e807147bb9fa2d5085e1ffb4071a8b606446d97e3b5" +
      "57c985d85fca2e6dc7f08b8a2398f79fbf48a642b810c5e2406fe5f5ed959864" +
      "30c73c4ddfda92ea9b6d43dce62078ada1529c4217ae75968f0412140dc00204" +
      "74360ba67e43bef4b790cac30a8fe7f3de8efdaaee5bc44617b39f18bb950c5c",
  ],
  [
    "argon2id",
    {},
    "509fa5d06cdeb30aa3ae36410116bdbd98da46bbe034d50810ba8518de408678" +
      "49ffdc2d57c5562abe837602ac0035c612fab842582e00009bd7733f4e6fd49e",
  ],
  ["argon2id", { passes: 1, tagLength: 4 }, "6e76a640"],
];

describe("crypto.argon2", () => {
  test("exports match node's shape", () => {
    expect(typeof crypto.argon2).toBe("function");
    expect(typeof crypto.argon2Sync).toBe("function");
    expect(crypto.argon2.length).toBe(3);
    expect(crypto.argon2Sync.length).toBe(2);
  });

  describe("derives node's expected output", () => {
    for (const [algorithm, overrides, expected] of vectors) {
      const label = `${algorithm} ${JSON.stringify(overrides).slice(0, 70)}`;
      test(label, async () => {
        const parameters = { ...defaults, ...overrides };

        const syncResult = crypto.argon2Sync(algorithm, parameters);
        expect(Buffer.isBuffer(syncResult)).toBe(true);
        expect(syncResult.toString("hex")).toBe(expected);
        expect(syncResult.length).toBe((parameters.tagLength as number) ?? 64);

        const asyncResult = await argon2Async(algorithm, parameters);
        expect(Buffer.isBuffer(asyncResult)).toBe(true);
        expect(asyncResult.toString("hex")).toBe(expected);
      });
    }
  });

  test("omitted secret/associatedData equals explicit empty", () => {
    const omitted = crypto.argon2Sync("argon2id", defaults);
    const explicitEmpty = crypto.argon2Sync("argon2id", {
      ...defaults,
      secret: Buffer.alloc(0),
      associatedData: Buffer.alloc(0),
    });
    expect(omitted).toEqual(explicitEmpty);
  });

  test("accepts ArrayBuffer and offset TypedArray views for message", () => {
    const base = crypto.argon2Sync("argon2id", { ...defaults, tagLength: 32 });

    const asArrayBuffer = message.buffer.slice(message.byteOffset, message.byteOffset + message.byteLength);
    expect(crypto.argon2Sync("argon2id", { ...defaults, tagLength: 32, message: asArrayBuffer })).toEqual(base);

    // A view whose byteOffset is non-zero must hash only the view's range.
    const padded = Buffer.concat([Buffer.alloc(5, 0xee), message]);
    expect(crypto.argon2Sync("argon2id", { ...defaults, tagLength: 32, message: padded.subarray(5) })).toEqual(base);
  });

  test("async callback gets (null, Buffer) and inputs are copied at call time", async () => {
    const parameters = { ...defaults, tagLength: 32 };
    const expected = crypto.argon2Sync("argon2id", parameters);

    const mutableMessage = Buffer.from(message);
    const mutableNonce = Buffer.from(nonce);
    const { promise, resolve, reject } = Promise.withResolvers<{ err: unknown; result: Buffer }>();
    crypto.argon2("argon2id", { ...parameters, message: mutableMessage, nonce: mutableNonce }, (err, result) => {
      if (err) return reject(err);
      resolve({ err, result: result! });
    });
    // Clobbering the inputs after the call must not affect the job.
    mutableMessage.fill(0xff);
    mutableNonce.fill(0xff);

    const { err, result } = await promise;
    expect(err).toBeNull();
    expect(result).toEqual(expected);
  });

  test("concurrent async jobs all complete", async () => {
    const parameters = { ...defaults, parallelism: 4, tagLength: 32, memory: 32 };
    const algorithms = ["argon2d", "argon2i", "argon2id"];
    const results = await Promise.all(algorithms.map(algorithm => argon2Async(algorithm, parameters)));
    expect(results).toEqual(algorithms.map(algorithm => crypto.argon2Sync(algorithm, parameters)));
  });

  describe("rejects out-of-range parameters like node", () => {
    const cases: [overrides: Record<string, unknown>, message: string][] = [
      [
        { nonce: nonce.subarray(0, 7) },
        'The value of "parameters.nonce.byteLength" is out of range. It must be >= 8 && <= 4294967295. Received 7',
      ],
      [
        { tagLength: 3 },
        'The value of "parameters.tagLength" is out of range. It must be >= 4 && <= 4294967295. Received 3',
      ],
      [
        { tagLength: 2 ** 32 },
        'The value of "parameters.tagLength" is out of range. It must be >= 4 && <= 4294967295. Received 4294967296',
      ],
      [{ passes: 0 }, 'The value of "parameters.passes" is out of range. It must be >= 1 && <= 4294967295. Received 0'],
      [
        { passes: 2 ** 32 },
        'The value of "parameters.passes" is out of range. It must be >= 1 && <= 4294967295. Received 4294967296',
      ],
      [
        { parallelism: 0 },
        'The value of "parameters.parallelism" is out of range. It must be >= 1 && <= 16777215. Received 0',
      ],
      [
        { parallelism: 2 ** 24 },
        'The value of "parameters.parallelism" is out of range. It must be >= 1 && <= 16777215. Received 16777216',
      ],
      [
        { parallelism: 4, memory: 16 },
        'The value of "parameters.memory" is out of range. It must be >= 32 && <= 4294967295. Received 16',
      ],
      [
        { memory: 2 ** 32 },
        'The value of "parameters.memory" is out of range. It must be >= 8 && <= 4294967295. Received 4294967296',
      ],
    ];

    for (const [overrides, errorMessage] of cases) {
      test(JSON.stringify(overrides), () => {
        const parameters = { ...defaults, ...overrides };
        expectNodeError(
          () => crypto.argon2("argon2id", parameters, () => {}),
          RangeError,
          "ERR_OUT_OF_RANGE",
          errorMessage,
        );
        expectNodeError(() => crypto.argon2Sync("argon2id", parameters), RangeError, "ERR_OUT_OF_RANGE", errorMessage);
      });
    }
  });

  describe("rejects missing parameters like node", () => {
    const bufferTypesMessage =
      "must be of type string or an instance of ArrayBuffer, Buffer, TypedArray, or DataView. Received undefined";
    const cases: Record<string, string> = {
      message: `The "parameters.message" property ${bufferTypesMessage}`,
      nonce: `The "parameters.nonce" property ${bufferTypesMessage}`,
      parallelism: 'The "parameters.parallelism" property must be of type number. Received undefined',
      tagLength: 'The "parameters.tagLength" property must be of type number. Received undefined',
      memory: 'The "parameters.memory" property must be of type number. Received undefined',
      passes: 'The "parameters.passes" property must be of type number. Received undefined',
    };

    for (const [key, errorMessage] of Object.entries(cases)) {
      test(key, () => {
        const parameters: Record<string, unknown> = { ...defaults };
        delete parameters[key];
        expectNodeError(
          () => crypto.argon2("argon2id", parameters, () => {}),
          TypeError,
          "ERR_INVALID_ARG_TYPE",
          errorMessage,
        );
        expectNodeError(
          () => crypto.argon2Sync("argon2id", parameters),
          TypeError,
          "ERR_INVALID_ARG_TYPE",
          errorMessage,
        );
      });
    }
  });

  test("rejects invalid algorithm, parameters, and callback like node", () => {
    expectNodeError(
      () => crypto.argon2Sync("argon2x", defaults),
      TypeError,
      "ERR_INVALID_ARG_VALUE",
      "The argument 'algorithm' must be one of: 'argon2d', 'argon2i', 'argon2id'. Received 'argon2x'",
    );
    expectNodeError(
      () => crypto.argon2Sync(5 as any, defaults),
      TypeError,
      "ERR_INVALID_ARG_TYPE",
      'The "algorithm" argument must be of type string. Received type number (5)',
    );
    expectNodeError(
      () => (crypto.argon2 as any)(),
      TypeError,
      "ERR_INVALID_ARG_TYPE",
      'The "algorithm" argument must be of type string. Received undefined',
    );
    expectNodeError(
      () => crypto.argon2Sync("argon2id", null as any),
      TypeError,
      "ERR_INVALID_ARG_TYPE",
      'The "parameters" argument must be of type object. Received null',
    );
    // Parameters are validated before the callback, like node.
    expectNodeError(
      () => (crypto.argon2 as any)("argon2id", null, null),
      TypeError,
      "ERR_INVALID_ARG_TYPE",
      'The "parameters" argument must be of type object. Received null',
    );
    expectNodeError(
      () => (crypto.argon2 as any)("argon2id", defaults, null),
      TypeError,
      "ERR_INVALID_ARG_TYPE",
      'The "callback" argument must be of type function. Received null',
    );
    expectNodeError(
      () => (crypto.argon2 as any)("argon2id", defaults, {}),
      TypeError,
      "ERR_INVALID_ARG_TYPE",
      'The "callback" argument must be of type function. Received an instance of Object',
    );
  });

  test("rejects wrong-typed secret/associatedData", () => {
    // Node currently throws ERR_INTERNAL_ASSERTION here (its check() passes no
    // name to getArrayBufferOrView); throw a proper error naming the property.
    const expected = (name: string) =>
      `The "${name}" property must be of type string or an instance of ArrayBuffer, Buffer, TypedArray, or DataView. Received type number (42)`;
    expectNodeError(
      () => crypto.argon2Sync("argon2id", { ...defaults, secret: 42 }),
      TypeError,
      "ERR_INVALID_ARG_TYPE",
      expected("parameters.secret"),
    );
    expectNodeError(
      () => crypto.argon2Sync("argon2id", { ...defaults, associatedData: 42 }),
      TypeError,
      "ERR_INVALID_ARG_TYPE",
      expected("parameters.associatedData"),
    );
  });

  test("detached message hashes as empty, like node", () => {
    // Matches the empty-string-message vector above.
    const emptyMessageHash = "0a34f1abde67086c82e785eaf17c68382259a264f4e61b91cd2763cb75ac189a";
    const base = { ...defaults, parallelism: 4, tagLength: 32, memory: 32 };

    const detached = new ArrayBuffer(32);
    detached.transfer();
    expect(crypto.argon2Sync("argon2id", { ...base, message: detached }).toString("hex")).toBe(emptyMessageHash);

    const viewBuffer = new ArrayBuffer(32);
    const detachedView = new Uint8Array(viewBuffer);
    viewBuffer.transfer();
    expect(crypto.argon2Sync("argon2id", { ...base, message: detachedView }).toString("hex")).toBe(emptyMessageHash);

    // A detached nonce has byteLength 0 and fails the >= 8 check.
    const detachedNonce = new ArrayBuffer(16);
    detachedNonce.transfer();
    expectNodeError(
      () => crypto.argon2Sync("argon2id", { ...base, nonce: detachedNonce }),
      RangeError,
      "ERR_OUT_OF_RANGE",
      'The value of "parameters.nonce.byteLength" is out of range. It must be >= 8 && <= 4294967295. Received 0',
    );
  });

  test("accepts SharedArrayBuffer inputs, like node", () => {
    // Matches the plain-Buffer vector above with the same bytes.
    const expected = "03aab965c12001c9d7d0d2de33192c0494b684bb148196d73c1df1acaf6d0c2e";
    const sabMessage = new SharedArrayBuffer(32);
    new Uint8Array(sabMessage).fill(0x01);
    const sabNonce = new SharedArrayBuffer(16);
    new Uint8Array(sabNonce).fill(0x02);

    const parameters = { parallelism: 4, tagLength: 32, memory: 32, passes: 3 };
    expect(crypto.argon2Sync("argon2id", { ...parameters, message: sabMessage, nonce: sabNonce }).toString("hex")).toBe(
      expected,
    );
    expect(
      crypto
        .argon2Sync("argon2id", {
          ...parameters,
          message: new Uint8Array(sabMessage),
          nonce: new Uint8Array(sabNonce),
        })
        .toString("hex"),
    ).toBe(expected);
  });

  test("allocation-limit failures are catchable errors, not aborts", async () => {
    // In-range parameters can still exceed what the process can allocate
    // (rust-argon2 allocates infallibly; node surfaces an OpenSSL error).
    // Lower the synthetic limit so the guard fires at test-friendly sizes,
    // and assert both paths deliver node's catchable error.
    using dir = tempDir("argon2-alloc-limit", {
      "check.js": `
        const crypto = require("node:crypto");
        const base = { message: "pw", nonce: "saltsalt", parallelism: 1, tagLength: 32, memory: 8, passes: 1 };
        const results = {};

        try {
          crypto.argon2Sync("argon2id", { ...base, memory: 32 * 1024 }); // 32 MiB > 16 MiB limit
          results.syncMemory = "no error";
        } catch (e) {
          results.syncMemory = e.message;
        }
        try {
          crypto.argon2Sync("argon2id", { ...base, tagLength: 32 * 1024 * 1024 });
          results.syncTagLength = "no error";
        } catch (e) {
          results.syncTagLength = e.message;
        }
        results.withinLimit = crypto.argon2Sync("argon2id", base).length;

        crypto.argon2("argon2id", { ...base, memory: 32 * 1024 }, (err) => {
          results.asyncMemory = err === null ? "no error" : err.message;
          console.log(JSON.stringify(results));
          process.exit(0);
        });
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "check.js"],
      env: { ...bunEnv, BUN_FEATURE_FLAG_SYNTHETIC_MEMORY_LIMIT: String(16 * 1024 * 1024) },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(JSON.parse(stdout.trim())).toEqual({
      syncMemory: "Argon2 derivation failed",
      syncTagLength: "Argon2 derivation failed",
      withinLimit: 32,
      asyncMemory: "Argon2 derivation failed",
    });
    expect(exitCode).toBe(0);
  });
});
