import { deserialize, serialize } from "bun:jsc";
import { openSync } from "fs";
import { bunEnv, tls } from "harness";
import { bunExe } from "js/bun/shell/test_builder";
import { createPrivateKey, createPublicKey, createSecretKey, KeyObject, X509Certificate } from "node:crypto";
import { BlockList } from "node:net";
import { join } from "path";

// Terminal object types that were never entered into the structured clone object
// reference pool, so duplicated references to them came back as distinct copies.
// `[label, make, expected constructor]`.
const identityCases: [string, () => object, Function][] = [
  ["Date", () => new Date(5), Date],
  ["RegExp", () => /abc/gi, RegExp],
  ["Error", () => new Error("boom"), Error],
  ["EvalError", () => new EvalError("boom"), EvalError],
  ["RangeError", () => new RangeError("boom"), RangeError],
  ["ReferenceError", () => new ReferenceError("boom"), ReferenceError],
  ["SyntaxError", () => new SyntaxError("boom"), SyntaxError],
  ["TypeError", () => new TypeError("boom"), TypeError],
  ["URIError", () => new URIError("boom"), URIError],
  ["DOMException", () => new DOMException("boom", "NotFoundError"), DOMException],
  ["Blob", () => new Blob(["hi"], { type: "text/plain" }), Blob],
  ["File", () => new File(["hi"], "a.txt", { type: "text/plain" }), File],
  ["X509Certificate", () => new X509Certificate(tls.cert), X509Certificate],
  ["secret KeyObject", () => createSecretKey(Buffer.from("0123456789abcdef")), KeyObject],
  ["public KeyObject", () => createPublicKey(tls.key), KeyObject],
  ["private KeyObject", () => createPrivateKey(tls.key), KeyObject],
];

function jscSerializeRoundtrip(value: any) {
  const serialized = serialize(value);
  const cloned = deserialize(serialized);
  return cloned;
}

function jscSerializeRoundtripCrossProcess(original: any) {
  const serialized = serialize(original);

  const result = Bun.spawnSync({
    cmd: [
      bunExe(),
      "-e",
      `
    import {deserialize, serialize} from "bun:jsc";
    const serialized = deserialize(await Bun.stdin.bytes());
    const cloned = serialize(serialized);
    process.stdout.write(cloned);
    `,
    ],
    env: bunEnv,
    stdin: serialized,
    stdout: "pipe",
    stderr: "inherit",
  });
  return deserialize(result.stdout);
}

