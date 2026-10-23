/**
 * The `context` option of crypto.sign() and crypto.verify(). Node handles it in
 * three places: the type where it reads the options, the length where it builds
 * the job, and support for a context where the job runs. There, a context of
 * zero bytes is no context.
 * https://github.com/nodejs/node/blob/v26.3.0/lib/internal/crypto/sig.js#L109-L120
 * https://github.com/nodejs/node/blob/v26.3.0/src/crypto/crypto_sig.cc#L636-L646
 * https://github.com/nodejs/node/blob/v26.3.0/src/crypto/crypto_sig.cc#L679-L686
 *
 * This file uses node:test/node:assert so the identical file also runs under
 * `node --test`, which is where the expected values come from. It cannot
 * import from "harness" for the same reason.
 *
 * Two results depend on the TLS library, and Node has a branch for each:
 * - Ed25519 with a context of 1 to 255 bytes. OpenSSL signs Ed25519ctx.
 *   BoringSSL takes a context for ML-DSA keys only.
 *   https://github.com/nodejs/node/blob/v26.3.0/src/crypto/crypto_sig.cc#L240-L251
 * - ML-DSA with a digest name and a context. On OpenSSL, Node drops the digest
 *   and signs. On BoringSSL it passes the digest on, and the call fails as it
 *   does without a context.
 *   https://github.com/nodejs/node/blob/v26.3.0/deps/ncrypto/ncrypto.cc#L4457-L4506
 * Node's own binaries use OpenSSL, so `node --test` skips those two.
 */
import assert from "node:assert";
import crypto from "node:crypto";
import { before, describe, test } from "node:test";
import mlDsaVectors from "../test/fixtures/crypto/ml-dsa.js";

// The typings do not have the `context` option and the ML-DSA key types yet.
const { sign, verify, subtle } = crypto as any;

const isBoringSSL = (process.features as { openssl_is_boringssl?: boolean }).openssl_is_boringssl === true;

type ErrorFields = { name: string; code: string; message: string };

