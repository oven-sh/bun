import { describe, expect } from "bun:test";
import { itBundled } from "./expectBundled";

describe("bundler", () => {
  itBundled("minify/TemplateStringFolding", {
    files: {
      "/entry.js": /* js */ `
        capture(\`\${1}-\${2}-\${3}-\${null}-\${undefined}-\${true}-\${false}\`);
        capture(\`\\uD83D\\uDE0B \\uD83D\\uDCCB \\uD83D\\uDC4C\`.length)
        capture(\`\\uD83D\\uDE0B \\uD83D\\uDCCB \\uD83D\\uDC4C\`.length === 8)
        capture(\`\\uD83D\\uDE0B \\uD83D\\uDCCB \\uD83D\\uDC4C\`.length == 8)
        capture(\`\\uD83D\\uDE0B \\uD83D\\uDCCB \\uD83D\\uDC4C\`.length === 1)
        capture(\`\\uD83D\\uDE0B \\uD83D\\uDCCB \\uD83D\\uDC4C\`.length == 1)
        capture("\\uD83D\\uDE0B \\uD83D\\uDCCB \\uD83D\\uDC4C".length)
        capture("\\uD83D\\uDE0B \\uD83D\\uDCCB \\uD83D\\uDC4C".length === 8)
        capture("\\uD83D\\uDE0B \\uD83D\\uDCCB \\uD83D\\uDC4C".length == 8)
        capture("\\uD83D\\uDE0B \\uD83D\\uDCCB \\uD83D\\uDC4C".length === 1)
        capture("\\uD83D\\uDE0B \\uD83D\\uDCCB \\uD83D\\uDC4C".length == 1)
        capture('\\uD83D\\uDE0B \\uD83D\\uDCCB \\uD83D\\uDC4C'.length)
        capture('\\uD83D\\uDE0B \\uD83D\\uDCCB \\uD83D\\uDC4C'.length === 8)
        capture('\\uD83D\\uDE0B \\uD83D\\uDCCB \\uD83D\\uDC4C'.length == 8)
        capture('\\uD83D\\uDE0B \\uD83D\\uDCCB \\uD83D\\uDC4C'.length === 1)
        capture('\\uD83D\\uDE0B \\uD83D\\uDCCB \\uD83D\\uDC4C'.length == 1)
        capture(\`😋📋👌\`.length === 6)
        capture(\`😋📋👌\`.length == 6)
        capture(\`😋📋👌\`.length === 2)
        capture(\`😋📋👌\`.length == 2)
        capture(\`\\n\`.length)
        capture(\`\n\`.length)
        capture("\\uD800\\uDF34".length)
        capture("\\u{10334}".length)
        capture("𐌴".length)
      `,
    },
    capture: [
      '"1-2-3-null-undefined-true-false"',
      "8",
      "!0",
      "!0",
      "!1",
      "!1",
      "8",
      "!0",
      "!0",
      "!1",
      "!1",
      "8",
      "!0",
      "!0",
      "!1",
      "!1",
      "!0",
      "!0",
      "!1",
      "!1",
      "1",
      "1",
      "2",
      "2",
      "2",
    ],
    minifySyntax: true,
    target: "bun",
  });
  itBundled("minify/StringAdditionFolding", {
    files: {
      "/entry.js": /* js */ `
        capture("Objects are not valid as a React child (found: " + (childString === "[object Object]" ? "object with keys {" + Object.keys(node).join(", ") + "}" : childString) + "). " + "If you meant to render a collection of children, use an array " + "instead.")
      `,
    },
    capture: [
      '"Objects are not valid as a React child (found: " + (childString === "[object Object]" ? "object with keys {" + Object.keys(node).join(", ") + "}" : childString) + "). If you meant to render a collection of children, use an array instead."',
    ],
    minifySyntax: true,
  });
  itBundled("minify/FunctionExpressionRemoveName", {
    todo: true,
    files: {
      "/entry.js": /* js */ `
        capture(function remove() {});
        capture(function() {});
        capture(function rename_me() { rename_me() });
      `,
    },
    // capture is pretty stupid and will stop at first )
    capture: ["function(", "function(", "function e("],
    minifySyntax: true,
    minifyIdentifiers: true,
    target: "bun",
  });
  itBundled("minify/PrivateIdentifiersNameCollision", {
    files: {
      "/entry.js": /* js */ `
        class C {
          ${new Array(500)
            .fill(null)
            .map((_, i) => `#identifier${i} = 123;`)
            .join("\n")}
          a = 456;

          getAllValues() {
            return [
              ${new Array(500)
                .fill(null)
                .map((_, i) => `this.#identifier${i}`)
                .join(",")}
            ]
          }
        }
        
        const values = new C().getAllValues();
        for (const value of values) {
          if(value !== 123) { throw new Error("Expected 123!"); }
        }

        console.log("a = " + new C().a);
      `,
    },
    minifyIdentifiers: true,
    run: { stdout: "a = 456" },
  });
  itBundled("minify/MergeAdjacentVars", {
    files: {
      "/entry.js": /* js */ `
        var a = 1;
        var b = 2;
        var c = 3;
        
        // some code to prevent inlining
        a = 4;
        console.log(a, b, c)
        b = 5;
        console.log(a, b, c)
        c = 6;
        console.log(a, b, c)
      `,
    },
    minifySyntax: true,
    run: { stdout: "4 2 3\n4 5 3\n4 5 6" },
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      expect([...code.matchAll(/var /g)]).toHaveLength(1);
    },
  });
  itBundled("minify/Infinity", {
    files: {
      "/entry.js": /* js */ `
        capture(Infinity);
        capture(-Infinity);
        capture(Infinity + 1);
        capture(-Infinity - 1);
        capture(Infinity / 0);
        capture(-Infinity / 0);
        capture(Infinity * 0);
        capture(-Infinity * 0);
        capture(Infinity % 1);
        capture(-Infinity % 1);
        capture(Infinity ** 1);
        capture(-(Infinity ** 1));
        capture(~Infinity);
        capture(~-Infinity);
      `,
    },
    capture: [
      "1 / 0",
      "-1 / 0",
      "1 / 0",
      "-1 / 0",
      "1 / 0",
      "-1 / 0",
      "NaN",
      "NaN",
      "NaN",
      "NaN",
      "1 / 0",
      "-1 / 0",
      "-1",
      "-1",
    ],
    minifySyntax: true,
  });
  itBundled("minify+whitespace/Infinity", {
    files: {
      "/entry.js": /* js */ `
        capture(Infinity);
        capture(-Infinity);
        capture(Infinity + 1);
        capture(-Infinity - 1);
        capture(Infinity / 0);
        capture(-Infinity / 0);
        capture(Infinity * 0);
        capture(-Infinity * 0);
        capture(Infinity % 1);
        capture(-Infinity % 1);
        capture(Infinity ** 1);
        capture((-Infinity) ** 2);
        capture(~Infinity);
        capture(~-Infinity);
      `,
    },
    capture: ["1/0", "-1/0", "1/0", "-1/0", "1/0", "-1/0", "NaN", "NaN", "NaN", "NaN", "1/0", "1/0", "-1", "-1"],
    minifySyntax: true,
    minifyWhitespace: true,
  });
  itBundled("minify/InlineArraySpread", {
    files: {
      "/entry.js": /* js */ `
        capture([1, 2, ...[3, 4], 5, 6, ...[7, ...[...[...[...[8, 9]]]]], 10, ...[...[...[...[...[...[...[11]]]]]]]]);
        capture([1, 2, ...[3, 4], 5, 6, ...[7, [...[...[...[8, 9]]]]], 10, ...[...[...[...[...[...[...11]]]]]]]);
      `,
    },
    capture: ["[1,2,3,4,5,6,7,8,9,10,11]", "[1,2,3,4,5,6,7,[8,9],10,...11]"],
    minifySyntax: true,
    minifyWhitespace: true,
  });
  itBundled("minify/ForAndWhileLoopsWithMissingBlock", {
    files: {
      "/entry.js": /* js */ `
        {
          var n = 0;
          for (let i = 0; i < 10; i++) i;
        }
        {
          var j = 0;
          for (let i in [1, 2, 3]) i;
        }
        {
          var k = 0;
          for (let i of [1, 2, 3]) i;
        }
        console.log("PASS");
      `,
    },
    minifyWhitespace: true,
    run: {
      stdout: "PASS",
    },
  });
  itBundled("minify/MissingExpressionBlocks", {
    files: {
      "/entry.js": /* js */ `
        var r = 1;
        var g;
        g = () => {
          if (r) {
            undefined;
          }
        };
        
        g = () => {
          if (r) {
          } else if (r) {
            undefined;
          }
        };
        
        g = () => {
          if (r) {
            undefined;
          } else if (r) {
            undefined;
          }
        };
        
        g = () => {
          if (r) {
          } else if (r) {
          } else {
            undefined;
          }
        };
        
        g = () => {
          if (r) {
          } else if (r) {
            undefined;
          } else {
          }
        };
        
        g = () => {
          if (r) {
            undefined;
          } else if (r) {
          } else {
          }
        };
        
        g = () => {
          if (r) {
            undefined;
          } else if (r) {
            undefined;
          } else {
          }
        };
        
        g = () => {
          if (r) {
            undefined;
          } else if (r) {
            undefined;
          } else {
            undefined;
          }
        };
        
        g = () => {
          if (r) {
            undefined;
          } else if (r) {
          } else {
            undefined;
          }
        };
        
        g = () => {
          while (r) {
            undefined;
          }
        };
        
        g = () => {
          do undefined;
          while (r);
        };
        
        g = () => {
          for (;;) undefined;
        };
        
        g = () => {
          for (let i = 0; i < 10; i++) undefined;
        };
        g = () => {
          for (let i in [1, 2, 3]) undefined;
        };
        g = () => {
          for (let i of [1, 2, 3]) undefined;
        };
        
        g = () => {
          switch (r) {
            case 1:
              undefined;
            case 23: {
              undefined;
            }
          }
        };
        
        g = () => {
          let gg;
          gg = () => undefined;
        };
        
        console.log("PASS");
      `,
    },
    minifyWhitespace: true,
    minifySyntax: true,
    run: {
      stdout: "PASS",
    },
  });
  // https://github.com/oven-sh/bun/issues/5501
  itBundled("minify/BunRequireStatement", {
    files: {
      "/entry.js": /* js */ `
        export function test(ident) {
          return require(ident);
        }

        test("fs");
        console.log("PASS");
      `,
    },
    minifyWhitespace: true,
    minifySyntax: true,
    minifyIdentifiers: true,
    target: "bun",
    backend: "cli",
    run: {
      stdout: "PASS",
    },
  });
  // https://github.com/oven-sh/bun/issues/6750
  itBundled("minify/SwitchUndefined", {
    files: {
      "/entry.js": /* js */ `
        switch (1) {
          case undefined: {
          }
        }
        console.log("PASS");
      `,
    },
    minifyWhitespace: true,
    minifySyntax: false,
    minifyIdentifiers: false,
    target: "bun",
    backend: "cli",
    run: {
      stdout: "PASS",
    },
  });
  itBundled("minify/RequireInDeadBranch", {
    files: {
      "/entry.ts": /* js */ `
        if (0 !== 0) {
          require;
        }
      `,
    },
    outfile: "/out.js",
    minifySyntax: true,
    onAfterBundle(api) {
      // This should not be marked as a CommonJS module
      api.expectFile("/out.js").not.toContain("require");
      api.expectFile("/out.js").not.toContain("module");
    },
  });
  itBundled("minify/TypeOfRequire", {
    files: {
      "/entry.ts": /* js */ `
        capture(typeof require); 
      `,
    },
    outfile: "/out.js",
    capture: ['"function"'],
    minifySyntax: true,
    onAfterBundle(api) {
      // This should not be marked as a CommonJS module
      api.expectFile("/out.js").not.toContain("require");
      api.expectFile("/out.js").not.toContain("module");
    },
  });
  itBundled("minify/RequireMainToImportMetaMain", {
    files: {
      "/entry.ts": /* js */ `
        capture(require.main === module); 
        capture(require.main !== module); 
        capture(require.main == module); 
        capture(require.main != module); 
        capture(!(require.main === module)); 
        capture(!(require.main !== module)); 
        capture(!(require.main == module)); 
        capture(!(require.main != module)); 
        capture(!!(require.main === module)); 
        capture(!!(require.main !== module)); 
        capture(!!(require.main == module)); 
        capture(!!(require.main != module)); 
      `,
    },
    outfile: "/out.js",
    capture: [
      "import.meta.main",
      "!import.meta.main",
      "import.meta.main",
      "!import.meta.main",
      "!import.meta.main",
      "import.meta.main",
      "!import.meta.main",
      "import.meta.main",
      "import.meta.main",
      "!import.meta.main",
      "import.meta.main",
      "!import.meta.main",
    ],
    minifySyntax: true,
    onAfterBundle(api) {
      // This should not be marked as a CommonJS module
      api.expectFile("/out.js").not.toContain("require");
      api.expectFile("/out.js").not.toContain("module");
    },
  });
  itBundled("minify/ConstantFoldingUnaryPlusString", {
    files: {
      "/entry.ts": `
        // supported
        capture(+'1.0');
        capture(+'-123.567');
        capture(+'8.325');
        capture(+'100000000');
        capture(+'\\u0030\\u002e\\u0031');
        capture(+'\\x30\\x2e\\x31');
        capture(+'NotANumber');
        // not supported
        capture(+'æ');
      `,
    },
    minifySyntax: true,
    capture: [
      "1",
      "-123.567",
      "8.325",
      "1e8",
      "0.1",
      "0.1",
      "NaN",
      // untouched
      '+"æ"',
    ],
  });
  itBundled("minify/ImportMetaHotTreeShaking", {
    files: {
      "/entry.ts": `
        import { value } from "./other.ts";
        capture(import.meta.hot);
        if (import.meta.hot) {
          throw new Error("FAIL");
        }
        import.meta.hot.accept(() => {"FAIL";value});
        import.meta.hot.dispose(() => {"FAIL";value});
        import.meta.hot.on(() => {"FAIL";value});
        import.meta.hot.off(() => {"FAIL";value});
        import.meta.hot.send(() => {"FAIL";value});
        import.meta.hot.invalidate(() => {"FAIL";value});
        import.meta.hot.prune(() => {"FAIL";value});
        capture(import.meta.hot.accept());
        capture("This should remain");
        import.meta.hot.accept(async() => {
          await import("crash");
          require("crash");
        });
        capture(import.meta.hot.data);
        capture(import.meta.hot.data.value ??= "hello");
      `,
      "other.ts": `
        capture("hello");
        export const value = "hello";
      `,
    },
    outfile: "/out.js",
    capture: ['"hello"', "void 0", "void 0", '"This should remain"', "{}", '"hello"'],
    minifySyntax: true,
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("FAIL");
      api.expectFile("/out.js").not.toContain("import.meta.hot");
    },
  });
  itBundled("minify/ProductionMode", {
    files: {
      "/entry.jsx": `
        import {foo} from 'dev-trap';
        capture(process.env.NODE_ENV);
        capture(1232 + 521)
        console.log(<div>Hello</div>);
      `,
      "/node_modules/react/jsx-dev-runtime.js": `
        throw new Error("Should not use dev runtime");
      `,
      "/node_modules/react/jsx-runtime.js": `
        export function jsx(type, props) {
          return {type, props};
        }
        export const Fragment = Symbol.for("jsx-runtime");
      `,
      "/node_modules/dev-trap/package.json": `{
        "name": "dev-trap",
        "exports": {
          "development": "./dev.js",
          "default": "./prod.js"
        }
      }`,
      "/node_modules/dev-trap/dev.js": `
        throw new Error("FAIL");
      `,
      "/node_modules/dev-trap/prod.js": `
        export const foo = "production";
      `,
    },
    capture: ['"production"', "1753"],
    production: true,
    onAfterBundle(api) {
      const output = api.readFile("out.js");

      expect(output).not.toContain("FAIL");

      // Check minification
      expect(output).not.toContain("\t");
      expect(output).not.toContain("  ");

      // Check NODE_ENV is inlined
      expect(output).toContain('"production"');
      expect(output).not.toContain("process.env.NODE_ENV");

      // Check JSX uses production runtime
      expect(output).toContain("jsx-runtime");
    },
  });
  itBundled("minify/UnusedInCommaExpression", {
    files: {
      "/entry.ts": `
        let flag = computeSomethingUnknown();
        // the expression 'flag === 1' has no side effects
        capture((flag === 1234 ? "a" : "b", "c"));
        // 'flag == 1234' may invoke a side effect
        capture((flag == 1234 ? "a" : "b", "c"));
        // 'unbound' may invoke a side effect
        capture((unbound ? "a" : "b", "c"));
        // two side effects
        capture((flag == 1234 ? "a" : unbound, "c"));
        // two side effects 2
        capture(([flag == 1234] ? unbound : other, "c"));
        // new expression
        capture((new Date(), 123));
        // call expression
        const funcWithNoSideEffects = () => 1;
        capture((/* @__PURE__ */ funcWithNoSideEffects(), 456));
      `,
    },
    minifySyntax: true,
    capture: [
      // 'flag' cannot throw on access or comparison via '==='
      '"c"',
      // 0 is inserted instead of 1234 because it is shorter and invokes the same coercion side effects
      '(flag == 0, "c")',
      // 'unbound' may throw on access
      '(unbound, "c")',
      // 0 is not inserted here because the result of 'flag == 1234' is used by the ternary
      '(flag == 1234 || unbound, "c")',
      // || is not inserted since the condition is always true, can simplify '1234' to '0'
      '(flag == 0, unbound, "c")',
      "123",
      "456",
    ],
  });
});
