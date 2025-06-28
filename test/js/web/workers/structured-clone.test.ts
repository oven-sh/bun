import { openSync } from "fs";
import { join } from "path";

describe("structured clone", () => {
  let primitives_tests = [
    { description: "primitive undefined", value: undefined },
    { description: "primitive null", value: null },
    { description: "primitive true", value: true },
    { description: "primitive false", value: false },
    { description: "primitive string, empty string", value: "" },
    { description: "primitive string, lone high surrogate", value: "\uD800" },
    { description: "primitive string, lone low surrogate", value: "\uDC00" },
    { description: "primitive string, NUL", value: "\u0000" },
    { description: "primitive string, astral character", value: "\uDBFF\uDFFD" },
    { description: "primitive number, 0.2", value: 0.2 },
    { description: "primitive number, 0", value: 0 },
    { description: "primitive number, -0", value: -0 },
    { description: "primitive number, NaN", value: NaN },
    { description: "primitive number, Infinity", value: Infinity },
    { description: "primitive number, -Infinity", value: -Infinity },
    { description: "primitive number, 9007199254740992", value: 9007199254740992 },
    { description: "primitive number, -9007199254740992", value: -9007199254740992 },
    { description: "primitive number, 9007199254740994", value: 9007199254740994 },
    { description: "primitive number, -9007199254740994", value: -9007199254740994 },
    { description: "primitive BigInt, 0n", value: 0n },
    { description: "primitive BigInt, -0n", value: -0n },
    { description: "primitive BigInt, -9007199254740994000n", value: -9007199254740994000n },
    {
      description: "primitive BigInt, -9007199254740994000900719925474099400090071992547409940009007199254740994000n",
      value: -9007199254740994000900719925474099400090071992547409940009007199254740994000n,
    },
  ];
  for (let { description, value } of primitives_tests) {
    test(description, () => {
      const cloned = structuredClone(value);
      expect(cloned).toBe(value);
    });
  }

  test("Array with primitives", () => {
    const input = [
      undefined,
      null,
      true,
      false,
      "",
      "\uD800",
      "\uDC00",
      "\u0000",
      "\uDBFF\uDFFD",
      0.2,
      0,
      -0,
      NaN,
      Infinity,
      -Infinity,
      9007199254740992,
      -9007199254740992,
      9007199254740994,
      -9007199254740994,
      -12n,
      -0n,
      0n,
    ];
    const cloned = structuredClone(input);
    expect(cloned).toBeInstanceOf(Array);
    expect(cloned).not.toBe(input);
    expect(cloned.length).toEqual(input.length);
    for (const x in input) {
      expect(cloned[x]).toBe(input[x]);
    }
  });
  test("Object with primitives", () => {
    const input: any = {
      undefined: undefined,
      null: null,
      true: true,
      false: false,
      empty: "",
      "high surrogate": "\uD800",
      "low surrogate": "\uDC00",
      nul: "\u0000",
      astral: "\uDBFF\uDFFD",
      "0.2": 0.2,
      "0": 0,
      "-0": -0,
      NaN: NaN,
      Infinity: Infinity,
      "-Infinity": -Infinity,
      "9007199254740992": 9007199254740992,
      "-9007199254740992": -9007199254740992,
      "9007199254740994": 9007199254740994,
      "-9007199254740994": -9007199254740994,
      "-12n": -12n,
      "-0n": -0n,
      "0n": 0n,
    };
    const cloned = structuredClone(input);
    expect(cloned).toBeInstanceOf(Object);
    expect(cloned).not.toBeInstanceOf(Array);
    expect(cloned).not.toBe(input);
    for (const x in input) {
      expect(cloned[x]).toBe(input[x]);
    }
  });

  test("map", () => {
    const input = new Map();
    input.set("a", 1);
    input.set("b", 2);
    input.set("c", 3);
    const cloned = structuredClone(input);
    expect(cloned).toBeInstanceOf(Map);
    expect(cloned).not.toBe(input);
    expect(cloned.size).toEqual(input.size);
    for (const [key, value] of input) {
      expect(cloned.get(key)).toBe(value);
    }
  });

  test("set", () => {
    const input = new Set();
    input.add("a");
    input.add("b");
    input.add("c");
    const cloned = structuredClone(input);
    expect(cloned).toBeInstanceOf(Set);
    expect(cloned).not.toBe(input);
    expect(cloned.size).toEqual(input.size);
    for (const value of input) {
      expect(cloned.has(value)).toBe(true);
    }
  });

  describe("bun blobs work", () => {
    test("simple", async () => {
      const blob = new Blob(["hello"], { type: "application/octet-stream" });
      const cloned = structuredClone(blob);
      await compareBlobs(blob, cloned);
    });
    test("empty", async () => {
      const emptyBlob = new Blob([], { type: "" });
      const clonedEmpty = structuredClone(emptyBlob);
      await compareBlobs(emptyBlob, clonedEmpty);
    });
    test("empty with type", async () => {
      const emptyBlob = new Blob([], { type: "application/octet-stream" });
      const clonedEmpty = structuredClone(emptyBlob);
      await compareBlobs(emptyBlob, clonedEmpty);
    });
    test("unknown type", async () => {
      const blob = new Blob(["hello type"], { type: "this is type" });
      const cloned = structuredClone(blob);
      await compareBlobs(blob, cloned);
    });
    test("file from path", async () => {
      const blob = Bun.file(join(import.meta.dir, "example.txt"));
      const cloned = structuredClone(blob);
      expect(cloned.lastModified).toBe(blob.lastModified);
      expect(cloned.name).toBe(blob.name);
    });
    test("file from fd", async () => {
      const fd = openSync(join(import.meta.dir, "example.txt"), "r");
      const blob = Bun.file(fd);
      const cloned = structuredClone(blob);
      expect(cloned.lastModified).toBe(blob.lastModified);
      expect(cloned.name).toBe(blob.name);
    });
    describe("dom file", async () => {
      test("without lastModified", async () => {
        const file = new File(["hi"], "example.txt", { type: "text/plain" });
        expect(file.lastModified).toBeGreaterThan(0);
        expect(file.name).toBe("example.txt");
        expect(file.size).toBe(2);
        const cloned = structuredClone(file);
        expect(cloned.lastModified).toBe(file.lastModified);
        expect(cloned.name).toBe(file.name);
        expect(cloned.size).toBe(file.size);
      });
      test("with lastModified", async () => {
        const file = new File(["hi"], "example.txt", { type: "text/plain", lastModified: 123 });
        expect(file.lastModified).toBe(123);
        expect(file.name).toBe("example.txt");
        expect(file.size).toBe(2);
        const cloned = structuredClone(file);
        expect(cloned.lastModified).toBe(123);
        expect(cloned.name).toBe(file.name);
        expect(cloned.size).toBe(file.size);
      });
    });
    test("unpaired high surrogate (invalid utf-8)", async () => {
      const blob = createBlob(encode_cesu8([0xd800]));
      const cloned = structuredClone(blob);
      await compareBlobs(blob, cloned);
    });
    test("unpaired low surrogate (invalid utf-8)", async () => {
      const blob = createBlob(encode_cesu8([0xdc00]));
      const cloned = structuredClone(blob);
      await compareBlobs(blob, cloned);
    });
    test("paired surrogates (invalid utf-8)", async () => {
      const blob = createBlob(encode_cesu8([0xd800, 0xdc00]));
      const cloned = structuredClone(blob);
      await compareBlobs(blob, cloned);
    });
  });

  describe("net.BlockList works", () => {
    test("simple", () => {
      const net = require("node:net");
      const blocklist = new net.BlockList();
      blocklist.addAddress("123.123.123.123");
      const newlist = structuredClone(blocklist);
      expect(newlist.check("123.123.123.123")).toBeTrue();
      expect(!newlist.check("123.123.123.124")).toBeTrue();
      newlist.addAddress("123.123.123.124");
      expect(blocklist.check("123.123.123.124")).toBeTrue();
      expect(newlist.check("123.123.123.124")).toBeTrue();
    });
  });

  describe("transferables", () => {
    test("ArrayBuffer", () => {
      const buffer = Uint8Array.from([1]).buffer;
      const cloned = structuredClone(buffer, { transfer: [buffer] });
      expect(buffer.byteLength).toBe(0);
      expect(cloned.byteLength).toBe(1);
    });
    test("A detached ArrayBuffer cannot be transferred", () => {
      const buffer = new ArrayBuffer(2);
      structuredClone(buffer, { transfer: [buffer] });
      expect(() => {
        structuredClone(buffer, { transfer: [buffer] });
      }).toThrow(DOMException);
    });
    test("Transferring a non-transferable platform object fails", () => {
      const blob = new Blob();
      expect(() => {
        structuredClone(blob, { transfer: [blob] });
      }).toThrow(DOMException);
    });
  });
});

