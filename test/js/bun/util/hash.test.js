import { xxHash3ForTesting } from "bun:internal-for-testing";
import { describe, expect, it } from "bun:test";
import { gcTick, tempDir } from "harness";
import { join } from "node:path";

it(`Bun.hash()`, () => {
  gcTick();
  expect(Bun.hash("hello world")).toBe(0x668d5e431c3b2573n);
  expect(Bun.hash(new TextEncoder().encode("hello world"))).toBe(0x668d5e431c3b2573n);
});
it(`Bun.hash.wyhash()`, () => {
  expect(Bun.hash.wyhash("hello world")).toBe(0x668d5e431c3b2573n);
  gcTick();
  expect(Bun.hash.wyhash(new TextEncoder().encode("hello world"))).toBe(0x668d5e431c3b2573n);
});
it(`Bun.hash.adler32()`, () => {
  expect(Bun.hash.adler32("hello world")).toBe(0x1a0b045d);
  gcTick();
  expect(Bun.hash.adler32(new TextEncoder().encode("hello world"))).toBe(0x1a0b045d);
});
it(`Bun.hash.crc32()`, () => {
  expect(Bun.hash.crc32("hello world")).toBe(0x0d4a1185);
  gcTick();
  expect(Bun.hash.crc32(new TextEncoder().encode("hello world"))).toBe(0x0d4a1185);
});
it(`Bun.hash.cityHash32()`, () => {
  expect(Bun.hash.cityHash32("hello world")).toBe(0x19a7581a);
  gcTick();
  expect(Bun.hash.cityHash32(new TextEncoder().encode("hello world"))).toBe(0x19a7581a);
  gcTick();
});
it(`Bun.hash.cityHash64()`, () => {
  expect(Bun.hash.cityHash64("hello world")).toBe(0xc7920bbdbecee42fn);
  gcTick();
  expect(Bun.hash.cityHash64(new TextEncoder().encode("hello world"))).toBe(0xc7920bbdbecee42fn);
  gcTick();
});
it(`Bun.hash.xxHash32()`, () => {
  expect(Bun.hash.xxHash32("hello world")).toBe(0xcebb6622);
  gcTick();
  expect(Bun.hash.xxHash32(new TextEncoder().encode("hello world"))).toBe(0xcebb6622);
  gcTick();
});
it(`Bun.hash.xxHash64()`, () => {
  expect(Bun.hash.xxHash64("hello world")).toBe(0x45ab6734b21e6968n);
  gcTick();
  expect(Bun.hash.xxHash64(new TextEncoder().encode("hello world"))).toBe(0x45ab6734b21e6968n);
  gcTick();
  // Test with seed larger than u32
  expect(Bun.hash.xxHash64("", 16269921104521594740n)).toBe(3224619365169652240n);
  gcTick();
});
// Number seeds >= 2^51 used to read as 0 (#41294).
it("Bun.hash.xxHash64() reads a large Number seed exactly", () => {
  const input = "hello world";
  const seeds = [2 ** 51 - 1, 2 ** 51, Number.MAX_SAFE_INTEGER, 2 ** 60, 2 ** 63];
  expect(seeds.map(seed => Bun.hash.xxHash64(input, seed))).toStrictEqual(
    seeds.map(seed => Bun.hash.xxHash64(input, BigInt(seed))),
  );
  expect(Bun.hash.xxHash64(input, 2 ** 51)).not.toBe(Bun.hash.xxHash64(input, 0));
  const max = Bun.hash.xxHash64(input, 2n ** 64n - 1n);
  // >= 2^64 and +Infinity saturate; negatives wrap (int32 -1 and double -1.5 agree); NaN and -Infinity are 0.
  expect([2 ** 64, Infinity, -1, -1.5].map(seed => Bun.hash.xxHash64(input, seed))).toStrictEqual([max, max, max, max]);
  expect(Bun.hash.xxHash64(input, -2)).toBe(Bun.hash.xxHash64(input, 2n ** 64n - 2n));
  const zero = Bun.hash.xxHash64(input, 0);
  expect([NaN, -Infinity].map(seed => Bun.hash.xxHash64(input, seed))).toStrictEqual([zero, zero]);
});
it(`Bun.hash.xxHash3()`, () => {
  expect(Bun.hash.xxHash3("hello world")).toBe(0xd447b1ea40e6988bn);
  gcTick();
  expect(Bun.hash.xxHash3(new TextEncoder().encode("hello world"))).toBe(0xd447b1ea40e6988bn);
  gcTick();
});
it(`Bun.hash.murmur32v3()`, () => {
  expect(Bun.hash.murmur32v3("hello world")).toBe(0x5e928f0f);
  gcTick();
  expect(Bun.hash.murmur32v3(new TextEncoder().encode("hello world"))).toBe(0x5e928f0f);
});
it(`Bun.hash.murmur32v2()`, () => {
  expect(Bun.hash.murmur32v2("hello world")).toBe(0x44a81419);
  gcTick();
  expect(Bun.hash.murmur32v2(new TextEncoder().encode("hello world"))).toBe(0x44a81419);
});
it(`Bun.hash.murmur64v2()`, () => {
  expect(Bun.hash.murmur64v2("hello world")).toBe(0xd3ba2368a832afcen);
  gcTick();
  expect(Bun.hash.murmur64v2(new TextEncoder().encode("hello world"))).toBe(0xd3ba2368a832afcen);
});
it(`Bun.hash.rapidhash()`, () => {
  expect(Bun.hash.rapidhash("hello world")).toBe(0x58a89bdcee89c08cn);
  gcTick();
  expect(Bun.hash.rapidhash(new TextEncoder().encode("hello world"))).toBe(0x58a89bdcee89c08cn);
});
// Bun.hash.xxHash3 is backed by a runtime-dispatched SIMD kernel
// (src/jsc/bindings/xxhash3.cpp). The `len <= 16` case above only exercises
// the scalar short-key branch; these cover every length branch (16 / 128 / 240
// cutoffs, 64-byte stripes, multi-block long inputs) and the seeded
// custom-secret path. Expected values come from the xxHash reference
// (XXH3_64bits_withSeed, v0.8.2 — bit-identical to the twox-hash crate this
// kernel replaces); any SIMD-width divergence would change them.
describe("xxHash3 SIMD kernel", () => {
  // Deterministic input: byte i = (i * 191 + 17) & 0xff.
  const makeInput = n => {
    const b = new Uint8Array(n);
    for (let i = 0; i < n; i++) b[i] = (i * 191 + 17) & 0xff;
    return b;
  };

  // [length, seed, expected] — reference XXH3_64bits_withSeed.
  const REFERENCE = [
    [0, 0n, 0x2d06800538d394c2n],
    [0, 42n, 0xb029411ff43d84d2n],
    [0, 2882400001n, 0x823d212dbc05808an],
    [1, 0n, 0xf319fe2bdfcdfebdn],
    [3, 42n, 0xca175fa91402884fn],
    [4, 0n, 0xaed869f675eac794n],
    [8, 2882400001n, 0x8408fa079f431149n],
    [9, 0n, 0xe17aa5899a63caefn],
    [16, 0n, 0x858ddc7a8189c802n],
    [16, 2882400001n, 0x7353d4b9da395f86n],
    [17, 0n, 0x80ec4e641b4cfc2bn],
    [32, 42n, 0xa91e40e07bc2b693n],
    [64, 0n, 0x9efbe7494c1483f9n],
    [65, 0n, 0x2fdde7eb844656c4n],
    [96, 2882400001n, 0x4701ffae732a05ddn],
    [128, 0n, 0x506426d4fd0a2163n],
    [129, 0n, 0x0fe55d4c5d8d8f71n],
    [160, 42n, 0x0760cc17d49d97b9n],
    [200, 0n, 0x7af78b7865491461n],
    [239, 0n, 0x5e6dd82b298c64d5n],
    [240, 0n, 0x744366c87a6954e9n],
    [240, 2882400001n, 0xdc5d0fd70f358c69n],
    // Long-input path (> 240): the Highway-dispatched stripe loop.
    [241, 0n, 0xdc3fc1135592d6e6n],
    [256, 0n, 0xd3a2265cf3c76bccn],
    [257, 0n, 0xf11e5731791d1209n],
    [257, 2882400001n, 0x9e93f1a43223b5d8n],
    [512, 0n, 0x8f3ce4e54002823bn],
    [513, 42n, 0xab3f1cf78b260c6fn],
    [1024, 0n, 0xa9e2eee0215aa4e9n],
    [1025, 2882400001n, 0xc39418c639c2fab2n],
    [4096, 0n, 0xa8e6a7a23c5b3935n],
    // Multi-block: 64 KB and 128 KB (the canary regression size).
    [65536, 42n, 0x56bfc657f60303can],
    [131072, 0n, 0x6afc5e23ce3c83a5n],
    [131072, 2882400001n, 0x28a47fbb68e0e9abn],
  ];

  it("matches the xxHash reference across every length branch and seed", () => {
    for (const [len, seed, expected] of REFERENCE) {
      const input = makeInput(len);
      expect(xxHash3ForTesting(input, seed)).toBe(expected);
    }
  });

  it("the dispatched kernel agrees with Bun.hash.xxHash3 on large inputs", () => {
    // Bun.hash.xxHash3 truncates the seed to u32 (@truncate); use seeds that
    // fit in u32 so both surfaces take the same seed. The hook accepts the seed
    // as either a number or a bigint — both must agree.
    for (const len of [241, 256, 513, 1024, 65536, 131072]) {
      for (const seed of [0, 1, 0xabcdef01]) {
        const input = makeInput(len);
        expect(xxHash3ForTesting(input, seed)).toBe(xxHash3ForTesting(input, BigInt(seed)));
        expect(Bun.hash.xxHash3(input, seed)).toBe(xxHash3ForTesting(input, seed));
      }
    }
    gcTick();
  });

  it("hashes a string and its UTF-8 bytes identically for a large input", () => {
    const str = Buffer.alloc(100 * 1024, "xABcDpQrStUvWxYz=-1]23]12312312][3123][123][").toString();
    const bytes = new TextEncoder().encode(str);
    expect(Bun.hash.xxHash3(str)).toBe(Bun.hash.xxHash3(bytes));
    expect(Bun.hash.xxHash3(bytes)).toBe(xxHash3ForTesting(bytes));
  });

  it("treats an undefined seed as 0 and rejects other non-number/bigint seeds", () => {
    const bytes = makeInput(256);
    // undefined == no seed
    expect(xxHash3ForTesting(bytes, undefined)).toBe(xxHash3ForTesting(bytes));
    // a wrong-type seed is a mistaken call
    expect(() => xxHash3ForTesting(bytes, "nope")).toThrow("seed must be a number or bigint");
  });
});

