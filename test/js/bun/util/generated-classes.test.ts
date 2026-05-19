// Coverage for the shared code paths in ZigGeneratedClasses.cpp that every
// generated class now routes through (Constructor::construct, ::call,
// Prototype::finishCreation, Constructor::finishCreation).
//
// Exercises each variant of the hoisted helpers:
// - plain construct (Blob)
// - construct with estimatedSize (Blob, Response)
// - constructNeedsThis (Request, Response)
// - call-without-new throws ERR_ILLEGAL_CONSTRUCTOR
// - Prototype finishCreation: @@symbol putDirect still applied
// - Constructor finishCreation: static methods on the constructor
// - subclassing picks the subclass structure
// - [Symbol.toStringTag] matches the class name

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { BlockList } from "node:net";
import { join } from "node:path";

// These code paths only run once per class at startup, so there is no runtime
// behavior to distinguish the hoisted form from the per-class form. Instead,
// assert on the codegen output itself: run generate-classes.ts into a temp
// directory and verify the shared helpers are emitted and the per-class
// construct bodies route through them instead of each open-coding the
// newTarget / createSubclassStructure / reifyStaticProperties sequence.
test("generate-classes.ts emits shared Constructor/Prototype helpers instead of per-class boilerplate", async () => {
  const repoRoot = join(import.meta.dir, "..", "..", "..", "..");
  const classesFiles = [...new Bun.Glob("src/**/*.classes.ts").scanSync({ cwd: repoRoot, absolute: true })].sort();
  expect(classesFiles.length).toBeGreaterThan(10);

  using out = tempDir("generated-classes-codegen", {});
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(repoRoot, "src", "codegen", "generate-classes.ts"), ...classesFiles, String(out)],
    env: { ...bunEnv, BUN_SILENT: "1" },
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);

  const cpp = await Bun.file(join(String(out), "ZigGeneratedClasses.cpp")).text();
  const count = (needle: string) => cpp.split(needle).length - 1;

  // Shared helpers are emitted once. Compare counts so failure output stays
  // readable (the file is ~3 MB).
  expect(count("constructGeneratedWrapper(")).toBeGreaterThan(0);
  expect(count("callGeneratedConstructorIllegal(")).toBeGreaterThan(0);
  expect(count("finishGeneratedPrototype(")).toBeGreaterThan(0);
  expect(count("finishGeneratedConstructor(")).toBeGreaterThan(0);

  // The subclass-structure resolution is now written once, not once per class.
  // Before this change it appeared once per constructible class (~47 copies).
  expect(count("InternalFunction::createSubclassStructure")).toBeLessThanOrEqual(2);

  // The ERR_ILLEGAL_CONSTRUCTOR throw body appears once in the shared helper,
  // not once per class (~45 copies before).
  expect(count("ErrorCode::ERR_ILLEGAL_CONSTRUCTOR")).toBeLessThanOrEqual(2);

  // reifyStaticProperties is routed through a single non-template wrapper
  // instead of being stamped into every finishCreation body (~100 copies before).
  expect(count("reifyStaticProperties(")).toBeLessThanOrEqual(2);
}, 60_000);

