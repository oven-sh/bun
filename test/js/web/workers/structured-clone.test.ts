import { deserialize, serialize } from "bun:jsc";
import { openSync } from "fs";
import { bunEnv, bunExe, tls } from "harness";
import { createPrivateKey, createPublicKey, createSecretKey, KeyObject, X509Certificate } from "node:crypto";
import { BlockList } from "node:net";
import * as v8 from "node:v8";
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

// Cold variant: a brand-new Bun process per clone, so the deserialize happens in a
// completely fresh JSC VM (empty object pool, first-touch platform-object structures).
function jscSerializeRoundtripCrossProcessCold(original: any) {
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

// Warm variant: one long-lived child process shared by every cross-process clone in the
// file, speaking a length-prefixed request/reply framing over stdin/stdout. Each value
// still crosses a real process boundary through bun:jsc serialize/deserialize.
const crossProcessChildScript = `
  import { deserialize, serialize } from "bun:jsc";
  let chunks = [];
  let total = 0;
  for await (const chunk of Bun.stdin.stream()) {
    chunks.push(Buffer.from(chunk));
    total += chunk.byteLength;
    while (total >= 4) {
      const buf = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks);
      const len = buf.readUInt32LE(0);
      if (total < 4 + len) {
        chunks = [buf];
        break;
      }
      const cloned = serialize(deserialize(buf.subarray(4, 4 + len)));
      const header = Buffer.alloc(4);
      header.writeUInt32LE(cloned.byteLength, 0);
      process.stdout.write(header);
      process.stdout.write(cloned);
      chunks = [buf.subarray(4 + len)];
      total -= 4 + len;
    }
  }
`;

type CrossProcessChild = {
  proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
  reader: ReadableStreamDefaultReader<Uint8Array>;
  chunks: Uint8Array[];
  total: number;
  stderr: Promise<string>;
};
let crossProcessChild: CrossProcessChild | null = null;

function spawnCrossProcessChild(): CrossProcessChild {
  const proc = Bun.spawn({
    cmd: [bunExe(), "-e", crossProcessChildScript],
    env: bunEnv,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  return { proc, reader: proc.stdout.getReader(), chunks: [], total: 0, stderr: proc.stderr.text() };
}

afterAll(() => {
  crossProcessChild?.proc.kill();
  crossProcessChild = null;
});

async function jscSerializeRoundtripCrossProcess(original: any) {
  const serialized = serialize(original);
  // Respawned lazily after a crash so one failing test does not cascade into the rest.
  const child = (crossProcessChild ??= spawnCrossProcessChild());

  const header = Buffer.alloc(4);
  header.writeUInt32LE(serialized.byteLength, 0);
  child.proc.stdin.write(header);
  child.proc.stdin.write(serialized);
  child.proc.stdin.flush();

  async function readExactly(n: number): Promise<Buffer> {
    while (child.total < n) {
      const { done, value } = await child.reader.read();
      if (done) {
        crossProcessChild = null;
        const stderr = await child.stderr;
        await child.proc.exited;
        throw new Error(
          `cross-process serialize child exited (code ${child.proc.exitCode}, signal ${child.proc.signalCode})\n${stderr}`,
        );
      }
      // Copy: the stream may reuse its backing buffer across read() calls.
      child.chunks.push(value.slice());
      child.total += value.byteLength;
    }
    const buf =
      child.chunks.length === 1
        ? Buffer.from(child.chunks[0].buffer, child.chunks[0].byteOffset, child.chunks[0].byteLength)
        : Buffer.concat(child.chunks);
    child.chunks = [buf.subarray(n)];
    child.total -= n;
    // Copy so the returned bytes do not alias the shared accumulation buffer.
    return Buffer.from(buf.subarray(0, n));
  }

  const len = (await readExactly(4)).readUInt32LE(0);
  return deserialize(await readExactly(len));
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
      test(description, async () => {
        const cloned = await structuredCloneFn(value);
        expect(cloned).toBe(value);
      });
    }

    test("Array with primitives", async () => {
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
      const cloned = await structuredCloneFn(input);
      expect(cloned).toBeInstanceOf(Array);
      expect(cloned).not.toBe(input);
      expect(cloned.length).toEqual(input.length);
      for (const x in input) {
        expect(cloned[x]).toBe(input[x]);
      }
    });
    test("Object with primitives", async () => {
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
      const cloned = await structuredCloneFn(input);
      expect(cloned).toBeInstanceOf(Object);
      expect(cloned).not.toBeInstanceOf(Array);
      expect(cloned).not.toBe(input);
      for (const x in input) {
        expect(cloned[x]).toBe(input[x]);
      }
    });

    test("map", async () => {
      const input = new Map();
      input.set("a", 1);
      input.set("b", 2);
      input.set("c", 3);
      const cloned = await structuredCloneFn(input);
      expect(cloned).toBeInstanceOf(Map);
      expect(cloned).not.toBe(input);
      expect(cloned.size).toEqual(input.size);
      for (const [key, value] of input) {
        expect(cloned.get(key)).toBe(value);
      }
    });

    test("set", async () => {
      const input = new Set();
      input.add("a");
      input.add("b");
      input.add("c");
      const cloned = await structuredCloneFn(input);
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
        const cloned = await structuredCloneFn(blob);
        await compareBlobs(blob, cloned);
      });
      test("empty", async () => {
        const emptyBlob = new Blob([], { type: "" });
        const clonedEmpty = await structuredCloneFn(emptyBlob);
        await compareBlobs(emptyBlob, clonedEmpty);
      });
      test("empty with type", async () => {
        const emptyBlob = new Blob([], { type: "application/octet-stream" });
        const clonedEmpty = await structuredCloneFn(emptyBlob);
        await compareBlobs(emptyBlob, clonedEmpty);
      });
      test("unknown type", async () => {
        const blob = new Blob(["hello type"], { type: "this is type" });
        const cloned = await structuredCloneFn(blob);
        await compareBlobs(blob, cloned);
      });
      test("file from path", async () => {
        const blob = Bun.file(join(import.meta.dir, "example.txt"));
        const cloned = await structuredCloneFn(blob);
        expect(cloned.lastModified).toBe(blob.lastModified);
        expect(cloned.name).toBe(blob.name);
        expect(cloned.size).toBe(blob.size);
      });
      test("file from fd", async () => {
        const fd = openSync(join(import.meta.dir, "example.txt"), "r");
        const blob = Bun.file(fd);
        const cloned = await structuredCloneFn(blob);
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
          const cloned = await structuredCloneFn(file);
          expect(cloned.lastModified).toBe(file.lastModified);
          expect(cloned.name).toBe(file.name);
          expect(cloned.size).toBe(file.size);
        });
        test("with lastModified", async () => {
          const file = new File(["hi"], "example.txt", { type: "text/plain", lastModified: 123 });
          expect(file.lastModified).toBe(123);
          expect(file.name).toBe("example.txt");
          expect(file.size).toBe(2);
          const cloned = await structuredCloneFn(file);
          expect(cloned.lastModified).toBe(123);
          expect(cloned.name).toBe(file.name);
          expect(cloned.size).toBe(file.size);
        });
      });
      test("unpaired high surrogate (invalid utf-8)", async () => {
        const blob = createBlob(encode_cesu8([0xd800]));
        const cloned = await structuredCloneFn(blob);
        await compareBlobs(blob, cloned);
      });
      test("unpaired low surrogate (invalid utf-8)", async () => {
        const blob = createBlob(encode_cesu8([0xdc00]));
        const cloned = await structuredCloneFn(blob);
        await compareBlobs(blob, cloned);
      });
      test("paired surrogates (invalid utf-8)", async () => {
        const blob = createBlob(encode_cesu8([0xd800, 0xdc00]));
        const cloned = await structuredCloneFn(blob);
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
        // https://html.spec.whatwg.org/multipage/structured-data.html#structuredserializeinternal
        // Serializing (not transferring) a detached ArrayBuffer must throw a
        // "DataCloneError" DOMException, not a TypeError.
        test("Serializing a detached ArrayBuffer throws DataCloneError", () => {
          const buffer = new ArrayBuffer(8);
          structuredCloneFn(buffer, { transfer: [buffer] }); // detach it
          expect(buffer.byteLength).toBe(0);
          for (const value of [buffer, { buffer }, [buffer], new Map([["k", buffer]])]) {
            let error: unknown;
            try {
              structuredCloneFn(value);
            } catch (e) {
              error = e;
            }
            expect(error).toBeInstanceOf(DOMException);
            expect((error as DOMException).name).toBe("DataCloneError");
            expect((error as DOMException).code).toBe(DOMException.DATA_CLONE_ERR);
          }
        });
        test("Transferring a non-transferable platform object fails", () => {
          const blob = new Blob();
          expect(() => {
            structuredCloneFn(blob, { transfer: [blob] });
          }).toThrow(DOMException);
        });
        // https://html.spec.whatwg.org/multipage/structured-data.html#dom-structuredclone
        // `transfer` is a WebIDL sequence<object>: it is converted (and may throw)
        // before anything is serialized, so a rejected call must not detach buffers.
        test("an invalid entry in transfer throws TypeError without detaching other entries", () => {
          const buffer = new ArrayBuffer(8);
          for (const entry of [null, undefined, 42, "x", true, Symbol("s"), 123n]) {
            expect(() => structuredCloneFn({ buffer }, { transfer: [buffer, entry as any] })).toThrow(TypeError);
            expect(buffer.byteLength).toBe(8);
          }
        });
        test("a transfer value that is not a sequence throws TypeError", () => {
          const buffer = new ArrayBuffer(8);
          for (const transfer of [5, "abc", {}, null, true]) {
            expect(() => structuredCloneFn({ buffer }, { transfer: transfer as any })).toThrow(TypeError);
            expect(buffer.byteLength).toBe(8);
          }
        });
        test("options that are not an object throw TypeError", () => {
          for (const options of [42, "x", true, Symbol("s")]) {
            expect(() => structuredCloneFn(1, options as any)).toThrow(TypeError);
          }
        });
        test("transfer accepts any iterable of transferables", () => {
          const buffer = new ArrayBuffer(8);
          const cloned = structuredCloneFn({ buffer }, { transfer: new Set([buffer]) as any });
          expect(cloned.buffer.byteLength).toBe(8);
          expect(buffer.byteLength).toBe(0);
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
      // The smallest size (plus margin) whose 1.5x serialization-buffer growth
      // exceeds the 2GiB cap (2**31 / 1.5 = ~1.43e9); peak child memory is ~3x.
      const script = `
        const size = 1_500_000_000;
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
      // The host's OOM killer reclaiming the child on a small CI runner is not a
      // structuredClone failure; any other signal (SIGSEGV/SIGABRT/...) still is.
      if (proc.signalCode === "SIGKILL" && stdout === "") return;
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
    ])("a duplicated object after a %s keeps its identity", async (_name, bigint) => {
      const o = { x: 1 };
      const c = await structuredCloneFn([bigint, o, o]);
      expect(c[1]).toEqual({ x: 1 });
      expect(c[2]).toBe(c[1]);
    });

    test("a circular reference after a BigInt resolves to itself", async () => {
      const s: any = {};
      s.self = s;
      const d = await structuredCloneFn([1n, s]);
      expect(d[1].self).toBe(d[1]);
    });

    // https://github.com/oven-sh/bun/issues/16547
    test("a TypedArray and DataView sharing an ArrayBuffer, after a BigInt", async () => {
      const bf = new ArrayBuffer(128);
      const typed = new Int32Array(bf);
      typed[0] = 0x1234;
      const dataview = new DataView(bf);
      const c = await structuredCloneFn({ bigint: 123456789n, bf, typed, dataview });
      expect(c.bigint).toBe(123456789n);
      expect(c.typed).toBeInstanceOf(Int32Array);
      expect(c.typed[0]).toBe(0x1234);
      expect(c.typed.length).toBe(32);
      expect(c.typed.buffer).toBe(c.bf);
      expect(c.dataview.buffer).toBe(c.bf);
    });

    test("a duplicated BigInt object keeps its identity", async () => {
      const b = Object(5n);
      const c = await structuredCloneFn([b, b]);
      expect(c[0].valueOf()).toBe(5n);
      expect(c[1]).toBe(c[0]);
    });

    // Serializing a non-storable Bun cloneable (BlockList) for storage writes an
    // empty-object placeholder; the serializer must still record it in its pool.
    test("a duplicated object after a net.BlockList keeps its identity", async () => {
      const o = { x: 1 };
      const c = await structuredCloneFn([new BlockList(), o, o]);
      expect(c[1]).toEqual({ x: 1 });
      expect(c[2]).toBe(c[1]);
    });

    test("a back-reference past 255 interleaved BigInts", async () => {
      const o = { marker: "hello" };
      const input: unknown[] = [o];
      for (let i = 0; i < 300; i++) input.push((1n << 64n) + BigInt(i));
      input.push(o);
      const c = await structuredCloneFn(input);
      expect(c[300]).toBe((1n << 64n) + 299n);
      expect(c[301]).toEqual({ marker: "hello" });
      expect(c[301]).toBe(c[0]);
    });
  });
}

// CryptoKey and X509Certificate are the platform objects the deserializer appends to
// m_gcBuffer for GC protection without the serializer having recorded them. The cold
// cross-process variant is included so their first deserialize in a fresh VM stays covered.
for (const structuredCloneFn of [
  structuredClone,
  jscSerializeRoundtrip,
  jscSerializeRoundtripCrossProcess,
  jscSerializeRoundtripCrossProcessCold,
]) {
  describe(`${structuredCloneFn.name}: object pool back-references after platform objects`, () => {
    test("a duplicated object after a CryptoKey keeps its identity", async () => {
      const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 128 }, true, ["encrypt", "decrypt"]);
      const o = { x: 1 };
      const c = await structuredCloneFn([key, o, o]);
      expect(c[0]).toBeInstanceOf(CryptoKey);
      expect(c[1]).toEqual({ x: 1 });
      expect(c[2]).toBe(c[1]);
    });

    test("a duplicated object after an X509Certificate keeps its identity", async () => {
      const cert = new X509Certificate(tls.cert);
      const o = { x: 1 };
      const c = await structuredCloneFn([cert, o, o]);
      expect(c[0]).toBeInstanceOf(X509Certificate);
      expect(c[0].subject).toBe(cert.subject);
      expect(c[1]).toEqual({ x: 1 });
      expect(c[2]).toBe(c[1]);
    });
  });
}

describe("reference pool survives a process boundary", () => {
  // One cold subprocess hop covering the whole identity matrix, so every platform object
  // type (X509Certificate, KeyObjects, Blob, File, ...) is deserialized in a fresh VM.
  test("duplicated references preserve identity for every type", () => {
    const values = identityCases.map(([, make]) => make());
    const cloned = jscSerializeRoundtripCrossProcessCold(values.map(value => [value, value]));
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

// https://github.com/oven-sh/bun/issues/32981
// %Object.prototype% is an immutable prototype exotic object that the structured
// serialization spec carves out of the exotic-object rejection, so it clones to
// an empty plain object instead of throwing a DataCloneError.
describe("structuredClone(Object.prototype)", () => {
  test("clones to an empty plain object", () => {
    const cloned = structuredClone(Object.prototype);
    expect(cloned).toEqual({});
    expect(Object.keys(cloned)).toEqual([]);
    expect(cloned).not.toBe(Object.prototype);
    expect(Object.getPrototypeOf(cloned)).toBe(Object.prototype);
  });

  test("clones when nested inside another object", () => {
    const cloned = structuredClone({ a: Object.prototype, b: 1 });
    expect(cloned).toEqual({ a: {}, b: 1 });
    expect(cloned.a).not.toBe(Object.prototype);
  });

  test("bun:jsc serialize/deserialize round-trips it too", () => {
    const cloned = deserialize(serialize(Object.prototype));
    expect(cloned).toEqual({});
  });
});

describe("Error serialization semantics", () => {
  // .message uses OWN data descriptor (HTML spec / Node); .stack uses [[Get]].
  test("new Error() with no message clones without an own .message", () => {
    const cloned = structuredClone(new Error());
    expect(Object.hasOwn(cloned, "message")).toBe(false);
  });

  test("accessor .message is not serialized", () => {
    const e = new Error();
    Object.defineProperty(e, "message", { get: () => "from-getter" });
    const cloned = structuredClone(e);
    expect(Object.hasOwn(cloned, "message")).toBe(false);
  });

  test("inherited .message is not serialized", () => {
    class MyErr extends Error {}
    MyErr.prototype.message = "inherited";
    const cloned = structuredClone(new MyErr());
    expect(Object.hasOwn(cloned, "message")).toBe(false);
  });

  // The own data descriptor is ToString'd, not required to already be a string.
  test.each([
    [42, "42"],
    [null, "null"],
    [undefined, "undefined"],
    [{ toString: () => "obj" }, "obj"],
  ])("own data .message %p is coerced to %p", (value, expected) => {
    const e = new Error("original");
    e.message = value as any;
    expect(structuredClone(e).message).toBe(expected);
  });

  // A throwing coercion propagates the original error rather than dropping the
  // field. A Symbol message must not reach ErrorInstance's .line materialization.
  test("Symbol .message throws TypeError instead of crashing", () => {
    const e = new Error("original");
    e.message = Symbol("s") as any;
    expect(() => structuredClone(e)).toThrow(TypeError);
  });

  test("a throwing .message toString propagates the thrown error", () => {
    class MyDomainError extends Error {}
    const e = new Error("original");
    e.message = {
      toString() {
        throw new MyDomainError("nope");
      },
    } as any;
    expect(() => structuredClone(e)).toThrow(MyDomainError);
  });

  test("a throwing prepareStackTrace propagates the thrown error", () => {
    const original = Error.prepareStackTrace;
    Error.prepareStackTrace = () => {
      throw new Error("boom");
    };
    try {
      const e = new Error("payload");
      expect(() => structuredClone(e)).toThrow("boom");
    } finally {
      Error.prepareStackTrace = original;
    }
  });

  // An own accessor replaces the materialized .stack, so this exercises the
  // [[Get]] on .stack rather than prepareStackTrace. Node propagates it too.
  test("a throwing .stack getter propagates, like node", () => {
    class StackBoom extends Error {}
    const e = new Error("payload");
    Object.defineProperty(e, "stack", {
      get() {
        throw new StackBoom("boom");
      },
      configurable: true,
    });
    expect(() => structuredClone(e)).toThrow(StackBoom);
  });

  test("a custom Error.prepareStackTrace is serialized", () => {
    const original = Error.prepareStackTrace;
    Error.prepareStackTrace = () => "custom";
    try {
      expect(structuredClone(new Error("payload")).stack).toBe("custom");
    } finally {
      Error.prepareStackTrace = original;
    }
  });
});

describe("options.transfer iterator error propagation", () => {
  test("user-thrown error from Symbol.iterator propagates unchanged", () => {
    class MyDomainError extends Error {}
    const transfer = {
      [Symbol.iterator]() {
        throw new MyDomainError("bad state");
      },
    };
    let caught: unknown;
    try {
      structuredClone(1, { transfer } as any);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(MyDomainError);
    expect((caught as any).code).toBeUndefined();
  });

  test("non-object transfer still throws ERR_INVALID_ARG_TYPE", () => {
    expect(() => structuredClone(1, { transfer: 42 } as any)).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
    );
  });
});

describe("truncated Set/Map payloads are rejected without hanging", () => {
  // Wire header + tag bytes derived from a real serialize() so a CurrentVersion
  // bump doesn't invalidate the crafted payloads.
  const setBytes = Array.from(new Uint8Array(serialize(new Set([1, 0]))));
  const mapBytes = Array.from(new Uint8Array(serialize(new Map([[1, 1]]))));
  // valid payloads end in NonSetPropertiesTag/NonMapPropertiesTag + 4x 0xFF
  const setBody = setBytes.slice(0, -5);
  const mapBody = mapBytes.slice(0, -5);

  const cases: [string, number[]][] = [
    ["Set truncated after one element", setBody.slice(0, -1)],
    ["Set truncated after two elements", setBody],
    ["Set truncated before any element", setBody.slice(0, -2)],
    ["Map truncated after key/value pair", mapBody],
    ["Map truncated after key only", mapBody.slice(0, -1)],
    ["Map truncated before any entry", mapBody.slice(0, -2)],
  ];

  test.concurrent.each([
    ["bun:jsc", `import {deserialize} from "bun:jsc"`],
    ["node:v8", `import {deserialize} from "node:v8"`],
  ])("%s deserialize rejects every truncation point", async (_api, importLine) => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `${importLine};
         for (const [name, bytes] of ${JSON.stringify(cases)}) {
           try {
             deserialize(new Uint8Array(bytes));
             console.log(name + ": RETURNED");
           } catch (e) {
             console.log(name + ": " + e.message);
           }
         }`,
      ],
      env: bunEnv,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: 4_000,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ stdout: stdout.trim().split("\n"), stderr, signalCode: proc.signalCode, exitCode }).toEqual({
      stdout: cases.map(([name]) => name + ": Unable to deserialize data."),
      stderr: expect.any(String),
      signalCode: null,
      exitCode: 0,
    });
  });

  test("valid Set and Map payloads still round-trip", () => {
    expect(deserialize(serialize(new Set([1, 0])))).toEqual(new Set([1, 0]));
    expect(deserialize(serialize(new Map([[1, 1]])))).toEqual(new Map([[1, 1]]));
  });
});

// The wire reader must enforce the same validation as the public constructor for
// Bun's host tags; otherwise crafted bytes can manufacture objects in states no
// JS constructor can reach. The X509Certificate tag with a zero-length DER used
// to produce a JSX509Certificate with m_x509 == nullptr; .publicKey on that
// instance wraps a null EVP_PKEY in a KeyObject, and key.equals(key) SEGFAULTs.
describe("deserializing crafted host-tag records", () => {
  // JSC wire header (version 14) + X509Certificate host tag (253) + u32 length.
  const x509Record = (der: number[]) => Buffer.from([14, 0, 0, 0, 253, ...intLE(der.length), ...der]);
  function intLE(n: number) {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n);
    return [...b];
  }

  test("an X509Certificate record with empty DER is rejected and cannot yield a null-key KeyObject", async () => {
    // Runs in a subprocess because the pre-fix build SEGFAULTs on key.equals(key),
    // which would take the test runner down with it.
    const childScript = `
      const { deserialize } = require("bun:jsc");
      const v8 = require("node:v8");
      const payload = Buffer.from(process.argv[1], "base64");
      const out = [];
      for (const [entry, de] of [["bun:jsc", deserialize], ["node:v8", b => v8.deserialize(Buffer.from(b))]]) {
        try {
          const cert = de(payload);
          // Pre-fix: cert is an X509Certificate with m_x509 == null. .publicKey hands out a
          // KeyObject over a null EVP_PKEY; key.equals(key) dereferences it and SEGFAULTs.
          const key = cert.publicKey;
          out.push({ entry, threw: false, keyType: key?.type, equals: key.equals(key) });
        } catch (e) {
          out.push({ entry, threw: true, name: e?.name, message: e?.message });
        }
      }
      process.stdout.write(JSON.stringify(out));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", childScript, x509Record([]).toString("base64")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const rejection = { threw: true, name: "TypeError", message: "Unable to deserialize data." };
    expect({ stdout: stdout ? JSON.parse(stdout) : stderr, exitCode, signalCode: proc.signalCode }).toEqual({
      stdout: [
        { entry: "bun:jsc", ...rejection },
        { entry: "node:v8", ...rejection },
      ],
      exitCode: 0,
      signalCode: null,
    });
  });

  test.each([
    ["bun:jsc deserialize", deserialize],
    ["v8.deserialize", v8.deserialize],
  ])("%s: an X509Certificate record with undecodable DER is rejected", (_, fn) => {
    expect(() => fn(x509Record([0xde, 0xad, 0xbe, 0xef]))).toThrow("Unable to deserialize data.");
  });

  test("a real X509Certificate still round-trips and its .publicKey is usable", () => {
    const original = new X509Certificate(tls.cert);
    const cloned = v8.deserialize(v8.serialize(original));
    expect(cloned).toBeInstanceOf(X509Certificate);
    expect(cloned.fingerprint256).toBe(original.fingerprint256);
    const key = cloned.publicKey;
    expect(key).toBeInstanceOf(KeyObject);
    expect(key.type).toBe("public");
    expect(key.equals(original.publicKey)).toBe(true);
  });
});