// XXH32 and XXH64 are now C++ (src/jsc/bindings/xxhash3.cpp) — scalar, no SIMD
// form in the reference. These vectors pin the output bit-identical to the
// xxHash reference (and the retired twox-hash crate) across every length branch
// (16/32-byte stripes, trailing 4-/1-byte tails) and a seeded case. Input byte
// i = (i * 191 + 17) & 0xff.
describe("xxHash32 / xxHash64 reference vectors", () => {
  const makeInput = n => {
    const b = new Uint8Array(n);
    for (let i = 0; i < n; i++) b[i] = (i * 191 + 17) & 0xff;
    return b;
  };

  it("xxHash32 matches the reference", () => {
    // [length, seed, expected u32]
    const REFERENCE = [
      [0, 0, 0x02cc5d05],
      [0, 0xabcdef01, 0x994fa74b],
      [1, 0, 0xb804f774],
      [3, 0xabcdef01, 0x43722566],
      [4, 0, 0xf025fee3],
      [15, 0, 0x8c29721d],
      [16, 0, 0x9c01fb3f],
      [16, 0xabcdef01, 0x850a7a8c],
      [31, 0, 0x053d400f],
      [32, 0, 0xa756e696],
      [33, 0xabcdef01, 0x62f10491],
      [64, 0, 0x66b9c369],
      [240, 0, 0xf93f2096],
      [256, 0xabcdef01, 0xd19b892a],
      [1024, 0, 0xc6f48900],
      [65536, 0, 0x4eaba9f5],
      [131072, 0xabcdef01, 0x55124bc7],
    ];
    for (const [len, seed, expected] of REFERENCE) {
      expect(Bun.hash.xxHash32(makeInput(len), seed)).toBe(expected);
    }
  });

  it("xxHash64 matches the reference", () => {
    // [length, seed, expected u64]
    const REFERENCE = [
      [0, 0n, 0xef46db3751d8e999n],
      [0, 0xabcdef01n, 0x4ec16b94b18c49efn],
      [1, 0n, 0xad10cd9780ac4ff7n],
      [3, 0xabcdef01n, 0xf63c72cac1f3f4c4n],
      [4, 0n, 0x7e8a72c9a223a1c0n],
      [8, 0n, 0xb6e941d7f6bbbb0cn],
      [15, 0n, 0x131410330f796b84n],
      [16, 0n, 0x82facd078c4684ccn],
      [31, 0xabcdef01n, 0xea551fb3e7ef7b93n],
      [32, 0n, 0xd27d959564fd4575n],
      [33, 0n, 0x2d5ce4a1d52b96den],
      [64, 0xabcdef01n, 0x84ce6b0d00882c58n],
      [240, 0n, 0xb1d89115ab8aa560n],
      [256, 0n, 0x5ace78799b251d86n],
      [1024, 0xabcdef01n, 0x52a820eb6c45f54en],
      [65536, 0n, 0x86ec0151ae772f43n],
      [131072, 0n, 0x6d834d77afc89932n],
    ];
    for (const [len, seed, expected] of REFERENCE) {
      expect(Bun.hash.xxHash64(makeInput(len), seed)).toBe(expected);
    }
  });
});