for (const structuredCloneFn of [structuredClone, jscSerializeRoundtrip, jscSerializeRoundtripCrossProcess]) {
  describe(structuredCloneFn.name, () => {
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
        const cloned = structuredCloneFn(value);
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
      const cloned = structuredCloneFn(input);
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
      const cloned = structuredCloneFn(input);
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
      const cloned = structuredCloneFn(input);
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
      const cloned = structuredCloneFn(input);
      expect(cloned).toBeInstanceOf(Set);
      expect(cloned).not.toBe(input);
      expect(cloned.size).toEqual(input.size);
      for (const value of input) {
        expect(cloned.has(value)).toBe(true);
      }
    });

    // The cross-process transport only adds a process hop over the in-process byte round
    // trip; it is covered once for the whole matrix outside this loop instead of here.
    if (structuredCloneFn !== jscSerializeRoundtripCrossProcess) {
      // Two references to the same object must deserialize to the same object:
      // https://html.spec.whatwg.org/multipage/structured-data.html#structuredserializeinternal
      describe("duplicated references preserve identity", () => {
        test.each(identityCases)("%s", (_label, make, ctor) => {
          const value = make();
          const cloned = structuredCloneFn([value, value]);
          expect(cloned[0]).toBeInstanceOf(ctor);
          expect(cloned[0]).not.toBe(value);
          expect(cloned[0]).toBe(cloned[1]);
        });

        test("CryptoKey", async () => {
          const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
          const cloned = structuredCloneFn([key, key]);
          expect(cloned[0]).toBeInstanceOf(CryptoKey);
          expect(cloned[0]).not.toBe(key);
          expect(cloned[0]).toBe(cloned[1]);
        });

        test("same object reachable through object, array, Map, and Set paths", () => {
          const d = new Date(7);
          const e = new TypeError("boom");
          const cloned = structuredCloneFn({ a: { d, e }, b: [d, e], map: new Map([["d", d]]), set: new Set([e]) });
          expect(cloned.a.d).toBe(cloned.b[0]);
          expect(cloned.a.e).toBe(cloned.b[1]);
          expect(cloned.map.get("d")).toBe(cloned.a.d);
          expect(cloned.set.has(cloned.a.e)).toBe(true);
        });

        // Types that already preserved identity must keep doing so.
        test("control: already-pooled types", () => {
          const obj = { x: 1 };
          const arr = [1];
          const map = new Map();
          const set = new Set();
          const buffer = new ArrayBuffer(4);
          const view = new Uint8Array(buffer);
          const num = Object(1);
          const str = Object("s");
          const bool = Object(true);
          const bigint = Object(123n);
          const cloned = structuredCloneFn([
            [obj, obj],
            [arr, arr],
            [map, map],
            [set, set],
            [buffer, buffer],
            [view, view],
            [num, num],
            [str, str],
            [bool, bool],
            [bigint, bigint],
          ]);
          for (const [first, second] of cloned) {
            expect(first).toBe(second);
          }
        });
      });
    }

    describe("bun blobs work", () => {
      test("simple", async () => {
        const blob = new Blob(["hello"], { type: "application/octet-stream" });
        const cloned = structuredCloneFn(blob);
        await compareBlobs(blob, cloned);
      });
      test("empty", async () => {
        const emptyBlob = new Blob([], { type: "" });
        const clonedEmpty = structuredCloneFn(emptyBlob);
        await compareBlobs(emptyBlob, clonedEmpty);
      });
      test("empty with type", async () => {
        const emptyBlob = new Blob([], { type: "application/octet-stream" });
        const clonedEmpty = structuredCloneFn(emptyBlob);
        await compareBlobs(emptyBlob, clonedEmpty);
      });
      test("unknown type", async () => {
        const blob = new Blob(["hello type"], { type: "this is type" });
        const cloned = structuredCloneFn(blob);
        await compareBlobs(blob, cloned);
      });
      test("file from path", async () => {
        const blob = Bun.file(join(import.meta.dir, "example.txt"));
        const cloned = structuredCloneFn(blob);
        expect(cloned.lastModified).toBe(blob.lastModified);
        expect(cloned.name).toBe(blob.name);
        expect(cloned.size).toBe(blob.size);
      });
      test("file from fd", async () => {
        const fd = openSync(join(import.meta.dir, "example.txt"), "r");
        const blob = Bun.file(fd);
        const cloned = structuredCloneFn(blob);
        expect(cloned.lastModified).toBe(blob.lastModified);
        expect(cloned.name).toBe(blob.name);
        expect(cloned.size).toBe(blob.size);
      });
      describe("dom file", async () => {
        test("without lastModified", async () => {
          const file = new File(["hi"], "example.txt", { type: "text/plain" });
          expect(file.lastModified).toBeGreaterThan(0);
          expect(file.name).toBe("example.txt");
          expect(file.size).toBe(2);
          const cloned = structuredCloneFn(file);
          expect(cloned.lastModified).toBe(file.lastModified);
          expect(cloned.name).toBe(file.name);
          expect(cloned.size).toBe(file.size);
        });
        test("with lastModified", async () => {
          const file = new File(["hi"], "example.txt", { type: "text/plain", lastModified: 123 });
          expect(file.lastModified).toBe(123);
          expect(file.name).toBe("example.txt");
          expect(file.size).toBe(2);
          const cloned = structuredCloneFn(file);
          expect(cloned.lastModified).toBe(123);
          expect(cloned.name).toBe(file.name);
          expect(cloned.size).toBe(file.size);
        });
      });
      test("unpaired high surrogate (invalid utf-8)", async () => {
        const blob = createBlob(encode_cesu8([0xd800]));
        const cloned = structuredCloneFn(blob);
        await compareBlobs(blob, cloned);
      });
      test("unpaired low surrogate (invalid utf-8)", async () => {
        const blob = createBlob(encode_cesu8([0xdc00]));
        const cloned = structuredCloneFn(blob);
        await compareBlobs(blob, cloned);
      });
      test("paired surrogates (invalid utf-8)", async () => {
        const blob = createBlob(encode_cesu8([0xd800, 0xdc00]));
        const cloned = structuredCloneFn(blob);
        await compareBlobs(blob, cloned);
      });
    });

    if (structuredCloneFn === structuredClone) {
      describe("net.BlockList works", () => {
        test("simple", () => {
          const net = require("node:net");
          const blocklist = new net.BlockList();
          blocklist.addAddress("123.123.123.123");
          const newlist = structuredCloneFn(blocklist);
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
          const cloned = structuredCloneFn(buffer, { transfer: [buffer] });
          expect(buffer.byteLength).toBe(0);
          expect(cloned.byteLength).toBe(1);
        });
        test("A detached ArrayBuffer cannot be transferred", () => {
          const buffer = new ArrayBuffer(2);
          structuredCloneFn(buffer, { transfer: [buffer] });
          expect(() => {
            structuredCloneFn(buffer, { transfer: [buffer] });
          }).toThrow(DOMException);
        });
        test("Transferring a non-transferable platform object fails", () => {
          const blob = new Blob();
          expect(() => {
            structuredCloneFn(blob, { transfer: [blob] });
          }).toThrow(DOMException);
        });
      });
    }
  });
}

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