async function compareBlobs(original: Blob, cloned: Blob) {
  expect(cloned).toBeInstanceOf(Blob);
  expect(cloned).not.toBe(original);
  expect(cloned.size).toBe(original.size);
  expect(cloned.type).toBe(original.type);
  const ab1 = await new Response(cloned).arrayBuffer();
  const ab2 = await new Response(original).arrayBuffer();
  expect(ab1.byteLength).toBe(ab2.byteLength);
  const ta1 = new Uint8Array(ab1);
  const ta2 = new Uint8Array(ab2);
  for (let i = 0; i < ta1.length; i++) {
    expect(ta1[i]).toBe(ta2[i]);
  }
}

function encode_cesu8(codeunits: number[]): number[] {
  // http://www.unicode.org/reports/tr26/ section 2.2
  // only the 3-byte form is supported
  const rv: number[] = [];
  codeunits.forEach(function (codeunit) {
    rv.push(b("11100000") + ((codeunit & b("1111000000000000")) >> 12));
    rv.push(b("10000000") + ((codeunit & b("0000111111000000")) >> 6));
    rv.push(b("10000000") + (codeunit & b("0000000000111111")));
  });
  return rv;
}

function b(s: string): number {
  return parseInt(s, 2);
}

function createBlob(arr: number[]): Blob {
  const buffer = new ArrayBuffer(arr.length);
  const view = new DataView(buffer);
  for (let i = 0; i < arr.length; i++) {
    view.setUint8(i, arr[i]);
  }

  return new Blob([view]);
}