describe("what Bun.hash and its algorithms take", () => {
  const functions = [Bun.hash, ...Object.values(Bun.hash)];
  const bytes = new TextEncoder().encode("hello world!");

  it("there are thirteen functions, and Bun.hash is wyhash", () => {
    expect(functions).toHaveLength(13);
    expect(Bun.hash).toBeFunction();
    expect(Bun.hash.name).toBe("hash");
    for (const hash of functions) expect(hash.length).toBe(1);
    expect(Bun.hash("a", 5n)).toBe(Bun.hash.wyhash("a", 5n));
  });

  it("the same bytes hash the same, whatever holds them", () => {
    const shared = new Uint8Array(new SharedArrayBuffer(bytes.length));
    shared.set(bytes);
    const padded = new Uint8Array(bytes.length + 8);
    padded.set(bytes, 4);
    for (const hash of functions) {
      const expected = hash("hello world!");
      for (const data of [
        bytes,
        bytes.buffer,
        Buffer.from(bytes),
        new DataView(bytes.buffer),
        new Uint32Array(bytes.buffer),
        padded.subarray(4, 4 + bytes.length),
        shared,
        shared.buffer,
        new Blob([bytes]),
        new String("hello world!"),
        { toString: () => "hello world!" },
      ]) {
        expect(hash(data)).toBe(expected);
      }
    }
  });

  it("a Blob that is a file is refused, and does not hash as nothing", () => {
    const s3 = new Bun.S3Client({ accessKeyId: "id", secretAccessKey: "secret", bucket: "bucket" });
    for (const hash of functions) {
      expect(() => hash(Bun.file(import.meta.path))).toThrow("File blob cannot be used here");
      expect(() => hash(s3.file("key"))).toThrow("File blob cannot be used here");
    }
  });

  it("an output of Bun.build() hashes as its bytes, and one written to outdir is refused", async () => {
    using dir = tempDir("hash-build-output", { "entry.js": `console.log("hello world!");` });
    const entrypoints = [join(String(dir), "entry.js")];
    const inMemory = (await Bun.build({ entrypoints })).outputs[0];
    const written = (await Bun.build({ entrypoints, outdir: join(String(dir), "out") })).outputs[0];
    const code = new Uint8Array(await inMemory.arrayBuffer());
    expect(code.length).toBeGreaterThan(0);
    for (const hash of functions) {
      expect(hash(inMemory)).toBe(hash(code));
      expect(() => hash(written)).toThrow("File blob cannot be used here");
    }
  });

  it("nothing to hash is refused, and does not hash as its name", () => {
    const refusal = expect.objectContaining({
      name: "TypeError",
      code: "ERR_INVALID_ARG_TYPE",
      message: "data must be a string, ArrayBuffer, ArrayBufferView or Blob",
    });
    for (const hash of functions) {
      expect(() => hash()).toThrow(refusal);
      expect(() => hash(undefined)).toThrow(refusal);
      expect(() => hash(null, 1)).toThrow(refusal);
    }
  });

  it("anything else is converted to a string", () => {
    for (const hash of functions) {
      for (const value of [0, 5, NaN, false, 10n, [1, 2], {}]) expect(hash(value)).toBe(hash(String(value)));
    }
  });

  it("a seed that is neither a number nor a BigInt is not converted", () => {
    const seeded = functions.filter(hash => hash("a", 1) !== hash("a"));
    expect(seeded).toHaveLength(11);
    const unconverted = {
      valueOf() {
        throw new Error("the seed was converted");
      },
    };
    for (const hash of functions) {
      for (const seed of [undefined, null, "1", true, [1], unconverted]) expect(hash("a", seed)).toBe(hash("a", 0));
    }
    for (const hash of seeded) expect(hash("a", 1n)).toBe(hash("a", 1));
  });
});

it("does not crash when changing Int32Array constructor with Bun.hash.xxHash32 as species", () => {
  const arr = new Int32Array();
  function foo(a4) {
    return a4;
  }
  foo[Symbol.species] = Bun.hash.xxHash32;
  arr.constructor = foo;

  expect(() => {
    arr.map(Bun.hash.xxHash32);
  }).toThrow("species is not a constructor");
});
