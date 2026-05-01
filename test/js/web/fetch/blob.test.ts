import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
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
    // @ts-expect-error
    expect(blob.slice(Symbol(), "-123").size).toBe(6);
    expect(blob.slice(Object.create(null), "-123").size).toBe(6);
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

test("new Blob() survives a later part's toString() resizing an earlier ArrayBuffer", async () => {
  // The Blob constructor borrows ArrayBuffer backings into a StringJoiner and
  // only memcpys them at the end. It used to borrow before resolving later
  // parts' toString(), which can run arbitrary JS that resizes a resizable
  // ArrayBuffer and unmaps the already-borrowed backing → SEGV in done(). The
  // constructor now resolves every toString() in a first pass and only reads
  // buffer bytes in a second pass; a buffer that was resized during pass 1
  // contributes its post-resize length (0 here) rather than crashing.
  //
  // Run in a subprocess so an ASAN/SEGV crash surfaces as a test failure.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const size = 1 << 20;
        const ab = new ArrayBuffer(size, { maxByteLength: size });
        new Uint8Array(ab).fill("A".charCodeAt(0));
        const blob = new Blob([
          new Uint8Array(ab),
          {
            toString() {
              ab.resize(0);
              Bun.gc(true);
              return "B";
            },
          },
        ]);
        const text = await blob.text();
        console.log(JSON.stringify({ size: blob.size, text }));
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  // The resized-to-0 buffer contributes 0 bytes; only the toString() result
  // remains. (Spec says copy the original bytes; we trade that for avoiding a
  // 2× peak in the non-adversarial case.)
  expect(JSON.parse(stdout)).toEqual({ size: 1, text: "B" });
  expect(exitCode).toBe(0);
});

test("new Blob() survives a later part's toString() transferring an earlier ArrayBuffer", async () => {
  // Same as above but detach via transfer() instead of resize(). After
  // transfer(), the original view is detached and contributes 0 bytes; the
  // moved backing (even if overwritten) must not leak into the Blob.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const size = 1 << 20;
        const u8 = new Uint8Array(size).fill("A".charCodeAt(0));
        const blob = new Blob([
          u8,
          {
            toString() {
              const moved = u8.buffer.transfer();
              new Uint8Array(moved).fill("Z".charCodeAt(0));
              Bun.gc(true);
              return "B";
            },
          },
        ]);
        const text = await blob.text();
        console.log(JSON.stringify({ size: blob.size, text }));
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  // Previously this read the moved backing (Blob full of 'Z'); now the
  // detached view contributes 0 bytes.
  expect(JSON.parse(stdout)).toEqual({ size: 1, text: "B" });
  expect(exitCode).toBe(0);
});

test("new Blob() with a mix of ArrayBuffer and benign non-buffer parts borrows without copying", async () => {
  // The non-adversarial common case: mixing typed arrays with a plain string
  // part should not require duplicating the buffer bytes in memory. Verify
  // the join produces the right bytes and completes cleanly.
  const size = 1 << 16;
  const u8 = new Uint8Array(size).fill("A".charCodeAt(0));
  const blob = new Blob([u8, "B", new Uint8Array(8).fill("C".charCodeAt(0))]);
  const text = await blob.text();
  expect(blob.size).toBe(size + 1 + 8);
  expect(text.slice(0, size)).toBe(Buffer.alloc(size, "A").toString());
  expect(text.slice(size)).toBe("BCCCCCCCC");
});

test("new Blob() does not leak when a later part's toString() throws", async () => {
  // Pass 1 may have rooted large buffers in the MarkedArgumentBuffer and
  // allocated UTF-8 slices for earlier string parts before a later toString()
  // throws. None of that should be retained across iterations.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const size = 4 << 20;
        const u8 = new Uint8Array(size);
        const thrower = { toString() { throw new Error("nope"); } };
        for (let i = 0; i < 4; i++) {
          try { new Blob(["x".repeat(64), u8, thrower]); } catch {}
        }
        Bun.gc(true);
        const before = process.memoryUsage.rss();
        for (let i = 0; i < 128; i++) {
          try { new Blob(["x".repeat(64), u8, thrower]); } catch {}
        }
        Bun.gc(true);
        const after = process.memoryUsage.rss();
        console.log(JSON.stringify({ growthMB: (after - before) / (1 << 20) }));
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  const { growthMB } = JSON.parse(stdout);
  expect(growthMB).toBeLessThan(64);
  expect(exitCode).toBe(0);
});

test("new Blob() joins parts in sequence order", async () => {
  // The old single-pass implementation deferred plain-object parts to a LIFO
  // stack (reversing them relative to inline-handled siblings), broke out of
  // iteration on a nested array (dropping trailing parts), and double-
  // processed non-Blob DOM wrappers. The two-pass join resolves each part to
  // a string/buffer/Blob in iteration order.
  expect(await new Blob(["a", { toString: () => "B" }, "c"]).text()).toBe("aBc");
  expect(await new Blob([{ toString: () => "A" }, { toString: () => "B" }]).text()).toBe("AB");
  expect(await new Blob(["a", ["b", "c"], "d"]).text()).toBe("ab,cd");
  expect(await new Blob([new Response("body"), "X"]).text()).toBe("[object Response]X");
  // undefined/null are coerced via the USVString branch (WebIDL), not dropped.
  expect(await new Blob([undefined, null, "x"]).text()).toBe("undefinednullx");
});

test("new Blob() keeps inner Blob parts alive while a later part's toString() forces GC", async () => {
  // blob.sharedView() borrows store bytes without bumping its refcount. A
  // later toString() that drops the last JS reference to the inner Blob and
  // forces GC could free the store before joiner.done() memcpys from it. The
  // constructor roots each inner Blob in a MarkedArgumentBuffer for the
  // duration of the join so the borrowed view stays valid without an extra
  // copy of the bytes.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const size = 1 << 20;
        let inner = new Blob([new Uint8Array(size).fill("A".charCodeAt(0))]);
        const arr = [
          inner,
          {
            toString() {
              arr[0] = null;
              inner = null;
              Bun.gc(true);
              return "B";
            },
          },
        ];
        const blob = new Blob(arr);
        const text = await blob.text();
        console.log(JSON.stringify({
          size: blob.size,
          first: text.charCodeAt(0),
          allA: text.slice(0, size) === Buffer.alloc(size, "A").toString(),
        }));
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({
    size: (1 << 20) + 1,
    first: 65,
    allA: true,
  });
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
