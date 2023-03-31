// most of these tests are taken from Node.js
// thank you Node.js team for the tests
import { expect, it } from "bun:test";
const crypto = require("crypto");

const good = [
  // Zero-length key is legal, functions as a parameter validation check.
  {
    pass: "",
    salt: "",
    keylen: 0,
    N: 16,
    p: 1,
    r: 1,
    expected: "",
  },
  // Test vectors from https://tools.ietf.org/html/rfc7914#page-13 that
  // should pass.  Note that the test vector with N=1048576 is omitted
  // because it takes too long to complete and uses over 1 GB of memory.
  {
    pass: "",
    salt: "",
    keylen: 64,
    N: 16,
    p: 1,
    r: 1,
    expected:
      "77d6576238657b203b19ca42c18a0497f16b4844e3074ae8dfdffa3fede21442" +
      "fcd0069ded0948f8326a753a0fc81f17e8d3e0fb2e0d3628cf35e20c38d18906",
  },
  {
    pass: "password",
    salt: "NaCl",
    keylen: 64,
    N: 1024,
    p: 16,
    r: 8,
    expected:
      "fdbabe1c9d3472007856e7190d01e9fe7c6ad7cbc8237830e77376634b373162" +
      "2eaf30d92e22a3886ff109279d9830dac727afb94a83ee6d8360cbdfa2cc0640",
  },
  {
    pass: "pleaseletmein",
    salt: "SodiumChloride",
    keylen: 64,
    N: 16384,
    p: 1,
    r: 8,
    expected:
      "7023bdcb3afd7348461c06cd81fd38ebfda8fbba904f8e3ea9b543f6545da1f2" +
      "d5432955613f0fcf62d49705242a9af9e61e85dc0d651e40dfcf017b45575887",
  },
  {
    pass: "",
    salt: "",
    keylen: 64,
    cost: 16,
    parallelization: 1,
    blockSize: 1,
    expected:
      "77d6576238657b203b19ca42c18a0497f16b4844e3074ae8dfdffa3fede21442" +
      "fcd0069ded0948f8326a753a0fc81f17e8d3e0fb2e0d3628cf35e20c38d18906",
  },
  {
    pass: "password",
    salt: "NaCl",
    keylen: 64,
    cost: 1024,
    parallelization: 16,
    blockSize: 8,
    expected:
      "fdbabe1c9d3472007856e7190d01e9fe7c6ad7cbc8237830e77376634b373162" +
      "2eaf30d92e22a3886ff109279d9830dac727afb94a83ee6d8360cbdfa2cc0640",
  },
  {
    pass: "pleaseletmein",
    salt: "SodiumChloride",
    keylen: 64,
    cost: 16384,
    parallelization: 1,
    blockSize: 8,
    expected:
      "7023bdcb3afd7348461c06cd81fd38ebfda8fbba904f8e3ea9b543f6545da1f2" +
      "d5432955613f0fcf62d49705242a9af9e61e85dc0d651e40dfcf017b45575887",
  },
];

// Test vectors that should fail.
const bad = [
  { N: 1, p: 1, r: 1 }, // N < 2
  { N: 3, p: 1, r: 1 }, // Not power of 2.
  { N: 1, cost: 1 }, // Both N and cost
  // TODO: these should error, but I don't quite understand why.
  // { p: 1, parallelization: 1 }, // Both p and parallelization
  // { r: 1, blockSize: 1 }, // Both r and blocksize
];

// Test vectors where 128*N*r exceeds maxmem.
const toobig = [
  { N: 2 ** 16, p: 1, r: 1 }, // N >= 2**(r*16)
  { N: 2, p: 2 ** 30, r: 1 }, // p > (2**30-1)/r
  { N: 2 ** 20, p: 1, r: 8 },
  { N: 2 ** 10, p: 1, r: 8, maxmem: 2 ** 20 },
];

