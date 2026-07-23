import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, tempDir } from "harness";
import type { BlobOptions } from "node:buffer";
import type { BinaryLike } from "node:crypto";
import path from "node:path";

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
    // `start`/`end` go through ToNumber, so values it rejects throw like in Node and browsers
    // @ts-expect-error
    expect(() => blob.slice(Symbol(), "-123")).toThrow(TypeError);
    expect(() => blob.slice(Object.create(null), "-123")).toThrow(TypeError);
    // @ts-expect-error
    expect(blob.slice(null, "-123").size).toBe(6);
    expect(blob.slice(0, 10).size).toBe(blob.size);
    expect(blob.slice("text/plain;charset=utf-8").type).toBe("text/plain;charset=utf-8");

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
  expect(await new Blob([url]).text()).toBe("https://example.com/path");
  expect(await new Blob(["a", url, "b"]).text()).toBe("ahttps://example.com/pathb");
  expect(await new Blob(["a", {}, "b"]).text()).toBe("a[object Object]b");
  expect(await new Blob(["a", {}, "b", { toString: () => "X" }]).text()).toBe("a[object Object]bX");
  expect(await new Blob(["a", ["x", "y"], "b"]).text()).toBe("ax,yb");
});

test("new Blob stringifies null and undefined parts instead of dropping them", async () => {
  expect(await new Blob([null] as any[]).text()).toBe("null");
  expect(await new Blob([undefined] as any[]).text()).toBe("undefined");
  expect(await new Blob(["a", null, "b", undefined] as any[]).text()).toBe("anullbundefined");
  // a hole reads as `undefined`
  expect(await new Blob([, "x"] as any[]).text()).toBe("undefinedx");

  const blob = new Blob([null, undefined, 1, {}, true] as any[]);
  expect(await blob.text()).toBe("nullundefined1[object Object]true");
  expect(blob.size).toBe(33);

  expect(await new File(["a", null] as any[], "f.txt").text()).toBe("anull");
});

test("new Blob(null) throws and new Blob(undefined) is an empty Blob", () => {
  // null is not convertible to a sequence<BlobPart>
  // @ts-expect-error
  expect(() => new Blob(null)).toThrow(TypeError);
  // @ts-expect-error
  expect(() => new File(null, "f.txt")).toThrow(TypeError);
  // undefined means the optional argument was omitted
  expect(new Blob(undefined).size).toBe(0);
  expect(new Blob().size).toBe(0);
});

test("new Blob accepts any iterable of parts", async () => {
  expect(await new Blob(new Set(["a", "b"]) as any).text()).toBe("ab");
  expect(await new Blob(new Map([["a", "b"]]) as any).text()).toBe("a,b");
  expect(new Blob(new Set() as any).size).toBe(0);
  expect(await new Blob(new Set([new Blob(["inner"]), "!"]) as any).text()).toBe("inner!");
  expect(await new File(new Set(["a"]) as any, "f.txt").text()).toBe("a");

  function* parts() {
    yield "x";
    yield null;
    yield 3;
    yield new Uint8Array([33]);
  }
  expect(await new Blob(parts() as any).text()).toBe("xnull3!");

  // values produced by a generator are only reachable through the constructor
  function* garbage() {
    for (let i = 0; i < 16; i++) {
      yield `chunk${i};`;
      Bun.gc(true);
    }
  }
  expect(await new Blob(garbage() as any).text()).toBe(Array.from({ length: 16 }, (_, i) => `chunk${i};`).join(""));

  // errors thrown while iterating propagate
  function* throws() {
    yield "x";
    throw new RangeError("mid-iteration");
  }
  expect(() => new Blob(throws() as any)).toThrow(RangeError);

  // non-iterable objects and primitives are still rejected
  expect(() => new Blob({} as any)).toThrow(TypeError);
  expect(() => new Blob({ length: 1, 0: "a" } as any)).toThrow(TypeError);
  expect(() => new Blob(123 as any)).toThrow(TypeError);
  expect(() => new Blob("ab" as any)).toThrow(TypeError);
});

test("Blob.slice applies ToNumber to start/end and ToString to contentType", async () => {
  const blob = new Blob(["hello world"]); // 11 bytes
  // null is provided, so it coerces to 0 instead of being ignored
  expect(blob.slice(null as any, null as any).size).toBe(0);
  expect(blob.slice(0, null as any).size).toBe(0);
  expect(await blob.slice(null as any, 3).text()).toBe("hel");
  // objects coerce through valueOf
  expect(await blob.slice({ valueOf: () => 2 } as any, 4).text()).toBe("ll");
  expect(await blob.slice(false as any, true as any).text()).toBe("h");
  // undefined still means "not provided"
  expect(blob.slice(undefined, undefined).size).toBe(11);
  expect(blob.slice(undefined, undefined, undefined).type).toBe("");
  // a non-string contentType is stringified
  expect(blob.slice(1, 3, 123 as any).type).toBe("123");
  expect(blob.slice(1, 3, { toString: () => "text/x" } as any).type).toBe("text/x");
  // values ToNumber rejects throw
  expect(() => blob.slice(Symbol() as any)).toThrow(TypeError);

  // arguments are converted before the empty-blob fast path returns
  const empty = new Blob([]);
  expect(() => empty.slice(Symbol() as any)).toThrow(TypeError);
  let valueOfCalls = 0;
  expect(empty.slice({ valueOf: () => (valueOfCalls++, 0) } as any).size).toBe(0);
  expect(valueOfCalls).toBe(1);
  expect(empty.slice(0, 0, 123 as any).type).toBe("123");
  expect(empty.slice(0, 0, "text/HTML").type).toBe("text/html");
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
  const blob = new Blob(Buffer.from("1234"));
  expect(await blob.text()).toBe("1234");
});

// https://github.com/oven-sh/bun/issues/13049
test("new File(new Uint8Array()) is supported", async () => {
  const blob = new File(Buffer.from("1234"), "file.txt");
  expect(await blob.text()).toBe("1234");
  expect(blob.name).toBe("file.txt");
});

test("new File('123', '123') is NOT supported", async () => {
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
    constructor(sources: Array<BinaryLike | Blob>, options?: BlobOptions) {
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
    constructor(sources: Array<BinaryLike | Blob>, options?: BlobOptions) {
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
    const p = ${JSON.stringify(path.join(String(dir), "data.txt"))};
    const type = "application/x-" + Buffer.alloc(64 * 1024, "a").toString();
    const file = Bun.file(p, { type });
    for (let i = 0; i < 100; i++) await file.text();
    Bun.gc(true);
    const before = process.memoryUsage.rss();
    for (let i = 0; i < 1024; i++) await file.text();
    Bun.gc(true);
    const after = process.memoryUsage.rss();
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
});
