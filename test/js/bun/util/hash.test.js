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
it(`Bun.hash.xxHash3()`, () => {
  expect(Bun.hash.xxHash3("hello world")).toBe(0xd447b1ea40e6988bn);
  gcTick();
  expect(Bun.hash.xxHash3(new TextEncoder().encode("hello world"))).toBe(0xd447b1ea40e6988bn);
  gcTick();
  // Test with seed larger than u32: XXH3_64bits_withSeed uses all 64 bits, so
  // seed 2^32 must not collapse to seed 0 (which hashes "" to 0x2d06800538d394c2).
  expect(Bun.hash.xxHash3("", 0n)).toBe(0x2d06800538d394c2n);
  expect(Bun.hash.xxHash3("", 0x1_0000_0000n)).toBe(0x34b7a180c41f536fn);
  // An exactly-representable Number seed above 2^32 is used in full too.
  expect(Bun.hash.xxHash3("", 2 ** 32)).toBe(0x34b7a180c41f536fn);
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

  // Same input generator, but every seed needs more than 32 bits. Expected
  // values come from the xxHash reference (XXH3_64bits_withSeed). The seeds
  // cover: 2^32 (low 32 bits are zero, so a u32 truncation collapses it to the
  // unseeded fast path), 2^32 + 42 (would collide with seed 42), a random
  // 64-bit seed, and all bits set.
  // [length, seed, expected]
  const REFERENCE_64BIT_SEED = [
    [0, 0x1_0000_0000n, 0x34b7a180c41f536fn],
    [0, 0x1_0000_002an, 0x1eec14ff1bfafb7an],
    [0, 0xdeadbeefcafebaben, 0x21605795bc1bc9c4n],
    [0, 0xffffffffffffffffn, 0x4c093276ae47a555n],
    [1, 0x1_0000_0000n, 0x76083b0812f63e66n],
    [1, 0x1_0000_002an, 0x4787dccafeec6e52n],
    [1, 0xdeadbeefcafebaben, 0x914a5d5f0cb39defn],
    [1, 0xffffffffffffffffn, 0x9dd1943f75a68ec3n],
    [3, 0x1_0000_0000n, 0xfa1f55661f405f0en],
    [3, 0x1_0000_002an, 0x334789ce348f8f30n],
    [3, 0xdeadbeefcafebaben, 0x201a4a464c313160n],
    [3, 0xffffffffffffffffn, 0xc7209797f0b3f0b2n],
    [8, 0x1_0000_0000n, 0x3f8c1b077159226cn],
    [8, 0x1_0000_002an, 0x8eaeed133d5c99fbn],
    [8, 0xdeadbeefcafebaben, 0xb362175be8ce7283n],
    [8, 0xffffffffffffffffn, 0x176977e76b669459n],
    [16, 0x1_0000_0000n, 0x2cea1730bd3b4f14n],
    [16, 0x1_0000_002an, 0x4e6bc3e009e4c5ban],
    [16, 0xdeadbeefcafebaben, 0x1d65946cf1e688f6n],
    [16, 0xffffffffffffffffn, 0x7343404694b19f93n],
    [17, 0x1_0000_0000n, 0x477041e817de75fbn],
    [17, 0x1_0000_002an, 0x4a0e7cca2ac8bf41n],
    [17, 0xdeadbeefcafebaben, 0x508784431f977d55n],
    [17, 0xffffffffffffffffn, 0x6023b88d7c2c8a95n],
    [64, 0x1_0000_0000n, 0x1ead349149a9c75dn],
    [64, 0x1_0000_002an, 0xb406c9992d4c37c1n],
    [64, 0xdeadbeefcafebaben, 0x868f02e01945550en],
    [64, 0xffffffffffffffffn, 0x5ec12bd9b5c31ca0n],
    [128, 0x1_0000_0000n, 0x022d53557314659an],
    [128, 0x1_0000_002an, 0x695a773a4469a409n],
    [128, 0xdeadbeefcafebaben, 0x15bb71a9e0c2e76cn],
    [128, 0xffffffffffffffffn, 0x2ac2a3addb897e9an],
    [129, 0x1_0000_0000n, 0x10f541264e0ab54cn],
    [129, 0x1_0000_002an, 0x752fd7499752306en],
    [129, 0xdeadbeefcafebaben, 0xaba4932ad6b61569n],
    [129, 0xffffffffffffffffn, 0xb2b376bbec64b83en],
    [200, 0x1_0000_0000n, 0xf1c19981126cb60en],
    [200, 0x1_0000_002an, 0xbc9d3b30ee04493dn],
    [200, 0xdeadbeefcafebaben, 0x594334aeb7e1e229n],
    [200, 0xffffffffffffffffn, 0x380a4c82bfe8ad13n],
    [240, 0x1_0000_0000n, 0x82b4a745e11a2284n],
    [240, 0x1_0000_002an, 0x7538c1601784cb26n],
    [240, 0xdeadbeefcafebaben, 0x4b699e262b946c53n],
    [240, 0xffffffffffffffffn, 0xa3689d7835f72d8fn],
    // Long-input path (> 240): a nonzero seed selects the derived custom
    // secret, so a seed whose low 32 bits are zero must not fall back to the
    // unseeded default secret.
    [241, 0x1_0000_0000n, 0x233fdf5a3231abd4n],
    [241, 0x1_0000_002an, 0x7f8d4ffecca0c8c4n],
    [241, 0xdeadbeefcafebaben, 0x1828fc39f5dd61dan],
    [241, 0xffffffffffffffffn, 0x302a3fc8ce1044c9n],
    [256, 0x1_0000_0000n, 0x7f61e6e11d99a1f1n],
    [256, 0x1_0000_002an, 0x4cd233e3f03449b8n],
    [256, 0xdeadbeefcafebaben, 0x21b82d1205eddbcan],
    [256, 0xffffffffffffffffn, 0xdd2eb8c75f9e6238n],
    [1024, 0x1_0000_0000n, 0x7950e29cb545cf6en],
    [1024, 0x1_0000_002an, 0x0b2904ef363f21a8n],
    [1024, 0xdeadbeefcafebaben, 0x9f0406dc1ef68f04n],
    [1024, 0xffffffffffffffffn, 0xd7aea37dc6b3021fn],
    [4096, 0x1_0000_0000n, 0x421b68434e1cd82en],
    [4096, 0x1_0000_002an, 0x121e40bb0906d661n],
    [4096, 0xdeadbeefcafebaben, 0x28d85661e3715d8cn],
    [4096, 0xffffffffffffffffn, 0xfa107e6d17eff164n],
    // Multi-block.
    [131072, 0x1_0000_0000n, 0xa6d7500df52ad0ban],
    [131072, 0x1_0000_002an, 0xa21b7370adbdad08n],
    [131072, 0xdeadbeefcafebaben, 0xa784652718de2161n],
    [131072, 0xffffffffffffffffn, 0x7c00937f49671574n],
  ];

  it("matches the xxHash reference for 64-bit seeds across every length branch", () => {
    for (const [len, seed, expected] of REFERENCE_64BIT_SEED) {
      const input = makeInput(len);
      expect(Bun.hash.xxHash3(input, seed)).toBe(expected);
      expect(xxHash3ForTesting(input, seed)).toBe(expected);
    }
  });

  it("the dispatched kernel agrees with Bun.hash.xxHash3 on large inputs", () => {
    // The hook accepts the seed as a number or a bigint; both representations
    // must agree with each other and with Bun.hash.xxHash3, including seeds
    // that need all 64 bits.
    const seeds = [0, 1, 0xabcdef01, 2 ** 32, 0x1_0000_0000n, 0xdeadbeefcafebaben, 0xffffffffffffffffn];
    for (const len of [241, 256, 513, 1024, 65536, 131072]) {
      const input = makeInput(len);
      for (const seed of seeds) {
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