describe("structuredClone with ArrayBuffer larger than serialization buffer capacity", () => {
  // The serialization buffer is a WTF::Vector<uint8_t> capped at 2GiB. Cloning an
  // ArrayBuffer at or above that size must throw DataCloneError instead of aborting.
  // Run in a subprocess so the ~2GiB allocation does not bloat the test runner.
  for (const [label, expr] of [
    ["ArrayBuffer", "new ArrayBuffer(2 ** 31)"],
    ["resizable ArrayBuffer", "new ArrayBuffer(2 ** 31, { maxByteLength: 2 ** 31 + 1 })"],
    ["SharedArrayBuffer", "new SharedArrayBuffer(2 ** 31)"],
    ["growable SharedArrayBuffer", "new SharedArrayBuffer(2 ** 31, { maxByteLength: 2 ** 31 + 1 })"],
    ["Uint8Array", "new Uint8Array(2 ** 31)"],
  ] as const) {
    test(label, async () => {
      const script = `
        let buf;
        try {
          buf = ${expr};
        } catch {
          console.log("SKIP");
          process.exit(0);
        }
        try {
          structuredClone(buf);
          console.log("UNEXPECTED_SUCCESS");
        } catch (e) {
          console.log(e.name);
        }
      `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", script],
        env: bunEnv,
        stdout: "pipe",
        stderr: "inherit",
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      expect(["DataCloneError", "SKIP"]).toContain(stdout.trim());
      expect(exitCode).toBe(0);
    });
  }

  // A large-but-under-2GiB ArrayBuffer nested inside an object/array fills the serialization
  // buffer to its reserved capacity; the subsequent terminator write then triggers vector
  // growth. The default 1.5x growth exceeds the 2GiB cap and would crash. These cases must
  // succeed and round-trip correctly since the total serialized size still fits under 2GiB.
  for (const [label, expr, check] of [
    ["ArrayBuffer in object", "{ h: new ArrayBuffer(size) }", "r.h.byteLength === size"],
    ["ArrayBuffer in array", "[new ArrayBuffer(size)]", "r[0].byteLength === size"],
    ["Uint8Array in object", "{ h: new Uint8Array(size) }", "r.h.byteLength === size"],
    ["nested ArrayBuffer", "{ a: { b: new ArrayBuffer(size) } }", "r.a.b.byteLength === size"],
    [
      "resizable ArrayBuffer in object",
      "{ h: new ArrayBuffer(size, { maxByteLength: size }) }",
      "r.h.byteLength === size",
    ],
  ] as const) {
    test(`${label} under 2GiB clones without crashing`, async () => {
      const script = `
        const size = 1600000000;
        let v;
        try {
          v = ${expr};
        } catch {
          console.log("SKIP");
          process.exit(0);
        }
        const r = structuredClone(v);
        console.log((${check}) ? "OK" : "BAD_ROUNDTRIP");
      `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", script],
        env: bunEnv,
        stdout: "pipe",
        stderr: "inherit",
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      expect(["OK", "SKIP"]).toContain(stdout.trim());
      expect(proc.signalCode).toBe(null);
      expect(exitCode).toBe(0);
    });
  }
});