describe("the context option of crypto.sign() and crypto.verify()", () => {
  const data = Buffer.from("hello");
  const mlDsa = ["ml-dsa-44", "ml-dsa-65", "ml-dsa-87"];
  const keyTypes = ["ed25519", "ec", "rsa", ...mlDsa];
  const keys: Record<string, { publicKey: crypto.KeyObject; privateKey: crypto.KeyObject; digest: string | null }> = {};
  before(() => {
    for (const type of ["ed25519", "x25519", ...mlDsa])
      keys[type] = { ...crypto.generateKeyPairSync(type as "ed25519"), digest: null };
    keys.ec = { ...crypto.generateKeyPairSync("ec", { namedCurve: "P-256" }), digest: "sha256" };
    keys.rsa = { ...crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }), digest: "sha256" };
  });

  const unsupported: ErrorFields = {
    name: "Error",
    code: "ERR_CRYPTO_OPERATION_FAILED",
    message: "Context parameter is unsupported",
  };
  const tooLong: ErrorFields = {
    name: "RangeError",
    code: "ERR_OUT_OF_RANGE",
    message: "context string must be at most 255 bytes",
  };

  const fields = (err: any): ErrorFields => ({ name: err.name, code: err.code, message: err.message });
  /** What `fn` threw, or undefined. */
  const errorOf = (fn: () => unknown) => {
    try {
      fn();
    } catch (err) {
      return fields(err);
    }
  };
  /**
   * Runs the callback form. Gives what the call threw, or what the callback got and whether the
   * call had returned by then.
   */
  const callbackForm = async (call: (callback: (err: unknown, result?: unknown) => void) => void) => {
    const { promise, resolve } = Promise.withResolvers<{ afterReturn: boolean; err: unknown; result: any }>();
    let returned = false;
    let callbackCalls = 0;
    const threw = errorOf(() =>
      call((err, result) => {
        callbackCalls++;
        resolve({ afterReturn: returned, err: err && fields(err), result });
      }),
    );
    returned = true;
    if (!threw) return promise;
    // If the call that threw also scheduled a job, that job calls back no later than this one.
    const later = Promise.withResolvers<void>();
    sign(null, data, keys.ed25519.privateKey, (err: unknown) => (err ? later.reject(err) : later.resolve()));
    await later.promise;
    return { threw, callbackCalls };
  };
  const failed = (err: ErrorFields | undefined) => ({ afterReturn: true, err, result: undefined });
  const gave = (result: unknown) => ({ afterReturn: true, err: null, result });
  const assertGaveASignature = (outcome: any) => {
    assert.deepStrictEqual({ ...outcome, result: Buffer.isBuffer(outcome.result) }, gave(true));
  };

  const zeroByteViews = {
    "Uint8Array(0)": () => new Uint8Array(0),
    "Buffer.alloc(0)": () => Buffer.alloc(0),
    "DataView(0)": () => new DataView(new ArrayBuffer(0)),
    "Float64Array(0)": () => new Float64Array(0),
    "subarray(0, 0)": () => new Uint8Array(8).subarray(0, 0),
    "a detached view": () => {
      const view = new Uint8Array(1);
      view.buffer.transfer();
      return view;
    },
    "a view on a buffer resized to 0": () => {
      const buffer = new ArrayBuffer(8, { maxByteLength: 16 });
      const view = new Uint8Array(buffer);
      buffer.resize(0);
      return view;
    },
  };

  for (const type of keyTypes) {
    test(`${type}: a context of zero bytes is no context`, async () => {
      const { publicKey, privateKey, digest } = keys[type];
      const plain = sign(digest, data, privateKey);
      const tampered = Buffer.from(plain);
      tampered[0] ^= 1;

      for (const [view, make] of Object.entries(zeroByteViews)) {
        const signed = sign(digest, data, { key: privateKey, context: make() });
        // Ed25519 is deterministic: the same bytes as without the option.
        if (type === "ed25519") assert.deepStrictEqual(signed, plain);
        assert.deepStrictEqual(
          {
            view,
            signedVerifiesWithout: verify(digest, data, publicKey, signed),
            plainVerifiesWith: verify(digest, data, { key: publicKey, context: make() }, plain),
            tamperedVerifiesWith: verify(digest, data, { key: publicKey, context: make() }, tampered),
          },
          { view, signedVerifiesWithout: true, plainVerifiesWith: true, tamperedVerifiesWith: false },
        );
      }

      const context = new Uint8Array(0);
      const signed = await callbackForm(cb => sign(digest, data, { key: privateKey, context }, cb));
      assertGaveASignature(signed);
      assert.strictEqual(verify(digest, data, publicKey, signed.result), true);
      assert.deepStrictEqual(
        await callbackForm(cb => verify(digest, data, { key: publicKey, context }, plain, cb)),
        gave(true),
      );
    });
  }

  test("a context of zero bytes keeps the error of an operation that fails without it", () => {
    const context = new Uint8Array(0);
    const x25519 = keys.x25519.privateKey;
    const ed25519 = keys.ed25519.privateKey;
    const withoutContext = [
      errorOf(() => sign(null, data, { key: x25519 })),
      errorOf(() => sign("sha256", data, { key: ed25519 })),
    ];
    assert.deepStrictEqual(
      withoutContext.map(err => typeof err),
      ["object", "object"],
    );
    assert.deepStrictEqual(
      [
        errorOf(() => sign(null, data, { key: x25519, context })),
        errorOf(() => sign("sha256", data, { key: ed25519, context })),
      ],
      withoutContext,
    );
  });

  for (const type of mlDsa) {
    const skip = !isBoringSSL && "on OpenSSL, Node drops the digest when a context is set";
    test(`${type}: a digest name fails with a context as it fails without one`, { skip }, async () => {
      const { publicKey, privateKey } = keys[type];
      const context = new Uint8Array(1);
      const signature = sign(null, data, { key: privateKey, context });
      const withoutContext = errorOf(() => sign("sha256", data, { key: privateKey }));
      assert.strictEqual(withoutContext?.code, "ERR_OSSL_EVP_COMMAND_NOT_SUPPORTED");
      assert.deepStrictEqual(
        {
          sign: errorOf(() => sign("sha256", data, { key: privateKey, context })),
          verify: errorOf(() => verify("sha256", data, { key: publicKey, context }, signature)),
          signCallback: await callbackForm(cb => sign("sha256", data, { key: privateKey, context }, cb)),
          verifyCallback: await callbackForm(cb => verify("sha256", data, { key: publicKey, context }, signature, cb)),
        },
        {
          sign: withoutContext,
          verify: withoutContext,
          signCallback: failed(withoutContext),
          verifyCallback: failed(withoutContext),
        },
      );
    });
  }

  const notViews: [string, () => unknown, string][] = [
    ["an ArrayBuffer", () => new ArrayBuffer(1), "an instance of ArrayBuffer"],
    ["a SharedArrayBuffer", () => new SharedArrayBuffer(1), "an instance of SharedArrayBuffer"],
    ["an empty string", () => "", "type string ('')"],
    ["a string", () => "abc", "type string ('abc')"],
    ["null", () => null, "null"],
    ["a number", () => 0, "type number (0)"],
    ["a plain object", () => ({}), "an instance of Object"],
  ];
  for (const [name, make, received] of notViews) {
    test(`${name} is not a context: ERR_INVALID_ARG_TYPE, thrown in both forms`, async () => {
      const { publicKey, privateKey } = keys.ed25519;
      const plain = sign(null, data, privateKey);
      const context = make();
      const invalid = {
        name: "TypeError",
        code: "ERR_INVALID_ARG_TYPE",
        message: `The "options.context" property must be an instance of Buffer, TypedArray, or DataView. Received ${received}`,
      };
      assert.deepStrictEqual(
        {
          sign: errorOf(() => sign(null, data, { key: privateKey, context })),
          verify: errorOf(() => verify(null, data, { key: publicKey, context }, plain)),
          signCallback: await callbackForm(cb => sign(null, data, { key: privateKey, context }, cb)),
          verifyCallback: await callbackForm(cb => verify(null, data, { key: publicKey, context }, plain, cb)),
        },
        {
          sign: invalid,
          verify: invalid,
          signCallback: { threw: invalid, callbackCalls: 0 },
          verifyCallback: { threw: invalid, callbackCalls: 0 },
        },
      );
    });
  }

  for (const type of mlDsa) {
    test(`${type} signs and verifies with a context of 1 and of 255 bytes`, async () => {
      const { publicKey, privateKey } = keys[type];
      for (const length of [1, 255]) {
        // A view at an offset, into bytes that all differ. A read of other bytes does not verify.
        const backing = Uint8Array.from({ length: 260 }, (_, i) => i);
        const context = backing.subarray(3, 3 + length);
        const signed = sign(null, data, { key: privateKey, context });
        const viaCallback = await callbackForm(cb => sign(null, data, { key: privateKey, context }, cb));
        assertGaveASignature(viaCallback);
        for (const signature of [signed, viaCallback.result]) {
          assert.deepStrictEqual(
            {
              length,
              sameBytes: verify(null, data, { key: publicKey, context: context.slice() }, signature),
              sameBytesCallback: await callbackForm(cb =>
                verify(null, data, { key: publicKey, context }, signature, cb),
              ),
              bytesAtOffsetZero: verify(
                null,
                data,
                { key: publicKey, context: backing.subarray(0, length) },
                signature,
              ),
              zeroBytes: verify(null, data, { key: publicKey, context: new Uint8Array(0) }, signature),
              noContext: verify(null, data, publicKey, signature),
            },
            {
              length,
              sameBytes: true,
              sameBytesCallback: gave(true),
              bytesAtOffsetZero: false,
              zeroBytes: false,
              noContext: false,
            },
          );
        }
      }
    });
  }

  for (const type of keyTypes) {
    test(`${type}: a context of more than 255 bytes is ERR_OUT_OF_RANGE, thrown in both forms`, async () => {
      const { publicKey, privateKey, digest } = keys[type];
      const plain = sign(digest, data, privateKey);
      const context = new Uint8Array(256);
      assert.deepStrictEqual(
        {
          sign: errorOf(() => sign(digest, data, { key: privateKey, context })),
          verify: errorOf(() => verify(digest, data, { key: publicKey, context }, plain)),
          signCallback: await callbackForm(cb => sign(digest, data, { key: privateKey, context }, cb)),
          verifyCallback: await callbackForm(cb => verify(digest, data, { key: publicKey, context }, plain, cb)),
        },
        {
          sign: tooLong,
          verify: tooLong,
          signCallback: { threw: tooLong, callbackCalls: 0 },
          verifyCallback: { threw: tooLong, callbackCalls: 0 },
        },
      );
    });
  }

  test("the limit of 255 counts bytes, not elements", () => {
    const { publicKey, privateKey } = keys["ml-dsa-44"];
    const context = Uint16Array.from({ length: 127 }, (_, i) => i * 257 + 1);
    const bytes = new Uint8Array(context.buffer);
    const signature = sign(null, data, { key: privateKey, context });
    assert.deepStrictEqual(
      {
        all254Bytes: verify(null, data, { key: publicKey, context: bytes }, signature),
        first127Bytes: verify(null, data, { key: publicKey, context: bytes.subarray(0, 127) }, signature),
        oneElementMore: errorOf(() => sign(null, data, { key: privateKey, context: new Uint16Array(128) })),
      },
      { all254Bytes: true, first127Bytes: false, oneElementMore: tooLong },
    );
  });

  for (const type of ["rsa", "ec", "ed25519", "x25519"]) {
    const skip = type === "ed25519" && !isBoringSSL && "OpenSSL signs Ed25519ctx";
    test(`${type}: a context of 1 or 255 bytes is unsupported`, { skip }, async () => {
      const { publicKey, privateKey, digest } = keys[type];
      const signature = Buffer.alloc(64);
      for (const length of [1, 255]) {
        const context = new Uint8Array(length);
        assert.deepStrictEqual(
          {
            length,
            sign: errorOf(() => sign(digest, data, { key: privateKey, context })),
            verify: errorOf(() => verify(digest, data, { key: publicKey, context }, signature)),
            signCallback: await callbackForm(cb => sign(digest, data, { key: privateKey, context }, cb)),
            verifyCallback: await callbackForm(cb => verify(digest, data, { key: publicKey, context }, signature, cb)),
          },
          {
            length,
            sign: unsupported,
            verify: unsupported,
            signCallback: failed(unsupported),
            verifyCallback: failed(unsupported),
          },
        );
      }
    });
  }

  // Each call is invalid in two ways. The name says which check Node makes first.
  const orderOfTheChecks: [string, () => unknown, string, string][] = [
    [
      "dsaEncoding, then the context type",
      () => sign("sha256", data, { key: keys.rsa.privateKey, dsaEncoding: "nope", context: "abc" }),
      "ERR_INVALID_ARG_VALUE",
      "options.dsaEncoding",
    ],
    [
      "the context type, then the key",
      () => sign("sha256", data, { key: "not a key", context: "abc" }),
      "ERR_INVALID_ARG_TYPE",
      "options.context",
    ],
    [
      "the context type, then the signature type",
      () => verify("sha256", data, { key: keys.rsa.publicKey, context: "abc" }, {}),
      "ERR_INVALID_ARG_TYPE",
      "options.context",
    ],
    [
      "the digest, then the context length",
      () => sign("sha8", data, { key: keys.rsa.privateKey, context: new Uint8Array(256) }),
      "ERR_CRYPTO_INVALID_DIGEST",
      "sha8",
    ],
    [
      "the context length, then support for a context",
      () => sign("sha256", data, { key: keys.rsa.privateKey, context: new Uint8Array(256) }),
      tooLong.code,
      tooLong.message,
    ],
    [
      "the digest, then support for a context",
      () => sign("sha8", data, { key: keys.rsa.privateKey, context: new Uint8Array(1) }),
      "ERR_CRYPTO_INVALID_DIGEST",
      "sha8",
    ],
    [
      "support for a context, then the operation",
      () => sign(null, data, { key: keys.x25519.privateKey, context: new Uint8Array(1) }),
      unsupported.code,
      unsupported.message,
    ],
  ];
  for (const [name, call, code, inMessage] of orderOfTheChecks) {
    test(`order of the checks: ${name}`, () => {
      const err = errorOf(call);
      assert.deepStrictEqual(
        { code: err?.code, messageHas: err?.message.includes(inMessage) },
        { code, messageHas: true },
      );
    });
  }

  test("order of the checks: the key, then the context length", () => {
    const badKey = errorOf(() => sign("sha256", data, { key: "not a key" }));
    assert.strictEqual(typeof badKey, "object");
    assert.deepStrictEqual(
      errorOf(() => sign("sha256", data, { key: "not a key", context: new Uint8Array(256) })),
      badKey,
    );
  });

  test("reads the context bytes after the getters of the key ran", () => {
    {
      const { privateKey } = keys.ed25519;
      const context = new Uint8Array(1);
      const options = {
        context,
        get key() {
          context.buffer.transfer();
          return privateKey;
        },
      };
      assert.deepStrictEqual(sign(null, data, options), sign(null, data, privateKey));
    }
    for (const [length, expected] of [
      [1, unsupported],
      [300, tooLong],
    ] as const) {
      const buffer = new ArrayBuffer(0, { maxByteLength: 512 });
      const options = {
        context: new Uint8Array(buffer),
        get key() {
          buffer.resize(length);
          return keys.rsa.privateKey;
        },
      };
      assert.deepStrictEqual(
        errorOf(() => sign("sha256", data, options)),
        expected,
      );
    }
  });

  test("the callback form uses the context bytes as they were at the call", async () => {
    const { publicKey, privateKey } = keys["ml-dsa-65"];
    const context = Buffer.from("original");
    const { promise, resolve, reject } = Promise.withResolvers<Buffer>();
    sign(null, data, { key: privateKey, context }, (err: unknown, signature: Buffer) =>
      err ? reject(err) : resolve(signature),
    );
    context.fill("X");
    const signature = await promise;
    assert.deepStrictEqual(
      {
        original: verify(null, data, { key: publicKey, context: Buffer.from("original") }, signature),
        overwritten: verify(null, data, { key: publicKey, context }, signature),
      },
      { original: true, overwritten: false },
    );
  });

  for (const type of mlDsa) {
    test(`${type}: a signature with a context verifies in crypto.subtle, and the reverse`, async () => {
      const { publicKey, privateKey } = keys[type];
      const name = type.toUpperCase();
      const spki = publicKey.export({ type: "spki", format: "der" });
      const pkcs8 = privateKey.export({ type: "pkcs8", format: "der" });
      const subtlePublic = await subtle.importKey("spki", spki, { name }, false, ["verify"]);
      const subtlePrivate = await subtle.importKey("pkcs8", pkcs8, { name }, false, ["sign"]);

      // The second context has the 255 bytes of the limit, in a view at an offset.
      for (const context of [Buffer.from("domain"), Uint8Array.from({ length: 300 }, (_, i) => i).subarray(45)]) {
        const signed = sign(null, data, { key: privateKey, context });
        const viaCallback = await callbackForm(cb => sign(null, data, { key: privateKey, context }, cb));
        const fromSubtle = Buffer.from(await subtle.sign({ name, context }, subtlePrivate, data));
        assert.deepStrictEqual(
          {
            length: context.byteLength,
            subtleVerifies: await subtle.verify({ name, context }, subtlePublic, signed, data),
            subtleVerifiesCallbackForm: await subtle.verify({ name, context }, subtlePublic, viaCallback.result, data),
            subtleVerifiesWithoutContext: await subtle.verify({ name }, subtlePublic, signed, data),
            verifiesFromSubtle: verify(null, data, { key: publicKey, context }, fromSubtle),
            verifiesFromSubtleWithoutContext: verify(null, data, publicKey, fromSubtle),
          },
          {
            length: context.byteLength,
            subtleVerifies: true,
            subtleVerifiesCallbackForm: true,
            subtleVerifiesWithoutContext: false,
            verifiesFromSubtle: true,
            verifiesFromSubtleWithoutContext: false,
          },
        );
      }
    });
  }

  // Signatures that OpenSSL made, over contexts of 0, 32 and 255 zero bytes.
  for (const { name, publicKeyPem, privateKeyPem, context, data: message, signature } of mlDsaVectors()) {
    const length: number = context.byteLength;
    test(`${name}: verifies a signature from OpenSSL over a context of ${length} bytes`, async () => {
      // The context sits between other bytes. A read at another offset or of another length does not verify.
      const backing = new Uint8Array(8 + length + 8).fill(0xa5);
      backing.set(context, 8);
      const view = length === 32 ? new Uint16Array(backing.buffer, 8, 16) : new DataView(backing.buffer, 8, length);
      const signed = sign(null, message, { key: privateKeyPem, context: view });
      const results = {
        fromOpenSSL: verify(null, message, { key: publicKeyPem, context: view }, signature),
        fromOpenSSLCallback: await callbackForm(cb =>
          verify(null, message, { key: publicKeyPem, context: view }, signature, cb),
        ),
        fromOpenSSLWithoutContext: verify(null, message, publicKeyPem, signature),
        fromOpenSSLOtherContext: verify(null, message, { key: publicKeyPem, context: Buffer.from("other") }, signature),
        signedThroughTheView: verify(null, message, { key: publicKeyPem, context: Uint8Array.from(context) }, signed),
      };
      if (length > 0) backing[8 + length - 1] ^= 1;
      assert.deepStrictEqual(
        { ...results, afterTheLastByteChanged: verify(null, message, { key: publicKeyPem, context: view }, signed) },
        {
          fromOpenSSL: true,
          fromOpenSSLCallback: gave(true),
          fromOpenSSLWithoutContext: length === 0,
          fromOpenSSLOtherContext: false,
          signedThroughTheView: true,
          afterTheLastByteChanged: length === 0,
        },
      );
    });
  }

  test("createSign and createVerify take no context", () => {
    const { publicKey, privateKey } = keys.rsa;
    const context = new Uint8Array(1);
    const signature = crypto
      .createSign("sha256")
      .update(data)
      .sign({ key: privateKey, context } as any);
    assert.strictEqual(
      crypto
        .createVerify("sha256")
        .update(data)
        .verify({ key: publicKey, context } as any, signature),
      true,
    );
    assert.strictEqual(verify("sha256", data, publicKey, signature), true);
  });

  test("reads context from a key that is a KeyObject or a Buffer", () => {
    const pem = keys.rsa.privateKey.export({ type: "pkcs8", format: "pem" });
    for (const key of [crypto.createPrivateKey(pem), Buffer.from(pem)] as any[]) {
      key.context = new Uint8Array(1);
      assert.deepStrictEqual(
        errorOf(() => sign("sha256", data, key)),
        unsupported,
      );
      key.context = new Uint8Array(0);
      assert.strictEqual(Buffer.isBuffer(sign("sha256", data, key)), true);
    }
  });
});
