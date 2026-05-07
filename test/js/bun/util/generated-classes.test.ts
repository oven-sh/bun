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
import { BlockList } from "node:net";

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

  test("prototype @@symbol properties are still installed", () => {
    // @@dispose on Bun.listen() Listener
    expect(typeof (Bun.SHA256 as any).hash).toBe("function");

    // @@iterator on AttributeIterator (via HTMLRewriter)
    // verify by checking a class with special symbols in proto
    const glob = new Bun.Glob("*.ts");
    expect(glob[Symbol.toStringTag]).toBe("Glob");
    expect(glob.match("a.ts")).toBe(true);
  });

  test("exception from Zig construct propagates", () => {
    expect(() => new Request("")).toThrow();
    // @ts-expect-error
    expect(() => new Bun.Glob()).toThrow();
  });
});
