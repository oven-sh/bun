import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, gcTick, isASAN, tempDir } from "harness";
import type { BlobPropertyBag } from "node:buffer";
import type { BinaryLike } from "node:crypto";
import path from "node:path";
import { blob as consumeBlob } from "node:stream/consumers";
import vm from "node:vm";

test("blob: imports have sourcemapped stacktraces", async () => {
  const blob = new Blob(
    [
      `
    export function uhOh(very: any): boolean {
      return Bun.inspect(new Error());  
    }
  `,
    ],
    { type: "application/typescript" },
  );

  const url = URL.createObjectURL(blob);
  expect(url).toStartWith("blob:");
  const { uhOh } = await import(url);
  expect(uhOh()).toContain(`uhOh(very: any): boolean`);
  URL.revokeObjectURL(url);
});

for (const info of [
  {
    blob: new Blob(["Bun", "Foo"]),
    name: "Blob.slice",
    is_file: false,
  },
  {
    blob: Bun.file(path.join(import.meta.dir, "fixtures", "slice.txt")),
    name: "Bun.file().slice",
    is_file: true,
  },
]) {
  test(info.name, async () => {
    const blob = info.blob;
    const b1 = blob.slice(0, 3, "Text/HTML");
    expect(b1 instanceof Blob).toBeTruthy();
    expect(b1.size).toBe(3);
    expect(b1.type).toBe("text/html");
    const b2 = blob.slice(-1, 3);
    expect(b2.size).toBe(0);
    const b3 = blob.slice(100, 3);
    expect(b3.size).toBe(0);
    // file will lazy read until EOF if the size is wrong
    if (!info.is_file) {
      const b4 = blob.slice(0, 10);
      expect(b4.size).toBe(blob.size);
    }
    expect(blob.slice().size).toBe(blob.size);
    expect(blob.slice(0).size).toBe(blob.size);
    expect(blob.slice(NaN).size).toBe(blob.size);
    expect(blob.slice(0, Infinity).size).toBe(blob.size);
    expect(blob.slice(-Infinity).size).toBe(blob.size);
    expect(blob.slice(0, NaN).size).toBe(0);
    // @ts-expect-error
    expect(blob.slice(Symbol(), "-123").size).toBe(6);
    // @ts-expect-error
    expect(blob.slice(Object.create(null), "-123").size).toBe(6);
    // @ts-expect-error
    expect(blob.slice(null, "-123").size).toBe(6);
    expect(blob.slice(0, 10).size).toBe(blob.size);
    expect((blob as Bun.BunFile).slice("text/plain;charset=utf-8").type).toBe("text/plain;charset=utf-8");

    // test Blob.slice().slice(), issue#6252
    expect(await blob.slice(0, 4).slice(0, 3).text()).toBe("Bun");
    expect(await blob.slice(0, 4).slice(1, 3).text()).toBe("un");
    expect(await blob.slice(1, 4).slice(0, 3).text()).toBe("unF");
    expect(await blob.slice(1, 4).slice(1, 3).text()).toBe("nF");
    expect(await blob.slice(1, 4).slice(2, 3).text()).toBe("F");
    expect(await blob.slice(1, 4).slice(3, 3).text()).toBe("");
    expect(await blob.slice(1, 4).slice(4, 3).text()).toBe("");
    // test negative start
    expect(await blob.slice(1, 4).slice(-1, 3).text()).toBe("F");
    expect(await blob.slice(1, 4).slice(-2, 3).text()).toBe("nF");
    expect(await blob.slice(1, 4).slice(-3, 3).text()).toBe("unF");
    expect(await blob.slice(1, 4).slice(-4, 3).text()).toBe("unF");
    expect(await blob.slice(1, 4).slice(-5, 3).text()).toBe("unF");
    expect(await blob.slice(-1, 4).slice(-1, 3).text()).toBe("");
    expect(await blob.slice(-2, 4).slice(-1, 3).text()).toBe("");
    expect(await blob.slice(-3, 4).slice(-1, 3).text()).toBe("F");
    expect(await blob.slice(-4, 4).slice(-1, 3).text()).toBe("F");
    expect(await blob.slice(-5, 4).slice(-1, 3).text()).toBe("F");
    expect(await blob.slice(-5, 4).slice(-2, 3).text()).toBe("nF");
    expect(await blob.slice(-5, 4).slice(-3, 3).text()).toBe("unF");
    expect(await blob.slice(-5, 4).slice(-4, 3).text()).toBe("unF");
    expect(await blob.slice(-4, 4).slice(-3, 3).text()).toBe("nF");
    expect(await blob.slice(-5, 4).slice(-4, 3).text()).toBe("unF");
    expect(await blob.slice(-3, 4).slice(-2, 3).text()).toBe("F");
    expect(await blob.slice(-blob.size, 4).slice(-blob.size, 3).text()).toBe("Bun");
  });
}

test("new Blob", () => {
  var blob = new Blob(["Bun", "Foo"], { type: "text/foo" });
  expect(blob.size).toBe(6);
  expect(blob.type).toBe("text/foo");

  blob = new Blob(["Bun", "Foo"], { type: "\u1234" });
  expect(blob.size).toBe(6);
  expect(blob.type).toBe("");
});

test("new Blob stringifies non-Blob object parts in order", async () => {
  const url = new URL("https://example.com/path");
  // @ts-expect-error
  expect(await new Blob([url]).text()).toBe("https://example.com/path");
  // @ts-expect-error
  expect(await new Blob(["a", url, "b"]).text()).toBe("ahttps://example.com/pathb");
  // @ts-expect-error
  expect(await new Blob(["a", {}, "b"]).text()).toBe("a[object Object]b");
  // @ts-expect-error
  expect(await new Blob(["a", {}, "b", { toString: () => "X" }]).text()).toBe("a[object Object]bX");
  // @ts-expect-error
  expect(await new Blob(["a", ["x", "y"], "b"]).text()).toBe("ax,yb");
});

test("blob: can be fetched", async () => {
  const blob = new Blob(["Bun", "Foo"]);
  const url = URL.createObjectURL(blob);
  expect(url).toStartWith("blob:");
  expect(await fetch(url).then(r => r.text())).toBe("BunFoo");
  URL.revokeObjectURL(url);
  expect(async () => {
    await fetch(url);
  }).toThrow();
});

test("blob: URL has Content-Type", async () => {
  const blob = new File(["Bun", "Foo"], "file.txt", { type: "text/javascript;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  expect(url).toStartWith("blob:");
  const resp = await fetch(url);
  expect(resp.headers.get("Content-Type")).toBe("text/javascript;charset=utf-8");
  URL.revokeObjectURL(url);
  expect(async () => {
    await fetch(url);
  }).toThrow();
});

test("blob: can be imported", async () => {
  const blob = new Blob(
    [
      `
    export function supportsTypescript(): boolean {
      return true;
    }
  `,
    ],
    { type: "application/typescript" },
  );

  const url = URL.createObjectURL(blob);
  expect(url).toStartWith("blob:");
  const { supportsTypescript } = await import(url);
  expect(supportsTypescript()).toBe(true);
  URL.revokeObjectURL(url);
  expect(async () => {
    await import(url);
  }).toThrow();
});

test("blob: can reliable get type from fetch #10072", async () => {
  using server = Bun.serve({
    fetch() {
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(Buffer.from("Hello"));
          },
          async pull(controller) {
            await Bun.sleep(100);
            controller.enqueue(Buffer.from("World"));
            await Bun.sleep(100);
            controller.close();
          },
        }),
        {
          headers: {
            "Content-Type": "plain/text",
          },
        },
      );
    },
  });

  const blob = await fetch(server.url).then(res => res.blob());
  expect(blob.type).toBe("plain/text");
});

