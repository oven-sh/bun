import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { itBundled } from "./expectBundled";

// `minifySyntax` drops an unused `Symbol.for(x)` call only when every argument
// is a primitive literal. `Symbol.for(x)` runs ToString(x), so a call with any
// other argument stays as written: an object argument can run user code and a
// symbol argument throws. Every case pins the exact output. expectBundled runs
// backend:"api" cases serially, so only the two CLI cases (production,
// --no-bundle) at the end overlap. Keep them adjacent.
describe("bundler", () => {
  describe.concurrent("minify/Symbol.for", () => {
    itBundled("minify/SymbolForUnused", {
      files: {
        "/entry.js": /* js */ `
          Symbol.for("test1");
          Symbol.for("test2");
          Symbol.for(\`test3\`);
          Symbol.for("test" + 4);

          var sideEffect = "test" + 4;
          Symbol.for(sideEffect);

          const s1 = Symbol.for("used1");
          let s2 = Symbol.for("used2");
          var s3 = Symbol.for("used3");

          console.log(Symbol.for("argument"));

          const obj = { prop: Symbol.for("property") };

          function getSymbol() {
            return Symbol.for("return");
          }

          capture(s1, s2, s3, obj.prop, getSymbol(), sideEffect);
        `,
      },
      minifySyntax: true,
      onAfterBundle(api) {
        api.expectFile("/out.js").toMatchInlineSnapshot(`
          "// entry.js
          var sideEffect = "test4";
          Symbol.for(sideEffect);
          var s1 = Symbol.for("used1"), s2 = Symbol.for("used2"), s3 = Symbol.for("used3");
          console.log(Symbol.for("argument"));
          var obj = { prop: Symbol.for("property") };
          function getSymbol() {
            return Symbol.for("return");
          }
          capture(s1, s2, s3, obj.prop, getSymbol(), sideEffect);
          "
        `);
      },
    });

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
        api.expectFile("/out.js").toMatchInlineSnapshot(`
          "// entry.js
          Symbol.for("test1");
          Symbol.for("test2");
          var s = Symbol.for("test3");
          capture(s);
          "
        `);
      },
    });

    itBundled("minify/SymbolForWithWhitespace", {
      files: {
        "/entry.js": /* js */ `
          Symbol.for("remove-me-1");
          Symbol.for("remove-me-2");

          const sym = Symbol.for("keep-me");

          const ab = "a" + "b";
          Symbol.for(ab);
          Symbol.for(\`template\`);

          capture(sym, ab);
        `,
      },
      minifySyntax: true,
      minifyWhitespace: true,
      onAfterBundle(api) {
        api.expectFile("/out.js").toMatchInlineSnapshot(`
          "var sym=Symbol.for("keep-me"),ab="ab";Symbol.for(ab);capture(sym,ab);
          "
        `);
      },
    });

    itBundled("minify/SymbolForEdgeCases", {
      files: {
        "/entry.js": /* js */ `
          Symbol?.for("optional1");
          Symbol?.for?.("optional2");

          true && Symbol.for("conditional1");
          false || Symbol.for("conditional2");

          true ? Symbol.for("ternary1") : null;
          false ? null : Symbol.for("ternary2");

          Symbol.for(Symbol.for("nested"));
          Symbol.for(Symbol.iterator);
          Symbol.for(1n);
          Symbol.for("x", sideEffect());
          Symbol.for({ toString() { return "object"; } });

          const arr = [...[Symbol.for("spread")]];

          const obj = {
            [Symbol.for("key")]: "value"
          };

          capture(arr, obj);
        `,
      },
      minifySyntax: true,
      onAfterBundle(api) {
        api.expectFile("/out.js").toMatchInlineSnapshot(`
          "// entry.js
          Symbol?.for("optional1");
          Symbol?.for?.("optional2");
          Symbol.for(Symbol.for("nested"));
          Symbol.for(Symbol.iterator);
          Symbol.for("x", sideEffect());
          Symbol.for({ toString() {
            return "object";
          } });
          var arr = [Symbol.for("spread")], obj = {
            [Symbol.for("key")]: "value"
          };
          capture(arr, obj);
          "
        `);
      },
    });

    // An inlined enum member is the literal it inlines to.
    itBundled("minify/SymbolForInlinedEnum", {
      files: {
        "/entry.ts": /* ts */ `
          const enum Key {
            Element = "react.element",
            Count = 2,
          }

          Symbol.for(Key.Element);
          Symbol.for(Key.Count);

          const used = Symbol.for(Key.Element);
          capture(used);
        `,
      },
      minifySyntax: true,
      onAfterBundle(api) {
        api.expectFile("/out.js").toMatchInlineSnapshot(`
          "// entry.ts
          var used = Symbol.for("react.element" /* Element */);
          capture(used);
          "
        `);
      },
    });

    itBundled("minify/SymbolKeyForNotAffected", {
      files: {
        "/entry.js": /* js */ `
          Symbol.keyFor;

          const sym = Symbol.for("test");
          const key = Symbol.keyFor(sym);

          capture(key);
        `,
      },
      minifySyntax: true,
      onAfterBundle(api) {
        api.expectFile("/out.js").toMatchInlineSnapshot(`
          "// entry.js
          var sym = Symbol.for("test"), key = Symbol.keyFor(sym);
          capture(key);
          "
        `);
      },
    });

    itBundled("minify/SymbolForTreeShaking", {
      files: {
        "/entry.js": /* js */ `
          import { sym } from "./lib.js";

          Symbol.for("entry-unused");

          capture(sym);
        `,
        "/lib.js": /* js */ `
          export const unused = Symbol.for("lib-unused-export");

          export const sym = Symbol.for("lib-used-export");

          Symbol.for("lib-internal");
        `,
      },
      minifySyntax: true,
      treeShaking: true,
      onAfterBundle(api) {
        api.expectFile("/out.js").toMatchInlineSnapshot(`
          "// lib.js
          var sym = Symbol.for("lib-used-export");

          // entry.js
          capture(sym);
          "
        `);
      },
    });

    // The kept calls still happen at runtime. The string-literal calls are
    // dropped at bundle time, so the override counts only the two used ones.
    itBundled("minify/SymbolForRuntimeOverride", {
      files: {
        "/entry.js": /* js */ `
          let callCount = 0;
          const originalSymbolFor = Symbol.for;

          Symbol.for = function(key) {
            callCount++;
            return originalSymbolFor.call(this, key);
          };

          Symbol.for("unused1");
          Symbol.for("unused2");

          const s1 = Symbol.for("used1");
          const s2 = Symbol.for("used2");

          Symbol.for = originalSymbolFor;

          console.log(callCount, s1 === Symbol.for("used1"), s2 === Symbol.for("used2"));
        `,
      },
      minifySyntax: true,
      onAfterBundle(api) {
        api.expectFile("/out.js").toMatchInlineSnapshot(`
          "// entry.js
          var callCount = 0, originalSymbolFor = Symbol.for;
          Symbol.for = function(key) {
            return callCount++, originalSymbolFor.call(this, key);
          };
          var s1 = Symbol.for("used1"), s2 = Symbol.for("used2");
          Symbol.for = originalSymbolFor;
          console.log(callCount, s1 === Symbol.for("used1"), s2 === Symbol.for("used2"));
          "
        `);
      },
      run: {
        stdout: "2 true true",
      },
    });

    // ToString on a non-primitive argument is observable, so those unused
    // calls survive and behave like the source at runtime.
    itBundled("minify/SymbolForNonPrimitiveArgument", {
      files: {
        "/entry.js": /* js */ `
          const obj = {
            toString() {
              console.log("toString ran");
              return "object";
            },
          };
          Symbol.for(obj);

          try {
            Symbol.for(Symbol.for("nested"));
            console.log("no throw");
          } catch (e) {
            console.log(e.constructor.name);
          }

          try {
            Symbol.for(undefinedGlobal);
            console.log("no throw");
          } catch (e) {
            console.log(e.constructor.name);
          }
        `,
      },
      minifySyntax: true,
      onAfterBundle(api) {
        api.expectFile("/out.js").toMatchInlineSnapshot(`
          "// entry.js
          var obj = {
            toString() {
              return console.log("toString ran"), "object";
            }
          };
          Symbol.for(obj);
          try {
            Symbol.for(Symbol.for("nested")), console.log("no throw");
          } catch (e) {
            console.log(e.constructor.name);
          }
          try {
            Symbol.for(undefinedGlobal), console.log("no throw");
          } catch (e) {
            console.log(e.constructor.name);
          }
          "
        `);
      },
      run: {
        stdout: "toString ran\nTypeError\nReferenceError",
      },
    });

    // --production turns on all three minify flags.
    itBundled("minify/SymbolForProduction", {
      files: {
        "/entry.js": /* js */ `
          Symbol.for("remove-in-prod");

          const s = Symbol.for("keep-in-prod");

          Symbol.for(someGlobal);

          capture(s);
        `,
      },
      production: true,
      onAfterBundle(api) {
        api.expectFile("/out.js").toMatchInlineSnapshot(`
          "var o=Symbol.for("keep-in-prod");Symbol.for(someGlobal);capture(o);
          "
        `);
      },
    });

    itBundled("minify/SymbolForTransformMode", {
      files: {
        "/entry.js": /* js */ `
          Symbol.for("unused");
          const used = Symbol.for("used");
          Symbol.for(used);
          export { used };
        `,
      },
      bundling: false,
      minifySyntax: true,
      onAfterBundle(api) {
        api.expectFile("/out.js").toMatchInlineSnapshot(`
          "const used = Symbol.for("used");
          Symbol.for(used);

          export { used };
          "
        `);
      },
    });
  });
});

// `bun run` transpiles with minifySyntax on, so the runtime path takes the same decision.
test("bun -e keeps an unused Symbol.for call whose argument is not a primitive", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const obj = {
          toString() {
            console.log("toString ran");
            return "object";
          },
        };
        Symbol.for(obj);

        try {
          Symbol.for(Symbol.for("nested"));
          console.log("no throw");
        } catch (e) {
          console.log(e.constructor.name);
        }
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("toString ran\nTypeError\n");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});