const badargs = [
  {
    args: [],
    expected: { code: "ERR_INVALID_ARG_TYPE" /*message: /"password"/ */ },
  },
  {
    args: [null],
    expected: { code: "ERR_INVALID_ARG_TYPE" /*message: /"password"/ */ },
  },
  {
    args: [""],
    expected: { code: "ERR_INVALID_ARG_TYPE" /*message: /"salt"/ */ },
  },
  {
    args: ["", null],
    expected: { code: "ERR_INVALID_ARG_TYPE" /*message: /"salt"/ */ },
  },
  {
    args: ["", ""],
    expected: { code: "ERR_INVALID_ARG_TYPE" /*message: /"keylen"/ */ },
  },
  {
    args: ["", "", null],
    expected: { code: "ERR_INVALID_ARG_TYPE" /*message: /"keylen"/ */ },
  },
  {
    args: ["", "", 42, null],
    expected: { code: "ERR_INVALID_ARG_TYPE" },
  },
  // TODO: throw on these
  // {
  //   args: ["", "", 42, {}],
  //   expected: { code: "ERR_INVALID_ARG_TYPE" },
  // },
  // {
  //   args: ["", "", 42, {}, {}],
  //   expected: { code: "ERR_INVALID_ARG_TYPE" },
  // },
  // {
  //   args: ["", "", 42, {}, null],
  //   expected: { code: "ERR_INVALID_ARG_TYPE" },
  // },
  // {
  //   args: ["", "", 0.42],
  //   expected: { code: "ERR_OUT_OF_RANGE" /*message: /"keylen"/ */ },
  // },
  // {
  //   args: ["", "", -42],
  //   expected: { code: "ERR_OUT_OF_RANGE" /*message: /"keylen"/ */ },
  // },
  // {
  //   args: ["", "", 2147485780],
  //   expected: { code: "ERR_OUT_OF_RANGE" /*message: /"keylen"/ */ },
  // },
  // {
  //   args: ["", "", 0, { maxmem: 2 ** 53 }],
  //   expected: { code: "ERR_OUT_OF_RANGE" /*message: /"keylen"/ */ },
  // },
];

it("scrypt good", () => {
  for (const options of good) {
    const { pass, salt, keylen, expected } = options;
    const actual = crypto.scryptSync(pass, salt, keylen, options);
    expect(actual.toString("hex")).toBe(expected);
  }
});

it("scrypt bad", () => {
  for (const options of bad) {
    expect(() => crypto.scryptSync("pass", "salt", 1, options)).toThrow(/Invalid scrypt param/);
  }
});

it("scrypt toobig", () => {
  for (const options of toobig) {
    expect(() => crypto.scryptSync("pass", "salt", 1, options)).toThrow(/Invalid scrypt param/);
  }
});

it("scrypt defaults eql", () => {
  const defaults = { N: 16384, p: 1, r: 8 };
  const expected = crypto.scryptSync("pass", "salt", 1, defaults);
  const actual = crypto.scryptSync("pass", "salt", 1);
  expect(actual.toString("hex")).toBe(expected.toString("hex"));
});

// TODO: DEFAULT_ENCODING is read-only
// it("scrypt defaults encoding", () => {
//   {
//     const defaultEncoding = crypto.DEFAULT_ENCODING;
//     const defaults = { N: 16384, p: 1, r: 8 };
//     const expected = crypto.scryptSync("pass", "salt", 1, defaults);

//     const testEncoding = "latin1";
//     crypto.DEFAULT_ENCODING = testEncoding;
//     const actual = crypto.scryptSync("pass", "salt", 1);
//     expect(actual).toBe(expected.toString(testEncoding));

//     crypto.DEFAULT_ENCODING = defaultEncoding;
//   }
// });

it("scrypt badargs", () => {
  for (const { args, expected } of badargs) {
    try {
      crypto.scryptSync(...args);
      expect(() => {}).toThrow();
    } catch (e: any) {
      if (!("code" in e)) throw e;
      expect(e.code).toBe(expected.code);
    }
  }

  // {
  //   // Values for maxmem that do not fit in 32 bits but that are still safe
  //   // integers should be allowed.
  //   crypto.scrypt(
  //     "",
  //     "",
  //     4,
  //     { maxmem: 2 ** 52 },
  //     common.mustSucceed((actual) => {
  //       expect(actual.toString("hex")).toBe("d72c87d0");
  //     }),
  //   );
});
