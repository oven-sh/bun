import { SavedProperties } from "bun:internal-for-testing";
import { describe as describeValue } from "bun:jsc";
import { describe, expect, test } from "bun:test";

const everyKey = () => true;

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
    const saved = new SavedProperties(everyKey);
    saved.save(root);

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

  test("descends into the objects of the root and into a prototype, and into no other object", () => {
    class Class {}
    Class.object = { left: 1 };
    const root = { object: { left: 1 }, Class };
    const saved = new SavedProperties(everyKey);
    saved.save(root);
    root.object.left = 2;
    Class.object.left = 2;
    Class.prototype.added = 1;
    saved.restore();
    expect(root.object.left).toBe(1);
    expect(Class.object.left).toBe(2);
    expect("added" in Class.prototype).toBe(false);
  });

  test("leaves a sealed or frozen object as it is", () => {
    const sealed = { left: 1, fn() {} };
    const frozen = { left: 1, fn() {} };
    const saved = new SavedProperties(everyKey);
    saved.save({ sealed, frozen });
    sealed.left = 2;
    Object.seal(sealed);
    Object.freeze(frozen);
    saved.restore();
    expect(sealed).toEqual({ left: 2, fn: sealed.fn });
    expect(Object.isSealed(sealed)).toBe(true);
    expect(frozen).toEqual({ left: 1, fn: frozen.fn });
    expect(Object.isFrozen(frozen)).toBe(true);
  });

  test("a walk that throws keeps what was saved before it, and a later walk can save the same objects", () => {
    class Earlier {}
    class Before {}
    const saved = new SavedProperties(everyKey);
    saved.save({ Earlier });
    const trap = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("trap");
        },
      },
    );
    const root = { Before, trap };
    expect(() => saved.save(root)).toThrow("trap");
    Before.prototype.left = 1;
    Earlier.prototype.left = 1;
    root.added = 1;
    saved.restore();
    expect(Before.prototype.left).toBe(1);
    expect(root.added).toBe(1);
    expect("left" in Earlier.prototype).toBe(false);

    root.trap = 1;
    saved.save(root);
    delete Before.prototype.left;
    root.added = 2;
    saved.restore();
    expect(Before.prototype.left).toBe(1);
    expect(root.added).toBe(1);
  });

  test("save returns what it saved, and a set leaves those objects to the set that has them", () => {
    class Builtin {}
    class OfPackage extends Builtin {}
    const builtins = new SavedProperties(everyKey).save({ Builtin });
    expect(builtins.has(Builtin.prototype)).toBe(true);
    expect(builtins.has(OfPackage)).toBe(false);

    const saved = new SavedProperties(everyKey, builtins);
    saved.save({ OfPackage });
    Builtin.prototype.left = 1;
    OfPackage.prototype.left = 1;
    saved.restore();
    expect(Object.hasOwn(Builtin.prototype, "left")).toBe(true);
    expect(Object.hasOwn(OfPackage.prototype, "left")).toBe(false);
  });

  test("puts back the prototype of an object", () => {
    class Parent {}
    class Child extends Parent {}
    const saved = new SavedProperties(everyKey);
    saved.save({ Child });
    Object.setPrototypeOf(Child.prototype, { shim: true });
    Object.setPrototypeOf(Child, null);
    saved.restore();
    expect(Object.getPrototypeOf(Child.prototype)).toBe(Parent.prototype);
    expect(Object.getPrototypeOf(Child)).toBe(Parent);
  });

  // A delete makes JSC give up on the shape of an object. Property reads through it are not cached after that.
  test("an object that loses what many files added to it is not left a dictionary", () => {
    class Class {
      method() {}
    }
    const saved = new SavedProperties(everyKey);
    saved.save({ Class });
    for (let file = 0; file < 40; file++) {
      for (let i = 0; i < 20; i++) Class.prototype["added" + i] = i;
      saved.restore();
      expect(Object.keys(Class.prototype)).toEqual([]);
      expect(describeValue(Class.prototype)).not.toContain("Dictionary");
    }
    Class.prototype.method = () => "patched";
    saved.restore();
    expect(Class.prototype.method.name).toBe("method");
  });

  test("does not descend into the global object", () => {
    const saved = new SavedProperties(everyKey);
    saved.save({ global: globalThis, Class: class {} });
    globalThis.leftByTheTest = 1;
    try {
      saved.restore();
      expect(globalThis.leftByTheTest).toBe(1);
    } finally {
      delete globalThis.leftByTheTest;
    }
  });

  test("leaves alone what the filters name", () => {
    const root = { kept: 1, _internal: 1 };
    const saved = new SavedProperties((object, key) => typeof key !== "string" || !key.startsWith("_"));
    saved.save(root);
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
    const saved = new SavedProperties(everyKey);
    saved.save({ First });
    First.prototype.left = 1;
    saved.restore();
    saved.keepReachableFrom({ Second });
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
    const saved = new SavedProperties(everyKey);
    saved.save(Object.fromEntries(objects.map((object, i) => [i, object])));
    for (const object of objects) object.index = -1;
    saved.restore();
    saved.keepReachableFrom({ last: objects[19] });
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

  // Such as what a package writes when one window is closed and the next one is made.
  test("keepReachableFrom saves what changed since the save as it is now", () => {
    class Shared {}
    class First {}
    const saved = new SavedProperties(everyKey);
    saved.save({ Shared, First });
    Shared.current = "second";
    Object.setPrototypeOf(Shared.prototype, null);
    First.current = "second";
    saved.keepReachableFrom({ Shared });

    Shared.current = "third";
    Shared.added = 1;
    Object.setPrototypeOf(Shared.prototype, Object.prototype);
    First.added = 1;
    saved.restore();
    expect(Shared.current).toBe("second");
    expect("added" in Shared).toBe(false);
    expect(Object.getPrototypeOf(Shared.prototype)).toBe(null);
    expect({ current: First.current, added: First.added }).toEqual({ current: "second", added: 1 });
  });

  // Such as a count of open windows, which is saved while a window is open and has to be put back as with none.
  test("saveChanges saves what changed since the save as it is now", () => {
    class Shared {
      static open = 1;
      static untouched = 1;
    }
    const saved = new SavedProperties(everyKey);
    saved.save({ Shared });
    Shared.open = 0;
    Shared.closed = true;
    saved.saveChanges();
    saved.restore();
    expect({ open: Shared.open, closed: Shared.closed }).toEqual({ open: 0, closed: true });

    Shared.open = 1;
    Shared.untouched = 2;
    Shared.added = 1;
    delete Shared.closed;
    saved.restore();
    expect({ ...Shared }).toEqual({ open: 0, untouched: 1, closed: true });
  });
});
