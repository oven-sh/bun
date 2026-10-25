import { describe, expect } from "bun:test";
import { itBundled } from "./expectBundled";

describe("bundler", () => {
  describe("minify/Symbol.for", () => {
    // Test basic Symbol.for removal when unused
    itBundled("minify/SymbolForUnused", {
      files: {
        "/entry.js": /* js */ `
          // These should be removed when minifySyntax is true
          Symbol.for("test1");
          Symbol.for("test2");
          Symbol.for(\`test3\`);
          Symbol.for("test" + 4); // This has a side effect (string concatenation)
          
          // Keep reference to prove concatenation happened
          var sideEffect = "test" + 4;
          Symbol.for(sideEffect);
          
          // These should NOT be removed (used values)
          const s1 = Symbol.for("used1");
          let s2 = Symbol.for("used2");
          var s3 = Symbol.for("used3");
          
          // Function argument - should not be removed
          console.log(Symbol.for("argument"));
          
          // Property access - should not be removed
          const obj = { prop: Symbol.for("property") };
          
          // Return value - should not be removed
          function getSymbol() {
            return Symbol.for("return");
          }
          
          capture(s1, s2, s3, obj.prop, getSymbol(), sideEffect);
        `,
      },
      minifySyntax: true,
      onAfterBundle(api) {
        const output = api.readFile("/out.js");

        // Should remove unused Symbol.for calls
        expect(output).not.toContain('Symbol.for("test1")');
        expect(output).not.toContain('Symbol.for("test2")');
        expect(output).not.toContain("Symbol.for(`test3`)");

        // Should keep the concatenation because sideEffect variable is used
        expect(output).toContain("test4");

        // Should keep used Symbol.for calls
        expect(output).toContain('Symbol.for("used1")');
        expect(output).toContain('Symbol.for("used2")');
        expect(output).toContain('Symbol.for("used3")');
        expect(output).toContain('Symbol.for("argument")');
        expect(output).toContain('Symbol.for("property")');
        expect(output).toContain('Symbol.for("return")');
      },
    });

    // Test that Symbol.for is not removed when minifySyntax is false
    itBundled("minify/SymbolForNoMinifySyntax", {
      files: {
        "/entry.js": /* js */ `
          Symbol.for("test1");
          Symbol.for("test2");
          const s = Symbol.for("test3");
          capture(s);
        `,
      },
      minifySyntax: false,
      onAfterBundle(api) {
        const output = api.readFile("/out.js");

        // Should keep all Symbol.for calls when minifySyntax is false
        expect(output).toContain('Symbol.for("test1")');
        expect(output).toContain('Symbol.for("test2")');
        expect(output).toContain('Symbol.for("test3")');
      },
    });

    // Test interaction with other minification options
    itBundled("minify/SymbolForWithWhitespace", {
      files: {
        "/entry.js": /* js */ `
          // Unused calls should be removed
          Symbol.for("remove-me-1");
          Symbol.for("remove-me-2");
          
          // Used call should remain
          const sym = Symbol.for("keep-me");
          
          // Test with complex expressions
          const ab = "a" + "b";
          Symbol.for(ab); // Keep the variable to ensure concatenation happens
          Symbol.for(\`template\`);
          
          capture(sym, ab);
        `,
      },
      minifySyntax: true,
      minifyWhitespace: true,
      onAfterBundle(api) {
        const output = api.readFile("/out.js");

        // Should remove unused calls
        expect(output).not.toContain("remove-me-1");
        expect(output).not.toContain("remove-me-2");

        // Should keep used call
        expect(output).toContain('Symbol.for("keep-me")');

        // Should keep side effect (the concatenation is kept because ab is used)
        expect(output).toContain("ab");
      },
    });

    // Test edge cases
    itBundled("minify/SymbolForEdgeCases", {
      files: {
        "/entry.js": /* js */ `
          // Optional chaining - these are preserved because optional chaining has observable behavior
          Symbol?.for("optional1");
          Symbol?.for?.("optional2");
          
          // In conditional - these should be optimized based on the condition
          true && Symbol.for("conditional1");
          false || Symbol.for("conditional2");
          
          // In ternary - these should be optimized based on the condition
          true ? Symbol.for("ternary1") : null;
          false ? null : Symbol.for("ternary2");
          
          // Nested calls
          Symbol.for(Symbol.for("nested"));
          
          // With spread
          const arr = [...[Symbol.for("spread")]];
          
          // Property key
          const obj = {
            [Symbol.for("key")]: "value"
          };
          
          capture(arr, obj);
        `,
      },
      minifySyntax: true,
      onAfterBundle(api) {
        const output = api.readFile("/out.js");

        // Optional chaining preserves the call because it has observable behavior (checking if Symbol exists)
        expect(output).toContain("optional1");
        expect(output).toContain("optional2");

        // All the conditional/ternary expressions were optimized away completely
        // because they evaluate to unused Symbol.for calls
        expect(output).not.toContain("conditional1");
        expect(output).not.toContain("conditional2");
        expect(output).not.toContain("ternary1");
        expect(output).not.toContain("ternary2");

        // Nested call was also optimized away
        expect(output).not.toContain("nested");

        // Used in spread - should keep
        expect(output).toContain('Symbol.for("spread")');

        // Used as property key - should keep
        expect(output).toContain('Symbol.for("key")');
      },
    });

    // Test that Symbol.keyFor is not affected (it's still in the property access list)
    itBundled("minify/SymbolKeyForNotAffected", {
      files: {
        "/entry.js": /* js */ `
          // Symbol.keyFor should still be removed as a property access
          Symbol.keyFor;
          
          // But not when called
          const sym = Symbol.for("test");
          const key = Symbol.keyFor(sym);
          
          capture(key);
        `,
      },
      minifySyntax: true,
      onAfterBundle(api) {
        const output = api.readFile("/out.js");

        // The unused property access "Symbol.keyFor;" should be removed
        // But the function call "Symbol.keyFor(sym)" should remain
        // So we should find exactly one occurrence of "Symbol.keyFor"
        const keyForMatches = output.match(/Symbol\.keyFor/g) || [];
        expect(keyForMatches.length).toBe(1);

        // Function call should remain
        expect(output).toContain("Symbol.keyFor(");
      },
    });

    // Test interaction with production mode
    itBundled("minify/SymbolForProduction", {
      files: {
        "/entry.js": /* js */ `
          // Unused
          Symbol.for("remove-in-prod");
          
          // Used
          const s = Symbol.for("keep-in-prod");
          
          // Side effects
          Symbol.for(someGlobal);
          
          capture(s);
        `,
      },
      production: true, // This enables minifySyntax
      onAfterBundle(api) {
        const output = api.readFile("/out.js");

        // Should remove unused
        expect(output).not.toContain("remove-in-prod");

        // Should keep used
        expect(output).toContain("keep-in-prod");

        // Should keep side effects
        expect(output).toContain("someGlobal");
      },
    });

    // Test with bundling disabled (transform mode)
    itBundled("minify/SymbolForTransformMode", {
      files: {
        "/entry.js": /* js */ `
          Symbol.for("unused");
          const used = Symbol.for("used");
          export { used };
        `,
      },
      bundling: false,
      minifySyntax: true,
      onAfterBundle(api) {
        const output = api.readFile("/out.js");

        // Should remove unused in transform mode too
        expect(output).not.toContain('"unused"');

        // Should keep used
        expect(output).toContain('Symbol.for("used")');
      },
    });

    // Test interaction with tree shaking
    itBundled("minify/SymbolForTreeShaking", {
      files: {
        "/entry.js": /* js */ `
          import { sym } from "./lib.js";
          
          // This should be removed
          Symbol.for("entry-unused");
          
          capture(sym);
        `,
        "/lib.js": /* js */ `
          // This should be removed (unused export)
          export const unused = Symbol.for("lib-unused-export");
          
          // This should be kept (used export)
          export const sym = Symbol.for("lib-used-export");
          
          // This should be removed (not exported)
          Symbol.for("lib-internal");
        `,
      },
      minifySyntax: true,
      treeShaking: true,
      onAfterBundle(api) {
        const output = api.readFile("/out.js");

        // Should remove all unused Symbol.for calls
        expect(output).not.toContain("entry-unused");
        expect(output).not.toContain("lib-unused-export");
        expect(output).not.toContain("lib-internal");

        // Should keep used Symbol.for call
        expect(output).toContain("lib-used-export");
      },
    });

    // Test that Symbol.for is still called at runtime when overridden
    itBundled("minify/SymbolForRuntimeOverride", {
      files: {
        "/entry.js": /* js */ `
          let callCount = 0;
          const originalSymbolFor = Symbol.for;
          
          // Override Symbol.for to count calls
          Symbol.for = function(key) {
            callCount++;
            return originalSymbolFor.call(this, key);
          };
          
          // These unused calls should be removed at bundle time
          Symbol.for("unused1");
          Symbol.for("unused2");
          
          // These used calls should remain and increment callCount
          const s1 = Symbol.for("used1");
          const s2 = Symbol.for("used2");
          
          // Restore original
          Symbol.for = originalSymbolFor;
          
          // Verify that Symbol.for was called for the used symbols
          if (callCount !== 2) {
            throw new Error(\`Expected 2 calls to Symbol.for, got \${callCount}\`);
          }
          
          // Verify the symbols work correctly
          if (s1 !== Symbol.for("used1")) {
            throw new Error("Symbol s1 mismatch");
          }
          if (s2 !== Symbol.for("used2")) {
            throw new Error("Symbol s2 mismatch");
          }
          
          console.log("PASS");
        `,
      },

      minifySyntax: true,
      run: {
        stdout: "PASS",
      },
    });
  });
});
