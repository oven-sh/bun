import { deserialize, serialize } from "bun:jsc";
import { openSync } from "fs";
import { bunEnv, bunExe, tls } from "harness";
import { createPrivateKey, createPublicKey, createSecretKey, KeyObject, X509Certificate } from "node:crypto";
import { BlockList } from "node:net";
import { deflate } from "node:zlib";
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

// The child scripts reply through Bun.write(Bun.stdout): the first touch of process.stdout
// loads node:stream, which costs most of a second per child in a debug build.

// Cold variant: a brand-new Bun process per clone, so the deserialize happens in a
// completely fresh JSC VM (empty object pool, first-touch platform-object structures).
function jscSerializeRoundtripCrossProcessCold(original: any) {
  const result = Bun.spawnSync({
    cmd: [
      bunExe(),
      "-e",
      `
    import { deserialize, serialize } from "bun:jsc";
    await Bun.write(Bun.stdout, serialize(deserialize(await Bun.stdin.bytes())));
    `,
    ],
    env: bunEnv,
    stdin: serialize(original),
    stdout: "pipe",
    stderr: "pipe",
  });
  if (!result.success) {
    throw new Error(
      `cold cross-process child failed (code ${result.exitCode}, signal ${result.signalCode})\n${result.stderr}`,
    );
  }
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
      // serialize() returns a SharedArrayBuffer; Buffer.concat needs a view of it.
      const cloned = new Uint8Array(serialize(deserialize(buf.subarray(4, 4 + len))));
      const header = Buffer.alloc(4);
      header.writeUInt32LE(cloned.byteLength, 0);
      await Bun.write(Bun.stdout, Buffer.concat([header, cloned]));
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
      // toStrictEqual compares with Object.is (-0 vs 0, NaN) and keeps holes distinct from undefined.
      expect(cloned).toStrictEqual(input);
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
      // toStrictEqual requires the `undefined` key to exist on the clone, not only to read as undefined.
      expect(cloned).toStrictEqual(input);
    });

    test("map", async () => {
      const input = new Map([
        ["a", 1],
        ["b", 2],
        ["c", 3],
      ]);
      const cloned = await structuredCloneFn(input);
      expect(cloned).toBeInstanceOf(Map);
      expect(cloned).not.toBe(input);
      expect(cloned).toEqual(input);
    });

    test("set", async () => {
      const input = new Set(["a", "b", "c"]);
      const cloned = await structuredCloneFn(input);
      expect(cloned).toBeInstanceOf(Set);
      expect(cloned).not.toBe(input);
      expect(cloned).toEqual(input);
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
      describe("dom file", () => {
        async function describeFile(file: File) {
          return {
            name: file.name,
            type: file.type,
            size: file.size,
            lastModified: file.lastModified,
            text: await file.text(),
          };
        }
        test("without lastModified", async () => {
          const file = new File(["hi"], "example.txt", { type: "text/plain" });
          expect(file.lastModified).toBeGreaterThan(0);
          const cloned = await structuredCloneFn(file);
          expect(cloned).toBeInstanceOf(File);
          expect(cloned).not.toBe(file);
          expect(await describeFile(cloned)).toEqual({
            name: "example.txt",
            type: file.type,
            size: 2,
            lastModified: file.lastModified,
            text: "hi",
          });
        });
        test("with lastModified", async () => {
          const file = new File(["hi"], "example.txt", { type: "text/plain", lastModified: 123 });
          const cloned = await structuredCloneFn(file);
          expect(cloned).toBeInstanceOf(File);
          expect(cloned).not.toBe(file);
          expect(await describeFile(cloned)).toEqual({
            name: "example.txt",
            type: file.type,
            size: 2,
            lastModified: 123,
            text: "hi",
          });
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
          const blocklist = new BlockList();
          blocklist.addAddress("123.123.123.123");
          const newlist = structuredCloneFn(blocklist);
          expect(newlist).toBeInstanceOf(BlockList);
          expect(newlist).not.toBe(blocklist);
          expect(newlist.check("123.123.123.123")).toBeTrue();
          expect(newlist.check("123.123.123.124")).toBeFalse();
          // Like node, the clone wraps the same native list as the original.
          newlist.addAddress("123.123.123.124");
          expect(blocklist.check("123.123.123.124")).toBeTrue();
          expect(newlist.check("123.123.123.124")).toBeTrue();
        });
      });

      describe("transferables", () => {
        test("ArrayBuffer", () => {
          const buffer = Uint8Array.from([1]).buffer;
          const cloned = structuredCloneFn(buffer, { transfer: [buffer] });
          expect(cloned).toBeInstanceOf(ArrayBuffer);
          expect(cloned).not.toBe(buffer);
          expect({
            detached: buffer.detached,
            byteLength: buffer.byteLength,
            clonedBytes: new Uint8Array(cloned),
          }).toEqual({ detached: true, byteLength: 0, clonedBytes: new Uint8Array([1]) });
        });
        test("A detached ArrayBuffer cannot be transferred", () => {
          const buffer = new ArrayBuffer(2);
          structuredCloneFn(buffer, { transfer: [buffer] });
          expect(() => {
            structuredCloneFn(buffer, { transfer: [buffer] });
          }).toThrow(DOMException);
        });
        // Bun's native borrows call ArrayBuffer::pin(), which makes the buffer
        // non-detachable without setting the C-API lock flag. Transferring a
        // pinned buffer must copy via transferTo()'s copyTo() fallback, not
        // throw (see bindings.cpp JSC__JSValue__pinArrayBuffer). Locks this in
        // so a future WebKit sync that re-adds upstream's !isDetachable() gate
        // in SerializedScriptValue::create fails CI.
        test("A Bun-pinned ArrayBuffer copies on transfer instead of detaching", async () => {
          const ab = new ArrayBuffer(64);
          new Uint8Array(ab).fill(42);
          const { promise, resolve, reject } = Promise.withResolvers<void>();
          // Starting the async deflate pins ab for the duration of the call.
          deflate(new Uint8Array(ab), e => (e ? reject(e) : resolve()));
          try {
            const clone = structuredCloneFn(ab, { transfer: [ab] });
            expect({
              cloneLength: clone.byteLength,
              origLength: ab.byteLength,
              sameObject: clone === ab,
              cloneFirst: new Uint8Array(clone)[0],
            }).toEqual({ cloneLength: 64, origLength: 64, sameObject: false, cloneFirst: 42 });
          } finally {
            await promise;
          }
          expect(ab.byteLength).toBe(64);
        });
        // WebAssembly.Memory buffers carry a non-undefined [[ArrayBufferDetachKey]]
        // and must be rejected from a transfer list (per HTML's
        // StructuredSerializeWithTransfer), unlike a Bun-pinned buffer above.
        test("A WebAssembly.Memory buffer is rejected from the transfer list", () => {
          const mem = new WebAssembly.Memory({ initial: 1 });
          const buf = mem.buffer;
          expect(() => structuredCloneFn(buf, { transfer: [buf] })).toThrow(TypeError);
          expect(buf.byteLength).toBe(65536);
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
          let error: unknown;
          try {
            structuredCloneFn(blob, { transfer: [blob] });
          } catch (e) {
            error = e;
          }
          expect(error).toBeInstanceOf(DOMException);
          expect((error as DOMException).name).toBe("DataCloneError");
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
  // A plain Blob must come back as a plain Blob, not as a File.
  expect(Object.getPrototypeOf(cloned)).toBe(Blob.prototype);
  expect(cloned).not.toBe(original);
  expect({ size: cloned.size, type: cloned.type, bytes: await cloned.bytes() }).toEqual({
    size: original.size,
    type: original.type,
    bytes: await original.bytes(),
  });
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
  async function runInChild(script: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { lines: stdout.split("\n").filter(Boolean), stderr, signalCode: proc.signalCode, exitCode };
  }

  // The serialization buffer is a WTF::Vector<uint8_t> capped at 2GiB. Cloning an
  // ArrayBuffer at or above that size must throw DataCloneError instead of aborting.
  // SharedArrayBuffer shares its backing store (no serialization copy), so it
  // succeeds regardless of size. Nothing here copies 2GiB, so one child runs all cases,
  // collecting between them so only one buffer is mapped at a time.
  test("at or above 2GiB: copies throw DataCloneError, SharedArrayBuffers are shared", async () => {
    const cases = [
      ["ArrayBuffer", "new ArrayBuffer(2 ** 31)", "DOMException DataCloneError"],
      [
        "resizable ArrayBuffer",
        "new ArrayBuffer(2 ** 31, { maxByteLength: 2 ** 31 + 1 })",
        "DOMException DataCloneError",
      ],
      ["SharedArrayBuffer", "new SharedArrayBuffer(2 ** 31)", "SHARED"],
      ["growable SharedArrayBuffer", "new SharedArrayBuffer(2 ** 31, { maxByteLength: 2 ** 31 + 1 })", "SHARED"],
      ["Uint8Array", "new Uint8Array(2 ** 31)", "DOMException DataCloneError"],
    ] as const;
    const caseList = cases.map(([label, expr]) => `["${label}", () => ${expr}]`).join(", ");
    const result = await runInChild(`
      function run(make) {
        const buf = make();
        let cloned;
        try {
          cloned = structuredClone(buf);
        } catch (e) {
          return e.constructor.name + " " + e.name;
        }
        if (!(cloned instanceof SharedArrayBuffer)) return "UNEXPECTED_SUCCESS " + cloned.constructor.name;
        // A shared clone sees a write made through the original after cloning.
        new Uint8Array(buf)[0] = 42;
        return cloned.byteLength === buf.byteLength && new Uint8Array(cloned)[0] === 42 ? "SHARED" : "NOT_SHARED";
      }
      for (const [label, make] of [${caseList}]) {
        console.log(label + ": " + run(make));
        Bun.gc(true);
      }
    `);
    expect(result).toEqual({
      lines: cases.map(([label, , expected]) => `${label}: ${expected}`),
      stderr: "",
      signalCode: null,
      exitCode: 0,
    });
  });

  // A large-but-under-2GiB ArrayBuffer nested inside an object fills the serialization buffer
  // to its reserved capacity; the subsequent terminator write then triggers vector growth. The
  // default 1.5x growth exceeds the 2GiB cap and would crash. These cases must succeed and
  // round-trip correctly since the total serialized size still fits under 2GiB.
  //
  // One case per distinct serializer path: a plain ArrayBuffer, an ArrayBufferView (its own
  // header and deserializer), and a resizable ArrayBuffer (its own tag and reservation). An
  // array or a nested object around the buffer reaches the same endObject() terminator write
  // after the same reservation, so those containers add nothing here. Each case gets its own
  // child: a clone is about 3 GB of fresh pages (source, serialization buffer, clone) and the
  // kernel work to fault them in is most of the time.
  const size = 1_500_000_000; // smallest (plus margin) whose 1.5x growth exceeds 2GiB: 2**31 / 1.5 = ~1.43e9
  for (const { label, value, type, resizable } of [
    { label: "ArrayBuffer", value: "new ArrayBuffer(size)", type: "ArrayBuffer", resizable: false },
    { label: "Uint8Array", value: "new Uint8Array(size)", type: "Uint8Array", resizable: null },
    {
      label: "resizable ArrayBuffer",
      value: "new ArrayBuffer(size, { maxByteLength: size })",
      type: "ArrayBuffer",
      resizable: true,
    },
  ]) {
    test(`${label} in an object under 2GiB clones without crashing and round-trips`, async () => {
      const result = await runInChild(`
        const size = ${size};
        const v = { h: ${value} };
        // Mark both ends of the source so the check proves the bytes were copied, not only the
        // length. Two pages are touched; the rest of the source stays unmapped.
        const sourceBytes = v.h instanceof ArrayBuffer ? new Uint8Array(v.h) : v.h;
        sourceBytes[0] = 1;
        sourceBytes[size - 1] = 2;
        const out = structuredClone(v).h;
        const bytes = out instanceof ArrayBuffer ? new Uint8Array(out) : out;
        console.log(JSON.stringify({
          type: out.constructor.name,
          byteLength: bytes.byteLength,
          first: bytes[0],
          last: bytes[size - 1],
          resizable: out.resizable ?? null,
          maxByteLength: out.maxByteLength ?? null,
        }));
      `);
      // The host's OOM killer reclaiming the child on a small CI runner is not a
      // structuredClone failure; any other signal (SIGSEGV/SIGABRT/...) still is.
      if (result.signalCode === "SIGKILL" && result.lines.length === 0) return;
      expect({ ...result, lines: result.lines.map(line => JSON.parse(line)) }).toEqual({
        lines: [
          {
            type,
            byteLength: size,
            first: 1,
            last: 2,
            // A view reports neither; a fixed-length ArrayBuffer reports maxByteLength === byteLength.
            resizable,
            maxByteLength: type === "ArrayBuffer" ? size : null,
          },
        ],
        stderr: "",
        signalCode: null,
        exitCode: 0,
      });
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
      expect(c).toEqual(input);
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

// The transfer list is read through the iterator protocol. A Set iterator hands back plain
// {value, done} objects; a custom next() can return anything, including accessors, and those
// must still run in IteratorComplete, IteratorValue order.
describe("options.transfer iterator results", () => {
  test("a Set of buffers is transferred", () => {
    const a = new ArrayBuffer(4);
    const b = new ArrayBuffer(8);
    const cloned = structuredClone([a, b], { transfer: new Set([a, b]) } as any);
    expect({
      clonedLengths: cloned.map((x: ArrayBuffer) => x.byteLength),
      originalLengths: [a.byteLength, b.byteLength],
    }).toEqual({ clonedLengths: [4, 8], originalLengths: [0, 0] });
  });

  test("done and value accessors on a custom iterator result are honored", () => {
    const buffers = [new ArrayBuffer(4), new ArrayBuffer(8)];
    const reads: string[] = [];
    let i = 0;
    const transfer = {
      [Symbol.iterator]() {
        return {
          next() {
            const n = i++;
            return {
              get done() {
                reads.push(`done${n}`);
                return n >= buffers.length;
              },
              get value() {
                reads.push(`value${n}`);
                // IteratorStepValue: the value of a done result is never read.
                if (n >= buffers.length) throw new Error("value read on a done result");
                return buffers[n];
              },
            };
          },
        };
      },
    };
    const cloned = structuredClone(buffers, { transfer } as any);
    expect({
      clonedLengths: cloned.map((x: ArrayBuffer) => x.byteLength),
      originalLengths: buffers.map(x => x.byteLength),
      reads,
    }).toEqual({
      clonedLengths: [4, 8],
      originalLengths: [0, 0],
      reads: ["done0", "value0", "done1", "value1", "done2"],
    });
  });

  test("a {value, done} result given a done accessor afterwards uses the accessor", () => {
    const buffer = new ArrayBuffer(4);
    let i = 0;
    const transfer = {
      [Symbol.iterator]() {
        return {
          next() {
            const n = i++;
            const result = { value: buffer, done: false };
            Object.defineProperty(result, "done", { get: () => n >= 1 });
            return result;
          },
        };
      },
    };
    const cloned = structuredClone(buffer, { transfer } as any);
    expect([cloned.byteLength, buffer.byteLength]).toEqual([4, 0]);
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

describe("string constant pool entries survive GC during deserialization", () => {
  // A string that appears twice in one payload is materialized once and referenced by index the
  // second time. If the only object holding the first JSString drops it (here: a Map key that the
  // payload sets twice) and the heap is collected before the back-reference is read, the
  // deserializer must still hand back the original string.
  test("Map value re-set during serialization", () => {
    for (let iteration = 0; iteration < 1; iteration++) {
      const expected = "Expected result " + iteration;
      const map = new Map();
      map.set("free", expected);
      map.set("tmp", {
        get a() {
          map.delete("free");
          map.set("free", 0x1234);
          for (let i = 0; i < 0x10; i++) map.set("gc1_" + i, new ArrayBuffer(1024 * 1024 * 0x10));
          for (let i = 0; i < 0x800; i++) map.set("gc2_" + i, new Date());
          map.set("expected", expected);
          return 1;
        },
      });
      const result = structuredClone(map);
      expect(result.get("expected")).toBe(expected);
      expect(result.get("free")).toBe(0x1234);
      expect(result.get("tmp")).toEqual({ a: 1 });
    }
  });
});