// A repeated object is serialized as an ObjectReferenceTag holding an index into the
// serializer's object pool. The deserializer must rebuild that pool entry-for-entry:
// any value it appends that the serializer did not record (BigInt primitives,
// CryptoKey, X509Certificate) shifts every later back-reference, and the index byte
// width depends on the pool size, so a big enough mismatch desyncs the whole stream.
for (const structuredCloneFn of [structuredClone, jscSerializeRoundtrip, jscSerializeRoundtripCrossProcess]) {
  describe(`${structuredCloneFn.name}: object pool back-references`, () => {
    test.each([
      ["heap BigInt", 1n],
      ["zero BigInt", 0n],
      ["200-bit BigInt", 2n ** 200n],
      ["BigInt object", Object(7n)],
    ])("a duplicated object after a %s keeps its identity", (_name, bigint) => {
      const o = { x: 1 };
      const c = structuredCloneFn([bigint, o, o]);
      expect(c[1]).toEqual({ x: 1 });
      expect(c[2]).toBe(c[1]);
    });

    test("a circular reference after a BigInt resolves to itself", () => {
      const s: any = {};
      s.self = s;
      const d = structuredCloneFn([1n, s]);
      expect(d[1].self).toBe(d[1]);
    });

    // https://github.com/oven-sh/bun/issues/16547
    test("a TypedArray and DataView sharing an ArrayBuffer, after a BigInt", () => {
      const bf = new ArrayBuffer(128);
      const typed = new Int32Array(bf);
      typed[0] = 0x1234;
      const dataview = new DataView(bf);
      const c = structuredCloneFn({ bigint: 123456789n, bf, typed, dataview });
      expect(c.bigint).toBe(123456789n);
      expect(c.typed).toBeInstanceOf(Int32Array);
      expect(c.typed[0]).toBe(0x1234);
      expect(c.typed.length).toBe(32);
      expect(c.typed.buffer).toBe(c.bf);
      expect(c.dataview.buffer).toBe(c.bf);
    });

    test("a duplicated BigInt object keeps its identity", () => {
      const b = Object(5n);
      const c = structuredCloneFn([b, b]);
      expect(c[0].valueOf()).toBe(5n);
      expect(c[1]).toBe(c[0]);
    });

    // Serializing a non-storable Bun cloneable (BlockList) for storage writes an
    // empty-object placeholder; the serializer must still record it in its pool.
    test("a duplicated object after a net.BlockList keeps its identity", () => {
      const o = { x: 1 };
      const c = structuredCloneFn([new BlockList(), o, o]);
      expect(c[1]).toEqual({ x: 1 });
      expect(c[2]).toBe(c[1]);
    });

    test("a back-reference past 255 interleaved BigInts", () => {
      const o = { marker: "hello" };
      const input: unknown[] = [o];
      for (let i = 0; i < 300; i++) input.push((1n << 64n) + BigInt(i));
      input.push(o);
      const c = structuredCloneFn(input);
      expect(c[300]).toBe((1n << 64n) + 299n);
      expect(c[301]).toEqual({ marker: "hello" });
      expect(c[301]).toBe(c[0]);
    });
  });
}