// https://github.com/oven-sh/bun/issues/13049
test("new Blob(new Uint8Array()) is supported", async () => {
  const blob = new Blob(Buffer.from("1234") as any);
  expect(await blob.text()).toBe("1234");
});

// https://github.com/oven-sh/bun/issues/13049
test("new File(new Uint8Array()) is supported", async () => {
  const blob = new File(Buffer.from("1234") as any, "file.txt");
  expect(await blob.text()).toBe("1234");
  expect(blob.name).toBe("file.txt");
});

test("new File('123', '123') is NOT supported", async () => {
  // @ts-expect-error
  expect(() => new File("123", "123")).toThrow();
});

describe("new File() lastModified option", () => {
  const lm = (o: any) => new File([], "n", o).lastModified;

  test.each([
    // [input, expected] — present member goes through ToNumber; NaN → 0
    [NaN, 0],
    ["not a number", 0],
    [{}, 0],
    [{ valueOf: () => NaN }, 0],
    [null, 0],
    ["", 0],
    [false, 0],
    [true, 1],
    ["123", 123],
    [1234, 1234],
    [-1, -1],
  ] as const)("lastModified: %p -> %p", (input, expected) => {
    expect(lm({ lastModified: input })).toBe(expected);
  });

  // The default comes from a native wall-clock read that may differ from JS
  // Date.now() by a few ms on Windows; assert "current time" within a wide
  // tolerance rather than an exact bracket.
  test.each([[{ lastModified: undefined }], [{}]])("%p defaults to the current time", opts => {
    const value = lm(opts);
    expect(Number.isFinite(value)).toBe(true);
    expect(Math.abs(value - Date.now())).toBeLessThan(60_000);
  });

  test("valueOf throwing propagates", () => {
    expect(() =>
      lm({
        lastModified: {
          valueOf() {
            throw new Error("boom");
          },
        },
      }),
    ).toThrow("boom");
  });
});

test("new Blob('123') is NOT supported", async () => {
  // @ts-expect-error
  expect(() => new Blob("123")).toThrow();
});

test("blob: can set name property #10178", () => {
  const blob = new Blob([Buffer.from("Hello, World")]);
  // @ts-expect-error
  expect(blob.name).toBeUndefined();
  // @ts-expect-error
  blob.name = "logo.svg";
  // @ts-expect-error
  expect(blob.name).toBe("logo.svg");
  // @ts-expect-error
  blob.name = 10;
  // @ts-expect-error
  expect(blob.name).toBe("logo.svg");
  Object.defineProperty(blob, "name", {
    value: 42,
    writable: false,
  });
  // @ts-expect-error
  expect(blob.name).toBe(42);

  class MyBlob extends Blob {
    constructor(sources: Array<BinaryLike | Blob>, options?: BlobPropertyBag) {
      super(sources, options);
      // @ts-expect-error
      this.name = "logo.svg";
    }
  }

  const myBlob = new MyBlob([Buffer.from("Hello, World")]);
  // @ts-expect-error
  expect(myBlob.name).toBe("logo.svg");
  // @ts-expect-error
  myBlob.name = 10;
  // @ts-expect-error
  expect(myBlob.name).toBe("logo.svg");
  Object.defineProperty(myBlob, "name", {
    value: 42,
    writable: false,
  });
  // @ts-expect-error
  expect(myBlob.name).toBe(42);

  class MyOtherBlob extends Blob {
    name: string | number;
    constructor(sources: Array<BinaryLike | Blob>, options?: BlobPropertyBag) {
      super(sources, options);
      this.name = "logo.svg";
    }
  }
  const myOtherBlob = new MyOtherBlob([Buffer.from("Hello, World")]);
  expect(myOtherBlob.name).toBe("logo.svg");
  myOtherBlob.name = 10;
  expect(myOtherBlob.name).toBe(10);
});

test("#12894", () => {
  const bunFile = Bun.file("foo.txt");
  expect(new File([bunFile], "bar.txt").name).toBe("bar.txt");
});

test("new File([file], name) does not rename the source", () => {
  const a = new File(["x"], "a.txt");
  const b = new File([a], "b.txt");
  expect([a.name, b.name]).toEqual(["a.txt", "b.txt"]);
  const c = new Blob(["y"]);
  const d = new File([c], "d.txt");
  const e = new File([c], "e.txt");
  expect([d.name, e.name]).toEqual(["d.txt", "e.txt"]);
});