describe("generated class construction", () => {
  test("new + prototype methods + [Symbol.toStringTag]", () => {
    const b = new Blob(["hello"]);
    expect(b.size).toBe(5);
    expect(typeof b.text).toBe("function");
    expect(b[Symbol.toStringTag]).toBe("Blob");
    expect(Object.prototype.toString.call(b)).toBe("[object Blob]");
    expect(Blob.prototype[Symbol.toStringTag]).toBe("Blob");
  });

  test("subclass structure is used for `class X extends Foo`", () => {
    class MyBlob extends Blob {
      extra = 123;
    }
    const mb = new MyBlob(["abcdef"]);
    expect(mb).toBeInstanceOf(MyBlob);
    expect(mb).toBeInstanceOf(Blob);
    expect(mb.size).toBe(6);
    expect(mb.extra).toBe(123);
    expect(Object.getPrototypeOf(mb)).toBe(MyBlob.prototype);
  });

  test("calling without `new` throws ERR_ILLEGAL_CONSTRUCTOR with class name", () => {
    expect(() => (Blob as any)()).toThrow(
      expect.objectContaining({
        code: "ERR_ILLEGAL_CONSTRUCTOR",
        message: "Blob constructor cannot be invoked without 'new'",
      }),
    );
    expect(() => (Response as any)()).toThrow(
      expect.objectContaining({
        code: "ERR_ILLEGAL_CONSTRUCTOR",
        message: "Response constructor cannot be invoked without 'new'",
      }),
    );
  });

  test("constructNeedsThis: wrapper is created before Zig construct runs", () => {
    // Request/Response use constructNeedsThis: the JS wrapper is allocated
    // first and passed to Zig so headers/body can be attached to it.
    const req = new Request("http://example.com/path");
    expect(req.url).toBe("http://example.com/path");
    expect(req.method).toBe("GET");
    expect(req[Symbol.toStringTag]).toBe("Request");

    const res = new Response("body", { status: 201 });
    expect(res.status).toBe(201);
    expect(res[Symbol.toStringTag]).toBe("Response");
  });

  test("constructNeedsThis: subclassing", () => {
    class MyRequest extends Request {}
    const r = new MyRequest("http://example.com/");
    expect(r).toBeInstanceOf(MyRequest);
    expect(r).toBeInstanceOf(Request);
    expect(r.url).toBe("http://example.com/");
  });

  test("constructor hash table values survive finishCreation (static methods)", () => {
    // Response has static methods declared via `klass:` in response.classes.ts
    expect(typeof Response.json).toBe("function");
    expect(typeof Response.redirect).toBe("function");
    expect(typeof Response.error).toBe("function");
    const r = Response.json({ a: 1 });
    expect(r).toBeInstanceOf(Response);

    // BlockList has a static `isBlockList` on the constructor
    expect(typeof BlockList.isBlockList).toBe("function");
    expect(BlockList.isBlockList(new BlockList())).toBe(true);
    expect(BlockList.isBlockList({})).toBe(false);
  });

  test("constructor has `.prototype`", () => {
    expect(Blob.prototype).toBeDefined();
    const desc = Object.getOwnPropertyDescriptor(Blob, "prototype");
    expect(desc).toEqual({
      value: Blob.prototype,
      writable: false,
      enumerable: false,
      configurable: false,
    });
  });

  test("prototype @@symbol properties are still installed after finishGeneratedPrototype", () => {
    // Timeout declares @@dispose and @@toPrimitive in its proto:, which
    // generatePrototype emits as putDirect(vm.propertyNames->disposeSymbol, ...)
    // after finishGeneratedPrototype runs.
    const t = setTimeout(() => {}, 0);
    try {
      expect(typeof t[Symbol.dispose]).toBe("function");
      expect(typeof t[Symbol.toPrimitive]).toBe("function");
      const proto = Object.getPrototypeOf(t);
      expect(Object.getOwnPropertyDescriptor(proto, Symbol.dispose)).toBeDefined();
      expect(Object.getOwnPropertyDescriptor(proto, Symbol.toPrimitive)).toBeDefined();
    } finally {
      clearTimeout(t);
    }

    // AttributeIterator declares @@iterator in its proto:.
    let sawIterator = false;
    new HTMLRewriter()
      .on("a", {
        element(el) {
          const attrs = el.attributes;
          expect(typeof attrs[Symbol.iterator]).toBe("function");
          expect([...attrs]).toEqual([["href", "/"]]);
          sawIterator = true;
        },
      })
      .transform('<a href="/"></a>');
    expect(sawIterator).toBe(true);
  });

  test("exception from Zig construct propagates", () => {
    expect(() => new Request("")).toThrow();
    // @ts-expect-error
    expect(() => new Bun.Glob()).toThrow();
  });
});