// CryptoKey and X509Certificate are the platform objects the deserializer appends to
// m_gcBuffer for GC protection without the serializer having recorded them.
for (const structuredCloneFn of [structuredClone, jscSerializeRoundtrip, jscSerializeRoundtripCrossProcess]) {
  describe(`${structuredCloneFn.name}: object pool back-references after platform objects`, () => {
    test("a duplicated object after a CryptoKey keeps its identity", async () => {
      const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 128 }, true, ["encrypt", "decrypt"]);
      const o = { x: 1 };
      const c = structuredCloneFn([key, o, o]);
      expect(c[0]).toBeInstanceOf(CryptoKey);
      expect(c[1]).toEqual({ x: 1 });
      expect(c[2]).toBe(c[1]);
    });

    test("a duplicated object after an X509Certificate keeps its identity", () => {
      const cert = new X509Certificate(tls.cert);
      const o = { x: 1 };
      const c = structuredCloneFn([cert, o, o]);
      expect(c[0]).toBeInstanceOf(X509Certificate);
      expect(c[0].subject).toBe(cert.subject);
      expect(c[1]).toEqual({ x: 1 });
      expect(c[2]).toBe(c[1]);
    });
  });
}

describe("reference pool survives a process boundary", () => {
  // One subprocess hop covering the whole identity matrix.
  test("duplicated references preserve identity for every type", () => {
    const values = identityCases.map(([, make]) => make());
    const cloned = jscSerializeRoundtripCrossProcess(values.map(value => [value, value]));
    for (let i = 0; i < identityCases.length; i++) {
      expect(cloned[i][0]).toBeInstanceOf(identityCases[i][2]);
      expect(cloned[i][0]).toBe(cloned[i][1]);
    }
  });
});

// Version 13 payloads were written before Date, RegExp, Error, and the other terminal
// types were entered into the object reference pool. The deserializer must not pool
// them for version < 14 or its indices stop matching what the writer counted.
describe("deserializing a version 13 payload", () => {
  const version13 = (base64: string) => {
    const bytes = Buffer.from(base64, "base64");
    // Sanity: the first four bytes of a payload are its little-endian version.
    expect(bytes.readUint32LE(0)).toBe(13);
    return deserialize(bytes);
  };

  // serialize([new Date(5), { tag: "first" }, { tag: "second" }, <ref first>, <ref second>])
  // written by Bun 1.4.0. Pooling the Date unconditionally would shift the two
  // back-references onto the Date and `first`.
  test("back-references after a Date are not shifted by the version 14 behavior", () => {
    const cloned = version13(
      "DQAAAAEFAAAAAAAAAAsAAAAAAAAUQAEAAAACAwAAgHRhZxAFAACAZmlyc3T/////AgAAAAL+////ABAGAACAc2Vjb25k/////wMAAAATAQQAAAATAv////8=",
    );
    expect(cloned[0]).toBeInstanceOf(Date);
    expect(+cloned[0]).toBe(5);
    expect(cloned[1]).toEqual({ tag: "first" });
    expect(cloned[2]).toEqual({ tag: "second" });
    expect(cloned[3]).toBe(cloned[1]);
    expect(cloned[4]).toBe(cloned[2]);
  });

  // serialize([new Date(5), new Date(5)]) written by Bun 1.4.0. The identity relationship
  // was never in the version 13 payload, so it cannot be recovered.
  test("duplicated Date references in old payloads stay distinct", () => {
    const cloned = version13("DQAAAAECAAAAAAAAAAsAAAAAAAAUQAEAAAALAAAAAAAAFED/////");
    expect(cloned[0]).toBeInstanceOf(Date);
    expect(cloned[1]).toBeInstanceOf(Date);
    expect(+cloned[0]).toBe(5);
    expect(+cloned[1]).toBe(5);
    expect(cloned[0]).not.toBe(cloned[1]);
  });
});
