import { xxHash3ForTesting } from "bun:internal-for-testing";
import { describe, expect, it } from "bun:test";
import { gcTick } from "harness";

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
it(`Bun.hash.xxHash128()`, () => {
  expect(Bun.hash.xxHash128("hello world")).toBe(0xdf8d09e93f874900a99b8775cc15b6c7n);
  gcTick();
  expect(Bun.hash.xxHash128(new TextEncoder().encode("hello world"))).toBe(0xdf8d09e93f874900a99b8775cc15b6c7n);
  gcTick();
  // The canonical digest (XXH128_canonicalFromHash) is the big-endian hex of the bigint.
  expect(Bun.hash.xxHash128("hello world").toString(16).padStart(32, "0")).toBe("df8d09e93f874900a99b8775cc15b6c7");
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

// Bun.hash.xxHash128 is XXH3_128bits_withSeed. Its short-input branches are
// separate from the 64-bit ones, and its long-input path shares the dispatched
// stripe loop with xxHash3. Expected values come from the xxHash reference
// (v0.8.2), as (high64 << 64n) | low64. Input byte i = (i * 191 + 17) & 0xff.
describe("xxHash128 reference vectors", () => {
  const makeInput = n => {
    const b = new Uint8Array(n);
    for (let i = 0; i < n; i++) b[i] = (i * 191 + 17) & 0xff;
    return b;
  };

  // 0xfedcba9876543210 does not fit in u32, so it checks that the full u64 seed is used.
  const BIG_SEED = 18364758544493064720n;

  // [length, seed, expected], from the reference XXH3_128bits_withSeed.
  const REFERENCE = [
    [0, 0n, 0x99aa06d3014798d86001c324468d497fn],
    [0, 2882400001n, 0xafe8d3f6b2a21e14b232f4f01dfba019n],
    [1, 0n, 0xf46d8182f5a4994af319fe2bdfcdfebdn],
    [1, 42n, 0x7b1882fc7bae7d7a46d8bd2c8a4b5d7cn],
    [1, BIG_SEED, 0xb4c5848cfa18159e6e391427ebfab897n],
    [3, 0n, 0x8f3da70e554cba4c5f0e655f038cc17fn],
    [3, 2882400001n, 0x597eb4168b63d9e76d433d112876736an],
    [4, 0n, 0xebf55fd7f190de905a66c2cd13b4e76an],
    [4, 42n, 0xe421e49b45ee4b1a997f6fefb58a9b7an],
    [4, BIG_SEED, 0x86753af4d40598b38a2b87097619f9dfn],
    [8, 0n, 0x12a88caa499625caf3c783fa5a1b4688n],
    [8, 2882400001n, 0x33e662492d3e67e94a68849b238054d6n],
    [9, 0n, 0x7c5803582b2f059ef4e29ec04b0e1e63n],
    [9, 42n, 0xe09f93dbc753fe7ca7f7ff77e65afe49n],
    [9, BIG_SEED, 0xffedb895b0717dd7eef194b789bcbd38n],
    [16, 0n, 0xd5a006a6c295b0ed4fc686383b65d5aan],
    [16, 2882400001n, 0xfd5c8ccc2b96214ec9797fba53656857n],
    [17, 0n, 0x7269f7707a5633ce34fdba88610c84f0n],
    [17, 42n, 0x555cee2202f0eb819d516a87ea893f55n],
    [17, BIG_SEED, 0x22860a317c761d25942cc22202328f77n],
    // 32, 64, and 96 are the cutoffs of the 17..128 branch.
    [32, 0n, 0xb460d4dc6be0adcb6aa1b5185c4a1bf9n],
    [33, 42n, 0xb5bc1de50fbcfd373e3d21799fac02b8n],
    [64, 2882400001n, 0xcf9bfad8b3365432de19134db8892d66n],
    [65, 0n, 0xdbb73c102b1d241fc065002853df8e7cn],
    [96, 42n, 0x5fa3b9d4dad7646c82c57ae93f82b0c1n],
    [97, BIG_SEED, 0xf5848ceac1e49ec83c1a9fa888f554ccn],
    [128, 0n, 0xa50923197dc0dc531198ac4ec9cfd6efn],
    [128, 2882400001n, 0x7ed5bb4719b1d4ce6569b846a8c6cbafn],
    [129, 0n, 0x7ad3d310e226eae751c73585a2dbe083n],
    [129, 42n, 0xa9cc7ecec36484a6a347abdffb1b594en],
    [129, BIG_SEED, 0xe2c3e2425bf9ad647c03504f9e24492cn],
    // The 129..240 branch mixes one more 32-byte block at 160, 192, and 224.
    [160, 0n, 0x66dc257dd0a336a347ff8069f9d0faf9n],
    [192, 42n, 0xc197ea3ba8c4a096477c04659dc59d93n],
    [224, 2882400001n, 0xa837590456378ff1fced13eed398176an],
    [240, 0n, 0xf260e5c85b249b91791c37dcce4acc6bn],
    [240, 2882400001n, 0xa88c287e75d2c554d53dcf0cc73098fcn],
    // Long-input path (> 240): the Highway-dispatched stripe loop.
    [241, 0n, 0x1c2d14c78686163fdc3fc1135592d6e6n],
    [241, 42n, 0x4755c37801bfb6688ad5972b519634e3n],
    [241, BIG_SEED, 0x89b142e94b6ef433261f3da474ce402an],
    [1024, 0n, 0x1b66ab1db0e725f2a9e2eee0215aa4e9n],
    [1024, 2882400001n, 0x25a0c04ced7e12898863ca2656d5ca77n],
    // Multi-block.
    [131072, 0n, 0x51b9b08e713dd1196afc5e23ce3c83a5n],
    [131072, 42n, 0x6f7e25a68e46bbc4e5e44b2bed110652n],
    [131072, BIG_SEED, 0xb8bf146fcaeaffe124fd0d52bbc1bc0en],
  ];

  it("matches the xxHash reference across every length branch and seed", () => {
    const actual = REFERENCE.map(([len, seed]) => [len, seed, Bun.hash.xxHash128(makeInput(len), seed)]);
    expect(actual).toEqual(REFERENCE);
  });

  it("has the 64-bit hash as its low half for long inputs", () => {
    // XXH3_hashLong_128b merges the same accumulators as the 64-bit hash. The
    // seeds fit in u32, so xxHash3 does not truncate them.
    for (const len of [241, 256, 513, 1024, 65536, 131072]) {
      for (const seed of [0, 1, 0xabcdef01]) {
        const input = makeInput(len);
        expect(Bun.hash.xxHash128(input, seed) & 0xffffffffffffffffn).toBe(Bun.hash.xxHash3(input, seed));
      }
    }
    gcTick();
  });

  it("reads a number seed and a bigint seed the same way", () => {
    const input = makeInput(100);
    const seeds = [0, 1, 0xabcdef01, 2 ** 32, 2 ** 53 - 1];
    expect(seeds.map(seed => Bun.hash.xxHash128(input, seed))).toEqual(
      seeds.map(seed => Bun.hash.xxHash128(input, BigInt(seed))),
    );
    expect(Bun.hash.xxHash128(input, 2 ** 32)).not.toBe(Bun.hash.xxHash128(input, 0));
  });

  it("hashes a string and its UTF-8 bytes identically for a large input", () => {
    const str = Buffer.alloc(100 * 1024, "xABcDpQrStUvWxYz=-1]23]12312312][3123][123][").toString();
    const bytes = new TextEncoder().encode(str);
    expect(Bun.hash.xxHash128(str)).toBe(Bun.hash.xxHash128(bytes));
    expect(Bun.hash.xxHash128(bytes.buffer)).toBe(Bun.hash.xxHash128(bytes));
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
