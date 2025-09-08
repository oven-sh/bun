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
      ".1",  // Our optimization drops leading zero
      ".1",  // Our optimization drops leading zero
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
        export const Fragment = (globalThis.doNotDCE = Symbol.for("jsx-runtime"));
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

  itBundled("minify/TrimCodeInDeadControlFlow", {
    files: {
      "/entry.js": /* js */ `
        // Basic dead code elimination after return
        function test1() {
          return 'foo'; 
          try { 
            return 'bar';
          } catch {}
        }

        // Keep var declarations in dead try block
        function test2() {
          return foo = true; 
          try { 
            var foo;
          } catch {}
        }

        // Keep var declarations in dead catch block
        function test3() {
          return foo = true; 
          try {} catch { 
            var foo;
          }
        }

        // Complex async function with dead code after early return
        async function test4() {
          if (true) return { status: "disabled_for_development" };
          try {
            const response = await httpClients.releasesApi.get();
            if (!response.ok) return { status: "no_release_found" };
            if (response.statusCode === 204) return { status: "up_to_date" };
          } catch (error) {
            return { status: "no_release_found" };
          }
          return { status: "downloading" };
        }

        console.log(test1());
        console.log(test2());
        console.log(test3());
        test4().then(result => console.log(result.status));
      `,
    },
    minifySyntax: true,
    minifyWhitespace: true,
    minifyIdentifiers: false,
    onAfterBundle(api) {
      const file = api.readFile("out.js");
      expect(file).toContain('function test1(){return"foo"}');
      expect(file).toContain("return foo=!0;try{var foo}catch{}");
      expect(file).toContain("return foo=!0;try{}catch{var foo}");
      expect(file).toContain('async function test4(){return{status:"disabled_for_development"}}');
      expect(file).not.toContain("no_release_found");
      expect(file).not.toContain("downloading");
      expect(file).not.toContain("up_to_date");
    },
    run: {
      stdout: "foo\ntrue\ntrue\ndisabled_for_development",
    },
  });

  itBundled("minify/MathPowToExponentiation", {
    files: {
      "/entry.js": /* js */ `
        // Should be optimized (simple numeric literals)
        capture(Math.pow(2, 10));
        capture(Math.pow(3, 5));
        capture(Math.pow(10, 2));
        
        // Should NOT be optimized (non-simple bases)
        capture(Math.pow(11, 2));
        capture(Math.pow(-2, 3));
        capture(Math.pow(2.5, 2));
        capture(Math.pow(x, 2));
      `,
    },
    capture: [
      "2 ** 10",
      "3 ** 5",
      "10 ** 2",
      "Math.pow(11,2)",
      "Math.pow(-2,3)",
      "Math.pow(2.5,2)",
      "Math.pow(x,2)",
    ],
    minifySyntax: true,
  });

  itBundled("minify/FractionalLiteralOptimization", {
    files: {
      "/entry.js": /* js */ `
        // Should drop leading zeros
        capture(0.5);
        capture(0.25);
        capture(0.125);
        capture(0.999);
        capture(0.001);
        
        // Should NOT drop zeros for numbers >= 1
        capture(1.5);
        capture(10.5);
        
        // Should NOT affect zero itself
        capture(0.0);
      `,
    },
    capture: [
      ".5",
      ".25",
      ".125",
      ".999",
      ".001",
      "1.5",
      "10.5",
      "0",
    ],
    minifySyntax: true,
  });

  itBundled("minify/StrictEqualToLooseEqualInNumericContext", {
    files: {
      "/entry.js": /* js */ `
        // Should optimize in numeric contexts (comparing with 0)
        const x = 5;
        capture((x & 7) === 0);
        capture(0 === (x | 3));
        capture((x ^ x) === 0);
        
        // Should optimize bitwise operations
        capture((x & (x - 1)) === 0);
        capture((x << 2) === 0);
        capture((x >> 1) === 0);
        capture((x >>> 1) === 0);
        
        // Should NOT optimize non-numeric contexts
        capture("0" === 0);
        capture(null === 0);
        capture(someVar === 0);
      `,
    },
    capture: [
      "!1",  // (5 & 7) === 0 is false, constant folded
      "!1",  // 0 === (5 | 3) is false, constant folded
      "!0",  // (5 ^ 5) === 0 is true, constant folded
      "!1",  // (5 & 4) === 0 is false, constant folded
      "!1",  // (5 << 2) === 0 is false, constant folded
      "!1",  // (5 >> 1) === 0 is false, constant folded
      "!1",  // (5 >>> 1) === 0 is false, constant folded
      "!1",  // "0" === 0 is false, constant folded
      "!1",  // null === 0 is false, constant folded
      "someVar == 0",  // Variable can't be constant folded
    ],
    minifySyntax: true,
  });

  itBundled("minify/CommaSpacesInFunctionCalls", {
    files: {
      "/entry.js": /* js */ `
        function test(a, b, c, d) {
          return a + b + c + d;
        }
        
        const arrow = (x, y, z) => x * y * z;
        
        capture(test(1, 2, 3, 4));
        capture(arrow(5, 6, 7));
        capture(Math.max(8, 9, 10, 11, 12));
      `,
    },
    minifySyntax: true,
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      // Check that commas in function parameters have no spaces
      expect(code).toContain("function test(a,b,c,d)");
      expect(code).toContain("var arrow = (x,y,z) =>");
      // Check that commas in function calls have no spaces
      expect(code).toContain("test(1,2,3,4)");
      expect(code).toContain("arrow(5,6,7)");
      expect(code).toContain("Math.max(8,9,10,11,12)");
    },
  });

  itBundled("minify/CombinedOptimizations", {
    files: {
      "/entry.js": /* js */ `
        // Combining multiple optimizations
        function calculate(a, b, c) {
          const power = Math.pow(2, 8);
          const fraction = 0.5;
          const check = (a & 0xFF) === 0;
          return power * fraction + (check ? 1 : 0);
        }
        
        capture(calculate(10, 20, 30));
      `,
    },
    minifySyntax: true,
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      // Check Math.pow optimization
      expect(code).toContain("2 ** 8");
      // Check fractional optimization
      expect(code).toContain(".5");
      // Check === to == optimization
      expect(code).toContain("(a & 255) == 0");
      // Check comma spaces removed
      expect(code).toContain("function calculate(a,b,c)");
      expect(code).toContain("calculate(10,20,30)");
    },
  });
});
