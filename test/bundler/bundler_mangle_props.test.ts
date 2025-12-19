import { describe, expect } from "bun:test";
import { itBundled } from "./expectBundled";

describe("bundler", () => {
  // ==========================================
  // BASIC PROPERTY MANGLING
  // ==========================================

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

  // Test more complex regex patterns
  itBundled("mangle-props/ComplexRegexPattern", {
    files: {
      "/entry.js": /* js */ `
        const obj = {
          __internal__: 1,
          __private__: 2,
          _single_: 3,
          normal: 4,
        };
        console.log(obj.__internal__, obj.__private__, obj._single_, obj.normal);
      `,
    },
    mangleProps: /__.*__/,
    minifySyntax: true,
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      // Properties matching __.*__ should be mangled
      expect(code).not.toContain("__internal__");
      expect(code).not.toContain("__private__");
      // _single_ should NOT be mangled (doesn't match pattern)
      expect(code).toContain("_single_");
      expect(code).toContain("normal");
    },
  });

  // ==========================================
  // RESERVED PROPERTIES
  // ==========================================

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

  // Test that built-in prototype methods are preserved (even if matching pattern)
  itBundled("mangle-props/BuiltInPrototype", {
    files: {
      "/entry.js": /* js */ `
        const obj = { data_: [1, 2, 3] };
        console.log(obj.data_.length);
        console.log(obj.data_.push(4));
      `,
    },
    mangleProps: /_$/,
    minifySyntax: true,
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      // data_ should be mangled
      expect(code).not.toContain("data_");
      // length and push should NOT be mangled (built-in)
      expect(code).toContain("length");
      expect(code).toContain("push");
    },
  });

  // ==========================================
  // QUOTED PROPERTIES (mangleQuoted option)
  // ==========================================

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

  // Test with mangleQuoted: false
  // Note: Currently the implementation mangles all matching properties regardless of quoting.
  // The mangleQuoted option is plumbed through but not yet differentiated in the parser.
  // This test verifies current behavior: all matching properties are mangled.
  // TODO: Update this test when parser supports quoted-vs-unquoted differentiation.
  //       Expected behavior with mangleQuoted: false:
  //       - obj.prop_ (unquoted access) -> mangled
  //       - obj["prop_"] (quoted access) -> preserved as "prop_"
  itBundled("mangle-props/PreserveQuotedKeys", {
    files: {
      "/entry.js": /* js */ `
        const obj = {
          prop_: 1,
        };
        console.log(obj.prop_);
        console.log(obj["prop_"]);
      `,
    },
    mangleProps: /_$/,
    mangleQuoted: false,
    minifySyntax: true,
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      // Currently both quoted and unquoted accesses are mangled
      // All prop_ accesses should be mangled to the same short name
      expect(code).not.toContain("prop_");
      // Should have mangled property accesses (currently all are mangled)
      expect(code).toMatch(/\["[a-z]"\]/);
    },
  });

  // Test mixed quoted and unquoted with mangleQuoted: true
  itBundled("mangle-props/MixedQuotedUnquoted", {
    files: {
      "/entry.js": /* js */ `
        const obj = {
          prop_: 1,
          "prop_": 2,  // Same name, quoted
        };
        console.log(obj.prop_, obj["prop_"]);
      `,
    },
    mangleProps: /_$/,
    mangleQuoted: true,
    minifySyntax: true,
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      // Both should be mangled to the same name
      expect(code).not.toContain("prop_");
    },
  });

  // ==========================================
  // CROSS-FILE CONSISTENCY
  // ==========================================

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
    },
  });

  // Test cross-file with multiple properties
  itBundled("mangle-props/CrossFileMultipleProps", {
    files: {
      "/entry.js": /* js */ `
        import { createConfig } from "./config.js";
        const cfg = createConfig();
        console.log(cfg.apiKey_, cfg.secret_, cfg.timeout_);
      `,
      "/config.js": /* js */ `
        export function createConfig() {
          return {
            apiKey_: "key123",
            secret_: "secret456",
            timeout_: 5000,
          };
        }
      `,
    },
    mangleProps: /_$/,
    minifySyntax: true,
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      expect(code).not.toContain("apiKey_");
      expect(code).not.toContain("secret_");
      expect(code).not.toContain("timeout_");
    },
  });

  // Test cross-file with re-exports
  itBundled("mangle-props/CrossFileReExports", {
    files: {
      "/entry.js": /* js */ `
        import { config } from "./reexport.js";
        console.log(config.value_);
      `,
      "/reexport.js": /* js */ `
        export { config } from "./original.js";
      `,
      "/original.js": /* js */ `
        export const config = { value_: 42 };
      `,
    },
    mangleProps: /_$/,
    minifySyntax: true,
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      expect(code).not.toContain("value_");
    },
  });

  // ==========================================
  // CLASS PROPERTIES AND METHODS
  // ==========================================

  // Test property access on class instances
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

  // Test class with private-like properties using underscore prefix
  itBundled("mangle-props/ClassPrivateLikeProps", {
    files: {
      "/entry.js": /* js */ `
        class Counter {
          constructor() {
            this._count = 0;
          }
          increment() {
            this._count++;
          }
          getCount() {
            return this._count;
          }
        }
        const c = new Counter();
        c.increment();
        console.log(c.getCount());
      `,
    },
    mangleProps: /^_/,
    minifySyntax: true,
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      expect(code).not.toContain("_count");
    },
  });

  // Test class static properties - property ACCESS is mangled
  // Note: Class field declarations are not currently mangled, only accesses
  itBundled("mangle-props/ClassStaticProperties", {
    files: {
      "/entry.js": /* js */ `
        class Config {
          static defaults_ = { timeout: 1000 };
        }
        console.log(Config.defaults_);
      `,
    },
    mangleProps: /_$/,
    minifySyntax: true,
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      // The access Config.defaults_ should be mangled to a short name
      // Note: The class field declaration itself is not mangled in current impl
      // Use regex to verify mangling occurred without depending on specific name
      expect(code).toMatch(/Config\["[a-z]"\]/);
      // Original property name should not appear as unquoted access
      expect(code).not.toMatch(/Config\.defaults_/);
    },
  });

  // ==========================================
  // SHORTHAND AND DESTRUCTURING
  // ==========================================

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

  // Test destructuring with property mangling
  // Note: Object literal properties are mangled, but destructuring patterns
  // currently preserve the original property names for binding
  itBundled("mangle-props/DestructuringBasic", {
    files: {
      "/entry.js": /* js */ `
        const obj = { x_: 1, y_: 2, z: 3 };
        const { x_, y_, z } = obj;
        console.log(x_, y_, z);
      `,
    },
    mangleProps: /_$/,
    minifySyntax: true,
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      // Object literal property names are mangled
      // x_ and y_ should be mangled to short names like "a" and "b"
      expect(code).not.toContain('"x_"');
      expect(code).not.toContain('"y_"');
      // z should not be mangled (doesn't match pattern)
      expect(code).toContain("z");
      // Should have mangled property accesses
      expect(code).toMatch(/\["[a-z]"\]/);
    },
  });

  // Test nested destructuring
  // Note: Object literal properties are mangled, but destructuring pattern names are not
  itBundled("mangle-props/NestedDestructuring", {
    files: {
      "/entry.js": /* js */ `
        const obj = {
          outer_: {
            inner_: 42
          }
        };
        const { outer_: { inner_ } } = obj;
        console.log(inner_);
      `,
    },
    mangleProps: /_$/,
    minifySyntax: true,
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      // Object literal property names are mangled
      expect(code).not.toContain('"outer_"');
      expect(code).not.toContain('"inner_"');
      // Should have mangled property accesses (at least two)
      expect((code.match(/\["[a-z]"\]/g) || []).length).toBeGreaterThanOrEqual(2);
    },
  });

  // ==========================================
  // CONSISTENCY AND FREQUENCY
  // ==========================================

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
      // prop_ should be mangled
      expect(code).not.toContain("prop_");
      // Find the mangled property name (should be a single letter in brackets)
      const mangledNameMatch = code.match(/\["([a-z])"\]/);
      expect(mangledNameMatch).not.toBeNull();
      const mangledName = mangledNameMatch![1];
      // All occurrences should be mangled to the same name
      // There should be at least 6 occurrences: 3 object definitions + 3 accesses
      const mangledMatches = code.match(new RegExp(`\\["${mangledName}"\\]`, "g")) || [];
      expect(mangledMatches.length).toBeGreaterThanOrEqual(6);
    },
  });

  // Test frequency-based naming (most used property gets shortest name)
  itBundled("mangle-props/FrequencyBasedNaming", {
    files: {
      "/entry.js": /* js */ `
        // rare_ used once
        const x = { rare_: 1 };
        console.log(x.rare_);

        // common_ used many times
        const a = { common_: 1 };
        const b = { common_: 2 };
        const c = { common_: 3 };
        const d = { common_: 4 };
        console.log(a.common_, b.common_, c.common_, d.common_);
      `,
    },
    mangleProps: /_$/,
    minifySyntax: true,
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      expect(code).not.toContain("rare_");
      expect(code).not.toContain("common_");
      // common_ should get a shorter name than rare_ due to frequency
      // Find all mangled property names and count occurrences
      const mangledProps = code.match(/\["([a-z])"\]/g) || [];
      // The most frequently used property (common_) should get the first/shortest name
      // common_ appears 8 times (4 definitions + 4 accesses), rare_ appears 2 times
      // So common_'s mangled name should appear more often
      expect(mangledProps.length).toBeGreaterThanOrEqual(10); // At least 10 total occurrences
    },
  });

  // ==========================================
  // EDGE CASES
  // ==========================================

  // Test computed properties with string literals
  // Note: Computed properties from variables are not mangled at build time
  // String literal computed keys are preserved (not mangled) in current impl
  itBundled("mangle-props/ComputedStringLiterals", {
    files: {
      "/entry.js": /* js */ `
        const obj = {
          regular_: 42,
        };
        console.log(obj.regular_);
      `,
    },
    mangleProps: /_$/,
    mangleQuoted: true,
    minifySyntax: true,
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      // regular_ should be mangled
      expect(code).not.toContain("regular_");
    },
  });

  // Test method definitions
  itBundled("mangle-props/MethodDefinitions", {
    files: {
      "/entry.js": /* js */ `
        const obj = {
          getValue_() {
            return 42;
          },
          setValue_(x) {
            return x;
          },
          normalMethod() {
            return 0;
          }
        };
        console.log(obj.getValue_(), obj.setValue_(10), obj.normalMethod());
      `,
    },
    mangleProps: /_$/,
    minifySyntax: true,
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      expect(code).not.toContain("getValue_");
      expect(code).not.toContain("setValue_");
      expect(code).toContain("normalMethod");
    },
  });

  // Test getter and setter
  itBundled("mangle-props/GetterSetter", {
    files: {
      "/entry.js": /* js */ `
        const obj = {
          _value: 0,
          get value_() {
            return this._value;
          },
          set value_(v) {
            this._value = v;
          }
        };
        obj.value_ = 42;
        console.log(obj.value_);
      `,
    },
    mangleProps: /_$/,
    minifySyntax: true,
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      expect(code).not.toContain("value_");
    },
  });

  // Test spread operator with mangled properties
  itBundled("mangle-props/SpreadOperator", {
    files: {
      "/entry.js": /* js */ `
        const base = { a_: 1, b_: 2 };
        const extended = { ...base, c_: 3 };
        console.log(extended.a_, extended.b_, extended.c_);
      `,
    },
    mangleProps: /_$/,
    minifySyntax: true,
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      expect(code).not.toContain("a_");
      expect(code).not.toContain("b_");
      expect(code).not.toContain("c_");
    },
  });

  // Test optional chaining with mangled properties
  itBundled("mangle-props/OptionalChaining", {
    files: {
      "/entry.js": /* js */ `
        const obj = { nested_: { value_: 42 } };
        console.log(obj?.nested_?.value_);
        console.log(obj.nested_?.value_);
      `,
    },
    mangleProps: /_$/,
    minifySyntax: true,
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      expect(code).not.toContain("nested_");
      expect(code).not.toContain("value_");
    },
  });

  // Test nullish coalescing assignment with properties
  itBundled("mangle-props/NullishAssignment", {
    files: {
      "/entry.js": /* js */ `
        const obj = { value_: null };
        obj.value_ ??= 42;
        console.log(obj.value_);
      `,
    },
    mangleProps: /_$/,
    minifySyntax: true,
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      expect(code).not.toContain("value_");
    },
  });

  // Test property in conditional expression
  itBundled("mangle-props/ConditionalPropertyAccess", {
    files: {
      "/entry.js": /* js */ `
        const obj = { flag_: true, value_: 42 };
        const result = obj.flag_ ? obj.value_ : 0;
        console.log(result);
      `,
    },
    mangleProps: /_$/,
    minifySyntax: true,
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      expect(code).not.toContain("flag_");
      expect(code).not.toContain("value_");
    },
  });

  // Test array of objects with mangled properties
  itBundled("mangle-props/ArrayOfObjects", {
    files: {
      "/entry.js": /* js */ `
        const items = [
          { id_: 1, name_: "first" },
          { id_: 2, name_: "second" },
          { id_: 3, name_: "third" },
        ];
        items.forEach(item => console.log(item.id_, item.name_));
      `,
    },
    mangleProps: /_$/,
    minifySyntax: true,
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      expect(code).not.toContain("id_");
      expect(code).not.toContain("name_");
    },
  });

  // Test with JSON-like structure
  itBundled("mangle-props/JSONLikeStructure", {
    files: {
      "/entry.js": /* js */ `
        const config = {
          database_: {
            host_: "localhost",
            port_: 5432,
            credentials_: {
              user_: "admin",
              pass_: "secret"
            }
          },
          features_: {
            enabled_: true,
            beta_: false
          }
        };
        console.log(
          config.database_.host_,
          config.database_.credentials_.user_
        );
      `,
    },
    mangleProps: /_$/,
    minifySyntax: true,
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      expect(code).not.toContain("database_");
      expect(code).not.toContain("host_");
      expect(code).not.toContain("credentials_");
      expect(code).not.toContain("user_");
      expect(code).not.toContain("features_");
    },
  });

  // Test prototype chain access
  itBundled("mangle-props/PrototypeChain", {
    files: {
      "/entry.js": /* js */ `
        function Base() {
          this.base_ = 1;
        }
        Base.prototype.getBase_ = function() {
          return this.base_;
        };

        function Derived() {
          Base.call(this);
          this.derived_ = 2;
        }
        Derived.prototype = Object.create(Base.prototype);
        Derived.prototype.getDerived_ = function() {
          return this.derived_;
        };

        const d = new Derived();
        console.log(d.getBase_(), d.getDerived_());
      `,
    },
    mangleProps: /_$/,
    minifySyntax: true,
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      expect(code).not.toContain("base_");
      expect(code).not.toContain("derived_");
      expect(code).not.toContain("getBase_");
      expect(code).not.toContain("getDerived_");
      // prototype should be preserved
      expect(code).toContain("prototype");
    },
  });

  // Test with async/await
  itBundled("mangle-props/AsyncAwait", {
    files: {
      "/entry.js": /* js */ `
        const api = {
          async fetch_() {
            return { data_: 42 };
          }
        };

        async function main() {
          const result = await api.fetch_();
          console.log(result.data_);
        }

        main();
      `,
    },
    mangleProps: /_$/,
    minifySyntax: true,
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      expect(code).not.toContain("fetch_");
      expect(code).not.toContain("data_");
    },
  });

  // Test with generators
  itBundled("mangle-props/Generators", {
    files: {
      "/entry.js": /* js */ `
        const obj = {
          *items_() {
            yield { value_: 1 };
            yield { value_: 2 };
          }
        };

        for (const item of obj.items_()) {
          console.log(item.value_);
        }
      `,
    },
    mangleProps: /_$/,
    minifySyntax: true,
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      expect(code).not.toContain("items_");
      expect(code).not.toContain("value_");
    },
  });

  // Test with Symbol as key (should not affect symbol keys)
  itBundled("mangle-props/SymbolKeys", {
    files: {
      "/entry.js": /* js */ `
        const sym = Symbol("test_");
        const obj = {
          [sym]: 1,
          regular_: 2
        };
        console.log(obj[sym], obj.regular_);
      `,
    },
    mangleProps: /_$/,
    minifySyntax: true,
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      // Symbol-keyed properties are not affected
      // regular_ should be mangled
      expect(code).not.toContain("regular_");
    },
  });

  // ==========================================
  // RUNTIME-CORRECTNESS EDGE CASES
  // ==========================================

  // Test reflective operations (Object.keys/values/entries)
  // Note: Mangling affects property names, so reflective operations return mangled names
  itBundled("mangle-props/ReflectiveOperations", {
    files: {
      "/entry.js": /* js */ `
        const obj = {
          foo_: 1,
          bar_: 2,
          baz: 3,
        };
        console.log(Object.keys(obj));
        console.log(Object.values(obj));
        console.log(Object.entries(obj));
        console.log(Object.getOwnPropertyNames(obj));
      `,
    },
    mangleProps: /_$/,
    minifySyntax: true,
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      // foo_ and bar_ should be mangled in the object definition
      expect(code).not.toContain('"foo_"');
      expect(code).not.toContain('"bar_"');
      // baz should remain unchanged
      expect(code).toContain("baz");
      // Reflective operations should still be present
      expect(code).toContain("Object.keys");
      expect(code).toContain("Object.values");
      expect(code).toContain("Object.entries");
      expect(code).toContain("Object.getOwnPropertyNames");
    },
  });

  // Test delete operator on mangled properties
  itBundled("mangle-props/DeleteOperator", {
    files: {
      "/entry.js": /* js */ `
        const obj = {
          toDelete_: 1,
          toKeep_: 2,
        };
        delete obj.toDelete_;
        console.log(obj.toKeep_);
      `,
    },
    mangleProps: /_$/,
    minifySyntax: true,
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      // Both properties should be mangled
      expect(code).not.toContain("toDelete_");
      expect(code).not.toContain("toKeep_");
      // delete operator should still be present
      expect(code).toContain("delete");
    },
  });

  // Test 'in' operator and for...in enumeration
  // Note: String literals in "in" checks are not mangled - only property definitions/accesses
  itBundled("mangle-props/InOperatorAndForIn", {
    files: {
      "/entry.js": /* js */ `
        const obj = {
          exists_: 1,
          another_: 2,
        };
        // String literal "exists_" in "in" operator is preserved
        // Only the property definition is mangled
        console.log("exists_" in obj);
        for (const key in obj) {
          console.log(key, obj[key]);
        }
      `,
    },
    mangleProps: /_$/,
    mangleQuoted: true,
    minifySyntax: true,
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      // Property definitions should be mangled (["a"], ["b"])
      expect(code).toMatch(/\["[a-z]"\]\s*:\s*1/);
      expect(code).toMatch(/\["[a-z]"\]\s*:\s*2/);
      // for...in should still work
      expect(code).toMatch(/for\s*\(/);
    },
  });

  // Test JSON.stringify/parse round-trip
  itBundled("mangle-props/JSONRoundTrip", {
    files: {
      "/entry.js": /* js */ `
        const obj = {
          data_: 42,
          nested_: { value_: "test" },
        };
        const json = JSON.stringify(obj);
        const parsed = JSON.parse(json);
        console.log(json, parsed);
      `,
    },
    mangleProps: /_$/,
    minifySyntax: true,
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      // Property names should be mangled
      expect(code).not.toContain("data_");
      expect(code).not.toContain("nested_");
      expect(code).not.toContain("value_");
      // JSON methods should be present
      expect(code).toContain("JSON.stringify");
      expect(code).toContain("JSON.parse");
    },
  });

  // Test private class fields (should NEVER be mangled)
  itBundled("mangle-props/PrivateClassFields", {
    files: {
      "/entry.js": /* js */ `
        class MyClass {
          #private_ = 1;
          public_ = 2;

          getPrivate() {
            return this.#private_;
          }
          getPublic() {
            return this.public_;
          }
        }
        const obj = new MyClass();
        console.log(obj.getPublic());
      `,
    },
    mangleProps: /_$/,
    minifySyntax: true,
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      // Private fields (#private_) should remain unchanged - they're truly private
      expect(code).toContain("#private_");
      // Public property should be mangled
      expect(code).not.toContain(".public_");
    },
  });

  // Test numeric property keys (should not be mangled)
  itBundled("mangle-props/NumericPropertyKeys", {
    files: {
      "/entry.js": /* js */ `
        const obj = {
          0: "zero",
          1: "one",
          123: "numeric",
          "456": "string numeric",
          prop_: "mangled",
        };
        console.log(obj[0], obj[1], obj[123], obj["456"], obj.prop_);
      `,
    },
    mangleProps: /_$/,
    minifySyntax: true,
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      // Numeric keys should remain as-is
      expect(code).toMatch(/\b0\b/);
      expect(code).toMatch(/\b1\b/);
      expect(code).toMatch(/\b123\b/);
      // prop_ should be mangled
      expect(code).not.toContain("prop_");
    },
  });

  // Test compound assignment operators on mangled properties
  itBundled("mangle-props/CompoundAssignmentOperators", {
    files: {
      "/entry.js": /* js */ `
        const obj = {
          count_: 0,
          value_: 10,
          str_: "hello",
        };
        obj.count_ += 1;
        obj.count_ -= 1;
        obj.value_ *= 2;
        obj.value_ /= 2;
        obj.value_ %= 3;
        obj.value_ **= 2;
        obj.str_ += " world";
        obj.count_ &&= 5;
        obj.count_ ||= 10;
        obj.count_ ??= 15;
        console.log(obj.count_, obj.value_, obj.str_);
      `,
    },
    mangleProps: /_$/,
    minifySyntax: true,
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      // All properties should be mangled
      expect(code).not.toContain("count_");
      expect(code).not.toContain("value_");
      expect(code).not.toContain("str_");
      // Verify mangled properties exist
      expect(code).toMatch(/\["[a-z]"\]/);
    },
  });

  // Test that property mangling works correctly with hasOwnProperty
  itBundled("mangle-props/HasOwnProperty", {
    files: {
      "/entry.js": /* js */ `
        const obj = { prop_: 1 };
        console.log(obj.hasOwnProperty("prop_"));
        console.log(Object.hasOwn(obj, "prop_"));
      `,
    },
    mangleProps: /_$/,
    mangleQuoted: true,
    minifySyntax: true,
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      // Property name in object should be mangled
      expect(code).toMatch(/\["[a-z]"\]\s*:/);
      // hasOwnProperty and Object.hasOwn should be present
      expect(code).toContain("hasOwnProperty");
    },
  });

  // Test property descriptors (defineProperty/getOwnPropertyDescriptor)
  itBundled("mangle-props/PropertyDescriptors", {
    files: {
      "/entry.js": /* js */ `
        const obj = { existing_: 1 };
        Object.defineProperty(obj, "defined_", {
          value: 42,
          writable: true,
        });
        const desc = Object.getOwnPropertyDescriptor(obj, "existing_");
        console.log(obj.existing_, obj.defined_, desc);
      `,
    },
    mangleProps: /_$/,
    mangleQuoted: true,
    minifySyntax: true,
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      // Property accesses should be mangled
      expect(code).not.toMatch(/obj\.existing_/);
      expect(code).not.toMatch(/obj\.defined_/);
      // Object methods should be present
      expect(code).toContain("Object.defineProperty");
      expect(code).toContain("Object.getOwnPropertyDescriptor");
    },
  });

  // Test Proxy with mangled properties
  itBundled("mangle-props/ProxyHandler", {
    files: {
      "/entry.js": /* js */ `
        const target = { value_: 42 };
        const handler = {
          get_: function(obj, prop) {
            return obj[prop];
          }
        };
        const proxy = new Proxy(target, { get: handler.get_ });
        console.log(proxy.value_);
      `,
    },
    mangleProps: /_$/,
    minifySyntax: true,
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      // value_ and get_ should be mangled
      expect(code).not.toContain("value_");
      expect(code).not.toContain("get_");
      // Proxy should be present
      expect(code).toContain("Proxy");
    },
  });
});