test("dupeWithContentType does not alias the source's allocated content_type", async () => {
  // Regression: #23015 refactored Blob to be ref-counted and moved
  // `setNotHeapAllocated()` before the `isHeapAllocated()` guard in
  // `dupeWithContentType`, making the guard always false. The branch that
  // deep-copies a heap-allocated content_type became dead code, so duped
  // blobs aliased the source's allocation while both claimed ownership.
  //
  // Observable: create a Bun.file with a custom (non-registry) type so
  // content_type_allocated=true, wrap it in a Response (which dupes the
  // blob into its body), then call file.write() with a new type which
  // frees the original content_type. Reading the Response's headers then
  // reads freed memory. Under ASAN this is a use-after-poison crash.
  using dir = tempDir("blob-dupe-content-type", {
    "run.ts": `
      import { join } from "path";
      const p = join(process.argv[2], "out.txt");
      // Must NOT be a known mime type so the string is heap-allocated.
      const originalType = "application/x-custom-type-not-in-registry-abcdefghijklm";
      const file = Bun.file(p, { type: originalType });
      if (file.type !== originalType) throw new Error("precondition: unexpected type " + file.type);

      // Response body holds a dupe of the file blob.
      const response = new Response(file);

      // Frees file.content_type and reallocates something else of the same
      // length into (hopefully) the same slot on non-ASAN builds.
      const overwriteType = "application/x-overwritten-type-zzzzzzzzzzzzzzzzzzzzzzzz";
      if (overwriteType.length !== originalType.length) throw new Error("precondition: lengths must match");
      await file.write("hello", { type: overwriteType });

      // Lazily initializes headers from the body blob's content_type.
      // Without the fix this reads freed memory.
      const ct = response.headers.get("content-type");
      process.stdout.write(ct ?? "<null>");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run.ts", String(dir)],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toBe("application/x-custom-type-not-in-registry-abcdefghijklm");
  expect(exitCode).toBe(0);
});

test("dupe() preserves allocated content_type for Body clone", () => {
  // Body.Value.clone() goes through Blob.dupe() -> dupeWithContentType(false).
  // That path must deep-copy a heap-allocated content_type rather than drop
  // it, otherwise Response.clone() loses FormData's multipart boundary (and
  // any other non-registry type) when headers haven't been materialized yet.
  const fd = new FormData();
  fd.append("a", "b");
  const original = new Response(fd);
  // Clone before touching .headers so the clone has to derive Content-Type
  // from its own body Blob rather than copied-over FetchHeaders.
  const cloned = original.clone();
  const originalType = original.headers.get("content-type");
  const clonedType = cloned.headers.get("content-type");
  expect(originalType).toStartWith("multipart/form-data; boundary=");
  expect(clonedType).toBe(originalType);
});

test("Bun.file(path, {type}).text() does not leak the duped content_type", async () => {
  using dir = tempDir("blob-text-content-type", {
    "data.txt": "hello",
  });
  const script = `
    const rss = process.memoryUsage.rss;
    const p = ${JSON.stringify(path.join(String(dir), "data.txt"))};
    const type = "application/x-" + Buffer.alloc(64 * 1024, "a").toString();
    const file = Bun.file(p, { type });
    for (let i = 0; i < 100; i++) await file.text();
    Bun.gc(true);
    const before = rss();
    for (let i = 0; i < 1024; i++) await file.text();
    Bun.gc(true);
    const after = rss();
    console.log(JSON.stringify({ deltaMiB: (after - before) / 1024 / 1024 }));
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const { deltaMiB } = JSON.parse(stdout);
  expect(deltaMiB).toBeLessThan(isASAN ? 400 : 40);
  expect(exitCode).toBe(0);
});

test("reading a file-backed Blob does not free the source's content type", async () => {
  using dir = tempDir("blob-text-keeps-type", {
    "data.txt": "hello",
  });
  const customType = "application/x-custom-type-not-in-registry-keepme";
  const file = Bun.file(path.join(String(dir), "data.txt"), { type: customType });
  expect(await file.text()).toBe("hello");
  expect(await file.text()).toBe("hello");
  expect(file.type).toBe(customType);
});

test("Bun.write preserves a custom content type on the destination", async () => {
  using dir = tempDir("blob-write-keeps-type", {});
  const customType = "application/x-custom-type-not-in-registry-write";
  const dest = Bun.file(path.join(String(dir), "out.txt"), { type: customType });
  await Bun.write(dest, "data");
  expect(await dest.text()).toBe("data");
  expect(dest.type).toBe(customType);
});

test("Blob part's bytes survive a later part freeing it during construction", async () => {
  // Regression: the Blob constructor pushed Blob parts into the string joiner
  // as *borrowed* views into their Store's bytes. A later part whose
  // processing runs user JS (an object part's toString) could drop the last
  // reference to that Blob and GC it, freeing the Store before the joiner
  // copied the view out — a use-after-free. Blob parts must be copied at push
  // time. Under ASAN the unfixed read is a use-after-poison crash.
  using dir = tempDir("blob-part-uaf", {
    "run.ts": `
      const SIZE = 1 << 18;
      const expected = Buffer.alloc(SIZE, "A").toString() + "x";
      for (let i = 0; i < 16; i++) {
        const parts: any[] = [
          new Blob([Buffer.alloc(SIZE, "A")]),
          {
            toString() {
              // Drop the only reference to the Blob part, collect it, then
              // reallocate same-sized buffers so the freed Store bytes get
              // clobbered if the joiner still holds a borrowed view into them.
              parts.length = 0;
              Bun.gc(true);
              const clobber = [];
              for (let j = 0; j < 8; j++) clobber.push(Buffer.alloc(SIZE, "B"));
              return "x";
            },
          },
        ];
        const text = await new Blob(parts).text();
        if (text !== expected) {
          throw new Error("Blob part bytes were corrupted at iteration " + i);
        }
      }
      process.stdout.write("OK");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toBe("OK");
  expect(exitCode).toBe(0);
});

test("Blob constructor copies typed array parts before later parts run user code", async () => {
  // Constructing a Blob from [typedArray, objectWithToString] must snapshot the
  // typed array's bytes when that part is visited. Stringifying a later part
  // runs arbitrary user JS (toString / Symbol.toPrimitive / proxy traps) which
  // can transfer or resize the earlier part's backing store before the Blob's
  // contents are assembled. The resulting Blob must contain the bytes the view
  // held at construction time, not whatever ends up at that address afterwards.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const ab = new ArrayBuffer(64, { maxByteLength: 1024 });
        const view = new Uint8Array(ab);
        view.fill(0x41); // "A"
        const blob = new Blob([
          view,
          {
            toString() {
              // Detach the first part's buffer and overwrite the moved
              // backing store while the Blob is still being assembled.
              const moved = ab.transfer();
              new Uint8Array(moved).fill(0x42); // "B"
              return "tail";
            },
          },
        ]);
        const text = await blob.text();
        const expected = Buffer.alloc(64, 0x41).toString() + "tail";
        if (text !== expected) {
          throw new Error("unexpected blob contents: " + JSON.stringify(text));
        }
        console.log("OK", blob.size);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("OK 68");
  expect(exitCode).toBe(0);
});

test("Blob.slice at an odd byte offset decodes UTF-16LE (BOM) content with text() and json()", async () => {
  // A blob sliced at an odd start keeps a view into the original store at an odd
  // byte offset. When the bytes at that offset begin with a UTF-16LE BOM (FF FE),
  // text()/json() must decode the remaining (odd-aligned) bytes as UTF-16 instead
  // of aborting. Run in a subprocess so a process abort surfaces as a nonzero exit
  // code rather than killing the test runner.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        // 0x41 prefix byte, then UTF-16LE BOM (FF FE) followed by "hi" / "42".
        // slice(1) makes the decoded view start at an odd offset into the backing store.
        const textBytes = new Uint8Array([0x41, 0xff, 0xfe, 0x68, 0x00, 0x69, 0x00]);
        const oddText = await new Blob([textBytes]).slice(1).text();

        const jsonBytes = new Uint8Array([0x41, 0xff, 0xfe, 0x34, 0x00, 0x32, 0x00]);
        const oddJson = await new Blob([jsonBytes]).slice(1).json();

        // The aligned (offset 0) UTF-16LE BOM case keeps working too.
        const alignedText = await new Blob([new Uint8Array([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00])]).text();

        console.log(JSON.stringify({ oddText, oddJson, alignedText }));
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe(JSON.stringify({ oddText: "hi", oddJson: 42, alignedText: "hi" }));
  expect(exitCode).toBe(0);
});

// structuredClone/postMessage of sliced Blobs and Files is covered by
// test/js/web/structured-clone-blob-file.test.ts. These tests focus on the
// consumer paths that go through resolve_size()/resolved_size() rather than
// serialization — streaming a slice and using one as an HTTP body.
describe("slice bounds are respected when streaming and serving", () => {
  test("Blob.slice(start, end).stream()", async () => {
    const s = new Blob(["0123456789"]).slice(3, 7);
    expect(await new Response(s.stream()).text()).toBe("3456");
    // Streaming must not mutate the slice either.
    expect(s.size).toBe(4);
    expect(await s.text()).toBe("3456");
  });

  test("Response(slice).body reader", async () => {
    const res = new Response(new Blob(["0123456789"]).slice(3, 7));
    const reader = res.body!.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    expect(Buffer.concat(chunks).toString()).toBe("3456");
  });

  test("content-length of a sliced Blob response body", async () => {
    await using server = Bun.serve({
      port: 0,
      fetch: () => new Response(new Blob(["0123456789"]).slice(3, 7)),
    });

    const head = await fetch(`http://localhost:${server.port}/`, { method: "HEAD" });
    expect(head.headers.get("content-length")).toBe("4");

    const get = await fetch(`http://localhost:${server.port}/`);
    expect(get.headers.get("content-length")).toBe("4");
    expect(await get.text()).toBe("3456");
  });
});

// A slice shares its parent's backing store. Once the parent and the slice
// objects have been collected, a stream made from the slice holds the only
// reference to that store, and the buffered consumers (Bun.readableStreamTo*,
// stream.text(), text() of a Response or Request whose body is that stream)
// take a fast path that hands the store itself to JS. That path used to ignore
// the slice's offset and size and return every byte in the store.
describe("consuming a slice's stream after the Blobs were collected", () => {
  // Bytes on both sides of the slice, non-ASCII after it. The slice is valid
  // JSON so that every consumer can be checked against the same fixture.
  const parts = ["xx", '"abc"', "héllo wörld ✓"];
  const start = 2;
  const end = 7;
  const sliced = '"abc"';

  // Resolves once every Blob passed to `track` has been finalized, which is
  // when it releases its reference on the store.
  async function afterBlobsAreCollected<T>(make: (track: (blob: Blob) => Blob) => T): Promise<T> {
    let tracked = 0;
    let collected = 0;
    const registry = new FinalizationRegistry(() => collected++);
    const result = make(blob => {
      tracked++;
      registry.register(blob, undefined);
      return blob;
    });
    while (collected < tracked) await gcTick();
    return result;
  }

  type Track = (blob: Blob) => Blob;

  function fromCollectedSlice<T>(make: (slice: Blob, track: Track) => T) {
    return afterBlobsAreCollected(track => {
      const parent = track(new Blob(parts));
      const slice = track(parent.slice(start, end));
      return make(slice, track);
    });
  }

  const sources: [string, (slice: Blob, track: Track) => ReadableStream][] = [
    ["slice.stream()", slice => slice.stream()],
    ["new Response(slice).body", slice => new Response(slice).body!],
    ["new Blob([slice]).stream()", (slice, track) => track(new Blob([slice])).stream()],
  ];

  const consumers: [string, (stream: ReadableStream) => Promise<unknown>, unknown][] = [
    ["Bun.readableStreamToText", stream => Bun.readableStreamToText(stream), sliced],
    [
      "Bun.readableStreamToBytes",
      async stream => Buffer.from(await Bun.readableStreamToBytes(stream)).toString(),
      sliced,
    ],
    [
      "Bun.readableStreamToArrayBuffer",
      async stream => Buffer.from(await Bun.readableStreamToArrayBuffer(stream)).toString(),
      sliced,
    ],
    ["Bun.readableStreamToJSON", stream => Bun.readableStreamToJSON(stream), "abc"],
    [
      "Bun.readableStreamToBlob",
      async stream => {
        const blob = await Bun.readableStreamToBlob(stream);
        return [blob.size, await blob.text()];
      },
      [sliced.length, sliced],
    ],
    ["stream.text()", stream => stream.text(), sliced],
    ["stream.json()", stream => stream.json(), "abc"],
    ["stream.bytes()", async stream => Buffer.from(await stream.bytes()).toString(), sliced],
  ];

  describe.each(sources)("%s", (_, makeStream) => {
    test.each(consumers)("%s", async (_, consume, expected) => {
      const stream = await fromCollectedSlice(makeStream);
      expect(await consume(stream)).toEqual(expected);
    });
  });

  // A body keeps a Blob-backed stream as its stream, and text() reads it
  // through the same fast path as Bun.readableStreamToText.
  const bodies: [string, (slice: Blob) => Response | Request][] = [
    [
      "new Response(slice) after .body was accessed",
      slice => {
        const response = new Response(slice);
        expect(response.body).toBeInstanceOf(ReadableStream);
        return response;
      },
    ],
    ["new Response(slice.stream())", slice => new Response(slice.stream())],
    ["new Response(new Response(slice).body)", slice => new Response(new Response(slice).body)],
    [
      "new Request(url, { body: new Response(slice).body })",
      slice => new Request("http://localhost/", { method: "POST", body: new Response(slice).body, duplex: "half" }),
    ],
  ];

  test.each(bodies)("%s, read by text()", async (_, makeBody) => {
    const body = await fromCollectedSlice(makeBody);
    expect(await body.text()).toBe(sliced);
  });

  // A prefix starts at the store's first byte and a suffix ends at its last:
  // the offset alone, or the end alone, does not tell them from the whole store.
  const windows: [string, (parent: Blob, track: Track) => Blob, string][] = [
    ["slice(0, 7), a prefix", parent => parent.slice(0, 7), 'xx"abc"'],
    ["slice(0, 7).slice(0, 2), a prefix of a prefix", (parent, track) => track(parent.slice(0, 7)).slice(0, 2), "xx"],
    ["slice(7), a suffix", parent => parent.slice(7), "héllo wörld ✓"],
    ["slice(1).slice(1, 6), a slice of a slice", (parent, track) => track(parent.slice(1)).slice(1, 6), sliced],
    ["slice(0, 0), empty at the start", parent => parent.slice(0, 0), ""],
    ["slice(2, 2), empty in the middle", parent => parent.slice(2, 2), ""],
    ["slice(0), the whole Blob", parent => parent.slice(0), parts.join("")],
  ];

  test.each(windows)("%s", async (_, makeWindow, expected) => {
    const stream = await afterBlobsAreCollected(track => track(makeWindow(track(new Blob(parts)), track)).stream());
    expect(await Bun.readableStreamToText(stream)).toBe(expected);
  });

  // An unsliced Blob views its whole store, so handing the store over is fine.
  // A type makes the stream go through the same code a slice does, with a
  // view that happens to cover the store.
  test.each([
    ["untyped", undefined],
    ["typed", { type: "text/plain" }],
  ])("%s unsliced Blob still yields everything", async (_, options) => {
    const stream = await afterBlobsAreCollected(track => track(new Blob(parts, options)).stream());
    expect(await Bun.readableStreamToText(stream)).toBe(parts.join(""));
  });
});

// Wrapping a Blob whose type is heap-owned (not in the mime table) with a
// known mime type overwrote content_type with a static pointer without
// clearing content_type_allocated, so GC sweep freed a static pointer.
test.skipIf(!isASAN).each(["Blob", "File"] as const)(
  "new %s([typedBlob], {type}) with a known mime type does not free a static pointer",
  async Ctor => {
    const make =
      Ctor === "Blob" ? `new Blob([inner], { type: "text/plain" })` : `new File([inner], "f", { type: "text/plain" })`;
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const inner = new Blob(["y"], { type: "x/not-in-the-table" });
          for (let i = 0; i < 2000; i++) {
            ${make};
            if ((i & 127) === 0) Bun.gc(true);
          }
          Bun.gc(true); Bun.gc(true);
          console.log(${make}.type);
        `,
      ],
      env: { ...bunEnv, ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "symbolize=0"].filter(Boolean).join(":") },
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode, signalCode: proc.signalCode }).toEqual({
      stdout: expect.stringMatching(/^text\/plain(;charset=utf-8)?\n$/),
      stderr: expect.not.stringContaining("AddressSanitizer"),
      exitCode: 0,
      signalCode: null,
    });
  },
);

// File-backed twin of "slice bounds are respected when streaming and serving"
// above: the File arm of resolve_size()/resolved_size() must not widen a
// sliced Bun.file() to the end of the file either.
describe("file-backed slice bounds are respected when streaming and serving", () => {
  test("Bun.file(path).slice(start, end) streams only the slice", async () => {
    using dir = tempDir("blob-file-slice", { "data.txt": "0123456789".repeat(10) });
    const s = Bun.file(`${dir}/data.txt`).slice(3, 7);
    expect(await new Response(s).text()).toBe("3456");
    // Streaming must not mutate the slice either.
    expect(s.size).toBe(4);

    let streamed = 0;
    for await (const chunk of new Response(Bun.file(`${dir}/data.txt`).slice(0, 5)).body!) {
      streamed += chunk.length;
    }
    expect(streamed).toBe(5);
  });

  test("content-length of a sliced Bun.file response body", async () => {
    using dir = tempDir("blob-file-slice-cl", { "data.txt": "0123456789".repeat(10) });
    await using server = Bun.serve({
      port: 0,
      fetch: () => new Response(Bun.file(`${dir}/data.txt`).slice(3, 7)),
    });

    const head = await fetch(server.url, { method: "HEAD" });
    expect(head.headers.get("content-length")).toBe("4");

    const get = await fetch(server.url);
    expect(get.headers.get("content-length")).toBe("4");
    expect(await get.text()).toBe("3456");
  });

  test("structuredClone keeps the slice size and does not mutate the original", async () => {
    using dir = tempDir("blob-file-slice-clone", { "data.txt": "0123456789".repeat(10) });
    const s = Bun.file(`${dir}/data.txt`).slice(0, 5);
    expect(s.size).toBe(5);
    const clone = structuredClone(s);
    expect(clone.size).toBe(5);
    expect(s.size).toBe(5);
    expect(await clone.text()).toBe("01234");
    expect(await s.text()).toBe("01234");
  });

  test("slice end beyond EOF clamps to the file size", async () => {
    using dir = tempDir("blob-file-slice-eof", { "data.txt": "0123456789" });
    const s = Bun.file(`${dir}/data.txt`).slice(5, 5000);
    expect(await new Response(s).text()).toBe("56789");
    const clone = structuredClone(s);
    expect(await clone.text()).toBe("56789");
    // Serializing resolves the original's size, clamping the window to EOF.
    expect(s.size).toBe(5);
  });

  // A sliced Bun.file() is streamed by FileReader, which hands bytes out two
  // ways: a JS pull reads straight into the pull buffer, while a native sink
  // (HTMLRewriter here; also pollable fds and Windows) is fed from the read
  // loop's on_read_chunk. Both have to stop at the end of the slice while the
  // file goes on past it, and a used-up slice has to end the stream, not hang it.
  describe("a slice of a file that continues past it", () => {
    const size = 1024 * 1024;
    // 61-byte period: coprime with every chunk size involved, so bytes streamed
    // from the wrong offset compare unequal, not just a wrong number of them.
    const data = Buffer.alloc(size, "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXY");
    const windows: [start: number, end: number][] = [
      [0, 5], // inside the first read
      [3, 7],
      [0, 256 * 1024], // exactly the first pull's buffer: the window ends on a read that fills it
      [100, 700_000], // several pulls; the last one has to be cut short
      [size - 10, size], // ends at EOF
      [size - 10, size + 100], // the file ends first (the slice is taken before the size is known)
      [4096, 4096], // nothing to deliver at all
    ];

    async function collect(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
      const chunks: Uint8Array[] = [];
      for await (const chunk of stream) chunks.push(chunk);
      return Buffer.concat(chunks);
    }

    // `subarray` clamps at EOF like the stream has to.
    function expectWindow(delivered: Buffer, start: number, end: number) {
      const expected = data.subarray(start, end);
      expect(delivered.length).toBe(expected.length);
      expect(delivered).toEqual(expected);
    }

    test.each(windows)("Bun.file(path).slice(%d, %d).stream()", async (start, end) => {
      using dir = tempDir("blob-file-slice-stream", { "data.bin": data });
      expectWindow(await collect(Bun.file(`${dir}/data.bin`).slice(start, end).stream()), start, end);
    });

    // Buffered consumers size their pulls from the slice and need the stream to
    // close once it is delivered (#18192, #31675).
    test.each(windows)("Bun.file(path).slice(%d, %d).stream().bytes()", async (start, end) => {
      using dir = tempDir("blob-file-slice-bytes", { "data.bin": data });
      const bytes = await Bun.file(`${dir}/data.bin`).slice(start, end).stream().bytes();
      expectWindow(Buffer.from(bytes), start, end);
    });

    test.each(windows)("new Response(Bun.file(path).slice(%d, %d)).body", async (start, end) => {
      using dir = tempDir("blob-file-slice-body", { "data.bin": data });
      expectWindow(await collect(new Response(Bun.file(`${dir}/data.bin`).slice(start, end)).body!), start, end);
    });

    test.each(windows)("HTMLRewriter.transform(new Response(Bun.file(path).slice(%d, %d)))", async (start, end) => {
      using dir = tempDir("blob-file-slice-rewriter", { "data.bin": data });
      const response = new HTMLRewriter().transform(new Response(Bun.file(`${dir}/data.bin`).slice(start, end)));
      expectWindow(Buffer.from(await response.arrayBuffer()), start, end);
    });

    // Reading .size gives the unsliced file's stream a window that ends exactly
    // where the file does; ending the stream there must not drop the last chunk.
    test("Bun.file(path) with a resolved size still streams the whole file", async () => {
      using dir = tempDir("blob-file-resolved-size-stream", { "data.bin": data });
      const file = Bun.file(`${dir}/data.bin`);
      expect(file.size).toBe(size);
      expectWindow(await collect(file.stream()), 0, size);
    });
  });
});

// Blob conversion accepts every ArrayBuffer-like type, both as a direct body
// value and as a part inside an array.
describe("Blob from ArrayBuffer-like values", () => {
  const bytes = Uint8Array.from({ length: 16 }, (_, i) => i + 1);
  const views = [
    ["ArrayBuffer", () => bytes.slice().buffer],
    ["DataView", () => new DataView(bytes.slice().buffer)],
    ["Int8Array", () => new Int8Array(bytes.slice().buffer)],
    ["Uint8Array", () => bytes.slice()],
    ["Uint8ClampedArray", () => new Uint8ClampedArray(bytes.slice().buffer)],
    ["Int16Array", () => new Int16Array(bytes.slice().buffer)],
    ["Uint16Array", () => new Uint16Array(bytes.slice().buffer)],
    ["Int32Array", () => new Int32Array(bytes.slice().buffer)],
    ["Uint32Array", () => new Uint32Array(bytes.slice().buffer)],
    ["Float16Array", () => new Float16Array(bytes.slice().buffer)],
    ["Float32Array", () => new Float32Array(bytes.slice().buffer)],
    ["Float64Array", () => new Float64Array(bytes.slice().buffer)],
    ["BigInt64Array", () => new BigInt64Array(bytes.slice().buffer)],
    ["BigUint64Array", () => new BigUint64Array(bytes.slice().buffer)],
  ] as const;

  test.each(views)("new Blob([%s]) copies the bytes", async (_name, make) => {
    const view = make();
    const blob = new Blob([view as any]);
    expect(blob.size).toBe(view.byteLength);
    expect(await blob.bytes()).toEqual(bytes);
  });

  test.each(views)("new Response(%s).blob() copies the bytes", async (_name, make) => {
    const view = make();
    const blob = await new Response(view as any).blob();
    expect(blob.size).toBe(view.byteLength);
    expect(await blob.bytes()).toEqual(bytes);
  });

  test("string, view, and Blob parts concatenate in order", async () => {
    const blob = new Blob([
      "ab",
      new Uint8Array([0x63, 0x64]),
      new Blob(["ef"]),
      new DataView(new Uint8Array([0x67, 0x68]).buffer),
    ]);
    expect(await blob.text()).toBe("abcdefgh");
  });
});

// A `type` that is a registered MIME string is interned; `slice()` without a
// contentType keeps an interned parent type. Guards the interned set's membership.
test.each([
  ["text/plain;charset=utf-8", "text/plain;charset=utf-8"],
  ["image/tiff", "image/tiff"],
  ["application/vnd.api+json", "application/vnd.api+json"],
  ["application/x-www-form-urlencoded", "application/x-www-form-urlencoded;charset=UTF-8"],
  ["application/x-not-a-registered-type", ""],
])("new Blob([], { type: %j }).slice().type", (type, expected) => {
  const blob = new Blob(["abc"], { type });
  expect(blob.slice(0, 1).type).toBe(expected);
});

// `new Blob(blobParts)` and `new File(fileBits, name)` take a WebIDL
// `sequence<BlobPart>`: any iterable object, converted one part at a time.
// Expected values are what node v26 and WPT FileAPI/blob/Blob-constructor.any.js give.
describe("blobParts is converted as a sequence", () => {
  class SubBlob extends Blob {}
  class SubArray extends Array {}
  class OwnIterator extends Array {}
  Object.defineProperty(OwnIterator.prototype, Symbol.iterator, {
    value: function* () {
      yield "x";
    },
  });
  function* generate(...parts: unknown[]) {
    yield* parts;
  }
  const thrown = (fn: () => unknown) => {
    try {
      fn();
    } catch (error) {
      return error;
    }
  };
  const notASequence = {
    name: "TypeError",
    code: "ERR_INVALID_ARG_TYPE",
    message: "Blob parts must be a sequence: an Array or another iterable object",
  };
  const constructors: [string, (parts?: any) => Blob][] = [
    ["Blob", parts => new Blob(parts)],
    ["File", parts => new File(parts, "f.txt")],
    ["a Blob subclass", parts => new SubBlob(parts)],
    ["Reflect.construct(Blob)", parts => Reflect.construct(Blob, [parts])],
  ];

  describe.each(constructors)("new %s", (_, create) => {
    const lists: [string, () => any, string][] = [
      ["an Array", () => ["a", "b"], "ab"],
      ["a Set", () => new Set(["a", "b"]), "ab"],
      ["an empty Set", () => new Set(), ""],
      ["a Map", () => new Map([["a", "b"]]), "a,b"],
      ["a generator", () => generate("a", "b"), "ab"],
      ["array.values()", () => ["a", "b"].values(), "ab"],
      // prettier-ignore
      ["arguments", () => (function (..._: string[]) { return arguments; })("a", "b"), "ab"],
      ["a Proxy of an array", () => new Proxy(["a", "b"], {}), "ab"],
      ["a String object", () => new String("ab"), "ab"],
      ["URLSearchParams", () => new URLSearchParams("a=b"), "a,b"],
      ["an object with @@iterator", () => ({ [Symbol.iterator]: () => ["a", "b"].values() }), "ab"],
      [
        "an array-like that borrows Array.prototype[@@iterator]",
        () => ({ [Symbol.iterator]: Array.prototype[Symbol.iterator], 0: "a", 1: "b", length: 2 }),
        "ab",
      ],
      ["an Array subclass", () => SubArray.of("a", "b"), "ab"],
      ["an Array subclass with its own @@iterator", () => OwnIterator.of("a", "b"), "x"],
      [
        "an array with an own @@iterator",
        () => Object.assign(["a", "b"], { [Symbol.iterator]: () => ["z"].values() }),
        "z",
      ],
      ["a frozen array", () => Object.freeze(["a", "b"]), "ab"],
      ["an array of doubles", () => [1.5, 2.5], "1.52.5"],
      ["an array from another realm", () => vm.runInNewContext("['a', 'b']"), "ab"],
      ["a Set from another realm", () => vm.runInNewContext("new Set(['a', 'b'])"), "ab"],
    ];
    test.each(lists)("%s converts like its spread", async (_, list, expected) => {
      expect(await create(list()).text()).toBe(expected);
      expect(await create([...list()]).text()).toBe(expected);
    });

    test.each<[string, () => unknown]>([
      ["null", () => null],
      ["a number", () => 5],
      ["a boolean", () => true],
      ["a string", () => "ab"],
      ["a symbol", () => Symbol()],
      ["a bigint", () => 1n],
      ["a plain object", () => ({})],
      ["an array-like", () => ({ length: 1, 0: "a" })],
      ["a Date", () => new Date(0)],
      ["a RegExp", () => /a/],
      ["a function", () => () => {}],
      ["a Blob", () => new Blob(["a"])],
      ["an async generator", () => (async function* () {})()],
      ["an array whose @@iterator is undefined", () => Object.assign(["a"], { [Symbol.iterator]: undefined })],
      ["an array whose @@iterator is null", () => Object.assign(["a"], { [Symbol.iterator]: null })],
    ])("%s is not a sequence", (_, value) => {
      expect(thrown(() => create(value()))).toMatchObject(notASequence);
    });

    test.each<[string, () => unknown]>([
      ["is not callable", () => Object.assign(["a"], { [Symbol.iterator]: 5 })],
      ["returns a primitive", () => ({ [Symbol.iterator]: () => 5 })],
    ])("an @@iterator that %s throws a TypeError", (_, value) => {
      expect(thrown(() => create(value()))).toBeInstanceOf(TypeError);
    });

    test("a primitive is not iterated through its wrapper's @@iterator", () => {
      const original = String.prototype[Symbol.iterator];
      String.prototype[Symbol.iterator] = () => ["FAIL"][Symbol.iterator]();
      (Boolean.prototype as any)[Symbol.iterator] = () => ["FAIL"][Symbol.iterator]();
      try {
        expect(thrown(() => create("ab"))).toMatchObject(notASequence);
        expect(thrown(() => create(true))).toMatchObject(notASequence);
      } finally {
        String.prototype[Symbol.iterator] = original;
        delete (Boolean.prototype as any)[Symbol.iterator];
      }
    });

    test("undefined is an omitted argument", async () => {
      const blob = create(undefined);
      expect([blob.size, await blob.text()]).toEqual([0, ""]);
    });

    // The text of [x, y] is the text of [x] followed by the text of [y].
    test.each<[string, string, any]>([
      ["['a', null]", "anull", ["a", null]],
      ["[null, 'b']", "nullb", [null, "b"]],
      ["['a', undefined]", "aundefined", ["a", undefined]],
      ["[null]", "null", [null]],
      ["[undefined]", "undefined", [undefined]],
      ["[null, undefined]", "nullundefined", [null, undefined]],
      ["['a', , 'b']", "aundefinedb", ["a", , "b"]],
      ["[,]", "undefined", [,]],
      ["[, ,]", "undefinedundefined", [, ,]],
      ["a sparse array", "aundefinedb", Object.assign([], { 0: "a", 2: "b" })],
      ["new Set(['a', null, undefined])", "anullundefined", new Set(["a", null, undefined])],
      ["[null, Uint8Array, undefined]", "nullAundefined", [null, new Uint8Array([65]), undefined]],
      ["[undefined, Blob, null]", "undefinedBnull", [undefined, new Blob(["B"]), null]],
      ["[1, true, 2n, 1.5, -0]", "1true21.50", [1, true, 2n, 1.5, -0]],
    ])("%s is %j", async (_, expected, parts) => {
      expect(await create(parts).text()).toBe(expected);
      let joined = "";
      for (const part of parts) joined += await create([part]).text();
      expect(joined).toBe(expected);
    });

    test("ToString is called on every part that is not a Blob or a buffer", async () => {
      // WPT "ToString should be called on elements of the blobParts array."
      const parts: unknown[] = [
        null,
        undefined,
        true,
        false,
        0,
        1,
        new String("stringobject"),
        [],
        ["x", "y"],
        {},
        { 0: "FAIL", length: 1 },
        { toString: () => "stringA" },
        { toString: undefined, valueOf: () => "stringB" },
        { valueOf: () => "FAIL" },
      ];
      expect(await create(parts).text()).toBe(
        "nullundefinedtruefalse01stringobjectx,y[object Object][object Object]stringAstringB[object Object]",
      );
    });

    test("@@iterator is read once and each part is converted before the next step", async () => {
      const log: string[] = [];
      const part = (name: string) => ({ toString: () => (log.push(`toString ${name}`), name) });
      const list = {
        get [Symbol.iterator]() {
          log.push("get @@iterator");
          return () => {
            log.push("call @@iterator");
            const parts = [part("a"), part("b")];
            return {
              get next() {
                log.push("get next");
                return () => {
                  log.push("call next");
                  return parts.length ? { value: parts.shift(), done: false } : { value: undefined, done: true };
                };
              },
              return: () => (log.push("call return"), {}),
            };
          };
        },
      };
      expect(await create(list).text()).toBe("ab");
      expect(log).toEqual([
        "get @@iterator",
        "call @@iterator",
        "get next",
        "call next",
        "toString a",
        "call next",
        "toString b",
        "call next",
      ]);
    });

    test("an array-like under Array.prototype[@@iterator] is read in order until a getter throws", () => {
      // WPT "Getters and value conversions should happen in order until an exception is thrown."
      const log: string[] = [];
      const error = new Error("test error");
      const list = {
        get [Symbol.iterator]() {
          log.push("Symbol.iterator");
          return Array.prototype[Symbol.iterator];
        },
        get length() {
          log.push("length getter");
          return { valueOf: () => (log.push("length valueOf"), 3) };
        },
        get 0() {
          log.push("0 getter");
          return { toString: () => (log.push("0 toString"), "a") };
        },
        get 1() {
          log.push("1 getter");
          throw error;
        },
        get 2() {
          log.push("2 getter");
          return "FAIL";
        },
      };
      expect(thrown(() => create(list))).toBe(error);
      expect(log).toEqual([
        "Symbol.iterator",
        "length getter",
        "length valueOf",
        "0 getter",
        "0 toString",
        "length getter",
        "length valueOf",
        "1 getter",
      ]);
    });

    test("a Proxy of an array is read through its traps", async () => {
      const log: string[] = [];
      const list = new Proxy(["a", "b"], {
        get: (target, key, receiver) => (log.push(`get ${String(key)}`), Reflect.get(target, key, receiver)),
      });
      expect(await create(list).text()).toBe("ab");
      expect(log).toEqual(["get Symbol(Symbol.iterator)", "get length", "get 0", "get length", "get 1", "get length"]);
    });

    test("a part that fails to convert ends the walk and does not close the iterator", () => {
      const log: string[] = [];
      const error = new RangeError("boom");
      const steps: unknown[] = [
        {
          toString() {
            log.push("toString");
            throw error;
          },
        },
        "FAIL",
      ];
      const list = {
        [Symbol.iterator]: () => ({
          next: () => (log.push("next"), steps.length ? { value: steps.shift(), done: false } : { done: true }),
          return: () => (log.push("return"), {}),
        }),
      };
      expect(thrown(() => create(list))).toBe(error);
      expect(log).toEqual(["next", "toString"]);
      expect(thrown(() => create(generate("a", Symbol("part"))))).toBeInstanceOf(TypeError);
    });

    test("an error thrown by the iterator propagates", () => {
      const error = new RangeError("boom");
      function* parts() {
        yield "a";
        throw error;
      }
      expect(thrown(() => create(parts()))).toBe(error);
      expect(thrown(() => create({ [Symbol.iterator]: () => ({ next: () => 5 }) }))).toBeInstanceOf(TypeError);
    });

    test("an array that a part's toString changes is followed", async () => {
      const grown: unknown[] = ["a", { toString: () => (grown.push("LATE"), "b") }];
      expect(await create(grown).text()).toBe("abLATE");

      const alone: unknown[] = [{ toString: () => (alone.push("LATE"), "y") }];
      expect(await create(alone).text()).toBe("yLATE");

      const boxed = Object.assign(new String("x"), { toString: () => (aloneBoxed.push("LATE"), "y") });
      const aloneBoxed: unknown[] = [boxed];
      expect(await create(aloneBoxed).text()).toBe("yLATE");

      // WPT "Changes to the blobParts array should be reflected in the returned Blob (pop)."
      const popped: unknown[] = [{ toString: () => (popped.pop(), "PASS") }, { toString: () => "FAIL" }];
      expect(await create(popped).text()).toBe("PASS");

      // WPT "... (unshift)."
      const unshifted: unknown[] = [
        { toString: () => (unshifted.length === 3 ? "A" : (unshifted.unshift({ toString: () => "FAIL" }), "P")) },
        { toString: () => "SS" },
      ];
      expect(await create(unshifted).text()).toBe("PASS");
    });

    test("a list that holds one Blob is that Blob, whatever kind of list it is", async () => {
      using dir = tempDir("blob-parts-sequence", { "f.txt": "file-contents" });
      const file = () => Bun.file(path.join(String(dir), "f.txt"));
      const typed = new Blob(["x"], { type: "text/x" });
      for (const list of [
        (part: Blob) => new Set([part]),
        (part: Blob) => generate(part),
        (part: Blob) => Object.freeze([part]),
      ]) {
        // A file-backed Blob has its content only when the list shares its store.
        expect(await create(list(file())).text()).toBe(await create([file()]).text());
        expect(create(list(typed)).type).toBe(create([typed]).type);
      }
      expect(await create([file()]).text()).toBe("file-contents");
      expect(await create(generate(new Blob(["a"]), "b", new Blob(["c"]))).text()).toBe("abc");
    });
  });

  test("new File converts fileBits before fileName", () => {
    const log: string[] = [];
    const bits = {
      *[Symbol.iterator]() {
        log.push("bits");
        yield "a";
      },
    };
    const name = { toString: () => (log.push("name"), "n") };
    expect(new File(bits as any, name as any).name).toBe("n");
    expect(log).toEqual(["bits", "name"]);

    log.length = 0;
    expect(thrown(() => new File(null as any, name as any))).toMatchObject(notASequence);
    expect(log).toEqual([]);
  });

  test("node:stream/consumers blob() stringifies null and undefined chunks", async () => {
    async function* chunks() {
      yield "a";
      yield null;
      yield undefined;
      yield "b";
    }
    expect(await (await consumeBlob(chunks() as any)).text()).toBe("anullundefinedb");
  });

  // An Array as `Bun.write` data or as a `Response`/`Request`/`fetch` body is a Bun
  // extension, not a sequence: it is read by index, its null and undefined
  // elements add nothing, and any other object is one part.
  describe("an Array given as data or as a body is not a sequence", () => {
    const rows: [string, () => any, string][] = [
      ["['a', null, 'b']", () => ["a", null, "b"], "ab"],
      ["['a', undefined, 'b']", () => ["a", undefined, "b"], "ab"],
      ["['a', , 'b']", () => ["a", , "b"], "ab"],
      ["[null, null]", () => [null, null], ""],
      ["[null]", () => [null], "null"],
      ["[,]", () => [,], "undefined"],
      ["[1, true]", () => [1, true], "1true"],
      ["[Uint8Array, 'b']", () => [new Uint8Array([65]), "b"], "Ab"],
      ["[Blob, 'c']", () => [new Blob(["B"]), "c"], "Bc"],
      ["[['x', 'y']]", () => [["x", "y"]], "x,y"],
      ["new Set(['a'])", () => new Set(["a"]), "[object Set]"],
      ["{}", () => ({}), "[object Object]"],
    ];

    test.each(rows)("%s", async (_, data, expected) => {
      using dir = tempDir("blob-parts-extension", {});
      await using server = Bun.serve({ port: 0, fetch: async request => new Response(await request.text()) });
      const written = path.join(String(dir), "written.txt");
      await Bun.write(written, data());
      const file = Bun.file(path.join(String(dir), "file.txt"));
      await file.write(data());
      expect({
        "Bun.write": await Bun.file(written).text(),
        "Bun.file().write": await file.text(),
        "new Response": await new Response(data()).text(),
        "new Request": await new Request(server.url.href, { method: "POST", body: data() }).text(),
        "fetch": await (await fetch(server.url, { method: "POST", body: data() })).text(),
        // @ts-expect-error the types do not declare the init argument of server.fetch()
        "server.fetch": await (await server.fetch(server.url.href, { method: "POST", body: data() })).text(),
      }).toEqual({
        "Bun.write": expected,
        "Bun.file().write": expected,
        "new Response": expected,
        "new Request": expected,
        "fetch": expected,
        "server.fetch": expected,
      });
    });
  });

  const run = async (script: string) => {
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  };

  // Patching the protocol is process-wide and permanent for JSC's fast paths, so it runs in a child.
  test.concurrent("a patched Array iterator protocol reaches the constructors, not the stream consumers", async () => {
    const script = `
      const text = async make => { try { return await (await make()).text(); } catch (error) { return error.name; } };
      const results = {};
      let calls = 0;
      const values = Array.prototype[Symbol.iterator];
      Array.prototype[Symbol.iterator] = function () { calls++; return values.call(this); };
      const stream = () => new ReadableStream({
        start(controller) {
          controller.enqueue("a");
          controller.enqueue(null);
          controller.enqueue(undefined);
          controller.enqueue("b");
          controller.close();
        },
      });
      const read = async blob => { calls = 0; return [await text(blob), calls]; };
      results["Response.blob()"] = await read(() => new Response(stream()).blob());
      results["ReadableStream.blob()"] = await read(() => stream().blob());
      results["Bun.readableStreamToBlob()"] = await read(() => Bun.readableStreamToBlob(stream()));
      results["new Blob()"] = await read(() => new Blob(["a", "b"]));

      Array.prototype[Symbol.iterator] = function* () { yield "patched"; };
      results.iterator = [await text(() => new Blob(["a", "b"])), await text(() => new File(["a", "b"], "f"))];
      Array.prototype[Symbol.iterator] = values;
      const prototype = Object.getPrototypeOf([][Symbol.iterator]());
      const next = prototype.next;
      prototype.next = function () {
        const step = next.call(this);
        return step.done ? step : { done: false, value: step.value + "!" };
      };
      results.next = await text(() => new Blob(["a", "b"]));
      prototype.next = next;
      delete Array.prototype[Symbol.iterator];
      results.deleted = await text(() => new Blob(["a", "b"]));
      Array.prototype[Symbol.iterator] = values;
      process.stdout.write(JSON.stringify(results));
    `;
    expect(await run(script)).toEqual({
      stdout: JSON.stringify({
        "Response.blob()": ["ab", 0],
        "ReadableStream.blob()": ["ab", 0],
        "Bun.readableStreamToBlob()": ["ab", 0],
        "new Blob()": ["ab", 1],
        iterator: ["patched", "patched"],
        next: "a!b!",
        deleted: "TypeError",
      }),
      stderr: "",
      exitCode: 0,
    });
  });

  // User JS runs between the steps of an iterator, so a buffer or Blob part is
  // copied when it arrives. Under ASAN a borrowed part is a use-after-poison.
  test.concurrent("a part keeps its bytes when a later step of the iterator frees it", async () => {
    const script = `
      const SIZE = 1 << 16;
      const results = {};
      {
        const buffer = new ArrayBuffer(SIZE, { maxByteLength: SIZE * 2 });
        const part = new Uint8Array(buffer).fill(0x41);
        function* parts() {
          yield part;
          new Uint8Array(buffer.transfer()).fill(0x42);
          yield "x";
        }
        results["typed array"] = (await new Blob(parts()).text()) === Buffer.alloc(SIZE, "A").toString() + "x";
      }
      {
        function* parts() {
          yield new Blob([Buffer.alloc(SIZE, "A")]);
          Bun.gc(true);
          const clobber = [];
          for (let i = 0; i < 8; i++) clobber.push(Buffer.alloc(SIZE, "B"));
          yield "x";
        }
        results["Blob"] = (await new Blob(parts()).text()) === Buffer.alloc(SIZE, "A").toString() + "x";
      }
      {
        let expected = "";
        function* parts() {
          for (let i = 0; i < 8; i++) {
            expected += "s" + i + ";b" + i + ";B" + i + ";o" + i + ";";
            yield "s" + i + ";";
            yield Buffer.from("b" + i + ";");
            yield new Blob(["B" + i + ";"]);
            yield { toString: () => "o" + i + ";" };
            Bun.gc(true);
          }
        }
        results["parts only the iterator holds"] = (await new Blob(parts()).text()) === expected;
      }
      process.stdout.write(JSON.stringify(results));
    `;
    expect(await run(script)).toEqual({
      stdout: JSON.stringify({ "typed array": true, "Blob": true, "parts only the iterator holds": true }),
      stderr: "",
      exitCode: 0,
    });
  });
});
