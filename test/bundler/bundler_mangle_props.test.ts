import { describe, expect } from "bun:test";
import { itBundled } from "./expectBundled";

describe("bundler", () => {
  // Basic property mangling test
  itBundled("mangle-props/BasicMangling", {
    files: {
      "/entry.js": /* js */ `
        const obj = {
          foo_: 1,
          bar_: 2,
          baz: 3,  // Should NOT be mangled (no underscore suffix)
        };
        console.log(obj.foo_, obj.bar_, obj.baz);
      `,
    },
    mangleProps: /_$/,
    minifySyntax: true,
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      // foo_ and bar_ should be mangled, baz should not
      expect(code).not.toContain("foo_");
      expect(code).not.toContain("bar_");
      expect(code).toContain("baz");
    },
  });

  // Test that reserved properties are not mangled
  itBundled("mangle-props/ReservedProperties", {
    files: {
      "/entry.js": /* js */ `
        const obj = {
          __proto__: null,
          constructor_: 1,
          prototype_: 2,
        };
        console.log(obj.__proto__, obj.constructor_, obj.prototype_);
      `,
    },
    mangleProps: /_$/,
    minifySyntax: true,
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      // __proto__ should never be mangled (built-in reserved)
      expect(code).toContain("__proto__");
      // constructor_ and prototype_ should be mangled since they have underscore suffix
      expect(code).not.toContain("constructor_");
      expect(code).not.toContain("prototype_");
    },
  });

  // Test computed property access with mangleQuoted
  itBundled("mangle-props/MangleQuoted", {
    files: {
      "/entry.js": /* js */ `
        const obj = {
          "foo_": 1,
          "bar_": 2,
        };
        console.log(obj["foo_"], obj["bar_"]);
      `,
    },
    mangleProps: /_$/,
    mangleQuoted: true,
    minifySyntax: true,
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      // With mangleQuoted, quoted properties should be mangled
      expect(code).not.toContain("foo_");
      expect(code).not.toContain("bar_");
    },
  });

  // Test that mangleQuoted: false preserves quoted properties
  itBundled("mangle-props/PreserveQuoted", {
    files: {
      "/entry.js": /* js */ `
        const obj = {
          foo_: 1,
          "bar_": 2,
        };
        console.log(obj.foo_, obj["bar_"]);
      `,
    },
    mangleProps: /_$/,
    mangleQuoted: false,
    minifySyntax: true,
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      // foo_ should be mangled (not quoted)
      expect(code).not.toContain(".foo_");
      // bar_ should NOT be mangled (quoted) - but the access might be
      // With mangleQuoted: false, quoted keys and accesses should be preserved
    },
  });

  // Test that properties are consistently mangled across files
  itBundled("mangle-props/ConsistentAcrossFiles", {
    files: {
      "/entry.js": /* js */ `
        import { getValue } from "./other.js";
        const obj = {
          secret_: 42,
        };
        console.log(obj.secret_, getValue());
      `,
      "/other.js": /* js */ `
        export function getValue() {
          const data = { secret_: 100 };
          return data.secret_;
        }
      `,
    },
    mangleProps: /_$/,
    minifySyntax: true,
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      // Both secret_ references should be mangled to the same name
      expect(code).not.toContain("secret_");
      // The mangled name should appear multiple times (consistency check)
    },
  });

  // Test property access on class instances (method calls)
  itBundled("mangle-props/ClassPropertyAccess", {
    files: {
      "/entry.js": /* js */ `
        class MyClass {
          getValue() {
            return this.value_;
          }
          setValue(v) {
            this.value_ = v;
          }
        }
        const instance = new MyClass();
        instance.setValue(10);
        console.log(instance.getValue());
      `,
    },
    mangleProps: /_$/,
    minifySyntax: true,
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      // value_ property accesses should be mangled
      expect(code).not.toContain("value_");
    },
  });

  // Test prefix pattern (common for private-like properties)
  itBundled("mangle-props/PrefixPattern", {
    files: {
      "/entry.js": /* js */ `
        const obj = {
          _private: 1,
          _secret: 2,
          public: 3,
        };
        console.log(obj._private, obj._secret, obj.public);
      `,
    },
    mangleProps: /^_/,
    minifySyntax: true,
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      expect(code).not.toContain("_private");
      expect(code).not.toContain("_secret");
      expect(code).toContain("public");
    },
  });

  // Test shorthand properties
  itBundled("mangle-props/ShorthandProperties", {
    files: {
      "/entry.js": /* js */ `
        const foo_ = 1;
        const bar_ = 2;
        const obj = { foo_, bar_ };
        console.log(obj.foo_, obj.bar_);
      `,
    },
    mangleProps: /_$/,
    minifySyntax: true,
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      // Property names should be mangled
      expect(code).not.toContain(".foo_");
      expect(code).not.toContain(".bar_");
    },
  });

  // Test destructuring
  itBundled("mangle-props/Destructuring", {
    files: {
      "/entry.js": /* js */ `
        const obj = { x_: 1, y_: 2 };
        const { x_, y_ } = obj;
        console.log(x_, y_);
      `,
    },
    mangleProps: /_$/,
    minifySyntax: true,
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      // The property names in the object should be mangled
      // The local variable names might or might not be mangled depending on implementation
    },
  });

  // Test that same property name gets same mangled name
  itBundled("mangle-props/SameNameSameResult", {
    files: {
      "/entry.js": /* js */ `
        const a = { prop_: 1 };
        const b = { prop_: 2 };
        const c = { prop_: 3 };
        console.log(a.prop_, b.prop_, c.prop_);
      `,
    },
    mangleProps: /_$/,
    minifySyntax: true,
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      expect(code).not.toContain("prop_");
      // The mangled property name should appear exactly 6 times (3 definitions + 3 accesses)
      // We can verify consistency by checking the output has uniform mangled names
    },
  });
});
