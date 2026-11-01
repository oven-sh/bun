import { SavedProperties } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";

// The snapshot that `bun test --isolate=modules` restores globalThis from after each file, and that the DOM
// environments restore a package's classes from before each file's window.
describe("SavedProperties", () => {
  test("puts back what changed in a function, its prototype chain and an accessor", () => {
    class Parent {
      method() {
        return "parent";
      }
      get accessor() {
        return "parent";
      }
    }
    class Child extends Parent {}
    const root = { Child, object: { left: 1 } };
    const saved = new SavedProperties();
    saved.save(root, true);

    const { method } = Parent.prototype;
    Parent.prototype.method = () => "patched";
    Object.defineProperty(Parent.prototype, "accessor", { get: () => "patched", configurable: true });
    Parent.prototype.added = 1;
    delete Parent.prototype.constructor;
    Child.prototype.added = 1;
    Child.added = 1;
    root.object.left = 2;
    root.added = 1;
    Object.defineProperty(root, "Child", { value: Child, writable: false, enumerable: false, configurable: true });
    saved.restore();

    expect(Parent.prototype.method).toBe(method);
    expect(new Child().accessor).toBe("parent");
    expect(Parent.prototype.constructor).toBe(Parent);
    expect("added" in Parent.prototype).toBe(false);
    expect("added" in Child.prototype).toBe(false);
    expect("added" in Child).toBe(false);
    expect(root.object.left).toBe(1);
    expect("added" in root).toBe(false);
    expect(Object.getOwnPropertyDescriptor(root, "Child")).toEqual({
      value: Child,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  });

  test("does not descend into objects unless asked, except a prototype", () => {
    class Class {}
    const root = { object: { left: 1 }, Class };
    const saved = new SavedProperties();
    saved.save(root, false);
    root.object.left = 2;
    Class.prototype.added = 1;
    saved.restore();
    expect(root.object.left).toBe(2);
    expect("added" in Class.prototype).toBe(false);
  });

  test("leaves a sealed or frozen object as it is", () => {
    const sealed = { left: 1, fn() {} };
    const frozen = { left: 1, fn() {} };
    const saved = new SavedProperties();
    saved.save({ sealed, frozen }, true);
    sealed.left = 2;
    Object.seal(sealed);
    Object.freeze(frozen);
    saved.restore();
    expect(sealed).toEqual({ left: 2, fn: sealed.fn });
    expect(Object.isSealed(sealed)).toBe(true);
    expect(frozen).toEqual({ left: 1, fn: frozen.fn });
    expect(Object.isFrozen(frozen)).toBe(true);
  });

  test("a walk that throws keeps what it saved before", () => {
    class Before {}
    const saved = new SavedProperties();
    const trap = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("trap");
        },
      },
    );
    expect(() => saved.save({ Before, trap }, true)).toThrow("trap");
    Before.prototype.left = 1;
    saved.restore();
    expect("left" in Before.prototype).toBe(false);
  });

  test("does not descend into the global object", () => {
    const saved = new SavedProperties();
    saved.save({ global: globalThis, Class: class {} }, true);
    globalThis.leftByTheTest = 1;
    saved.restore();
    expect(globalThis.leftByTheTest).toBe(1);
    delete globalThis.leftByTheTest;
  });

  test("leaves alone what the filters name", () => {
    const root = { kept: 1, _internal: 1 };
    const saved = new SavedProperties((object, key) => typeof key !== "string" || !key.startsWith("_"));
    saved.save(root, false);
    root.kept = 2;
    root._internal = 2;
    root.added = 1;
    root._added = 1;
    saved.restore((object, key) => key === "added");
    expect(root).toEqual({ kept: 1, _internal: 2, added: 1, _added: 1 });
  });

  test("keepReachableFrom forgets what only the first root reached, and keeps the shared parent", () => {
    class Shared {
      method() {
        return "shared";
      }
    }
    class First extends Shared {}
    class Second extends Shared {}
    const saved = new SavedProperties();
    saved.save({ First }, true);
    First.prototype.left = 1;
    saved.keepReachableFrom({ Second }, true);
    expect("left" in First.prototype).toBe(false);

    const { method } = Shared.prototype;
    Shared.prototype.method = () => "patched";
    First.prototype.left = 1;
    Second.prototype.left = 1;
    saved.restore();
    expect(Shared.prototype.method).toBe(method);
    expect(First.prototype.left).toBe(1);
    expect(Second.prototype.left).toBe(1);
  });

  test("keepReachableFrom keeps the saved properties of an object that is not first in the list", () => {
    const objects = Array.from({ length: 20 }, (_, i) => ({ index: i, fn() {} }));
    const saved = new SavedProperties();
    saved.save(Object.fromEntries(objects.map((object, i) => [i, object])), true);
    for (const object of objects) object.index = -1;
    saved.keepReachableFrom({ last: objects[19] }, true);
    expect(objects[19].index).toBe(19);
    const { fn } = objects[19];
    objects[19].fn = () => {};
    objects[19].added = 1;
    objects[0].added = 1;
    saved.restore();
    expect(objects[19].fn).toBe(fn);
    expect("added" in objects[19]).toBe(false);
    expect(objects[0].added).toBe(1);
  });

  test("a later save adds what a new root reaches", () => {
    class A {}
    class B {}
    const saved = new SavedProperties();
    saved.save({ A }, false);
    saved.save({ B }, false);
    A.prototype.left = 1;
    B.prototype.left = 1;
    saved.restore();
    expect("left" in A.prototype).toBe(false);
    expect("left" in B.prototype).toBe(false);
  });
});
