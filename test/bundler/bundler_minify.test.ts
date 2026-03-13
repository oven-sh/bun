import { describe, expect } from "bun:test";
import { normalizeBunSnapshot } from "harness";
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
    files: {
      "/entry.js": /* js */ `
        export var AB = function A() { };
        export var CD = function B() { return 1; };
        export var EF = function C() { C(); };
        export var GH = function() { };
        export var IJ = class D { };
        export var KL = class E { constructor() {} };
        export var MN = class F { method() { return F; } };
        export var OP = class { };
      `,
    },
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      // With minify-identifiers, variable names are minified but we check function/class name removal
      // Function names with 0 usage should be removed
      expect(code).toMatch(/var \w+ = function\(\) \{/); // AB function without name
      expect(code).toContain("return 1"); // CD function
      // Function name with self-reference should be kept (minified)
      expect(code).toMatch(/function \w+\(\) \{\s*\w+\(\)/); // EF function with self-reference
      // Class names with 0 usage should be removed
      expect(code).toMatch(/\w+ = class \{/); // Classes without names
      // Class name with self-reference should be kept (minified)
      expect(code).toMatch(/class \w+ \{[\s\S]*return \w+/); // MN class with self-reference
    },
    minifySyntax: true,
    minifyIdentifiers: true,
    target: "bun",
  });
  itBundled("minify/KeepNamesPreservesNames", {
    files: {
      "/entry.js": /* js */ `
        export var AB = function A() { };
        export var CD = function B() { return 1; };
        export var EF = function C() { C(); };
        export var GH = function() { };
        export var IJ = class D { };
        export var KL = class E { constructor() {} };
        export var MN = class F { method() { return F; } };
        export var OP = class { };
      `,
    },
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      // With keepNames, all names should be preserved even when minifying
      expect(code).toContain("function A()");
      expect(code).toContain("function B()");
      expect(code).toContain("function C()");
      expect(code).toContain("class D");
      expect(code).toContain("class E");
      expect(code).toContain("class F");
      // Anonymous functions/classes stay anonymous
      expect(code).toMatch(/\w+ = function\(\) \{\}/); // GH stays anonymous
      expect(code).toMatch(/\w+ = class \{\s*\}/); // OP stays anonymous
    },
    minifySyntax: true,
    minifyIdentifiers: false, // Don't minify identifiers to make testing easier
    keepNames: true,
    target: "bun",
  });
  itBundled("minify/KeepNamesWithMinifyIdentifiers", {
    files: {
      "/entry.js": /* js */ `
        export var AB = function A() { };
        export var CD = function B() { return 1; };
        export var EF = class C { };
      `,
    },
    onAfterBundle(api) {
      const code = api.readFile("/out.js");
      // With keepNames + minifyIdentifiers, names are preserved but minified
      // The original names A, B, C should still exist (though minified)
      expect(code).toMatch(/function \w+\(\)/); // Functions should have names
      expect(code).toMatch(/class \w+/); // Classes should have names
      // Should not have anonymous functions/classes
      expect(code).not.toContain("function()");
      expect(code).not.toContain("class {");
    },
    minifySyntax: true,
    minifyIdentifiers: true,
    keepNames: true,
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

  itBundled("minify/ErrorConstructorOptimization", {
    files: {
      "/entry.js": /* js */ `
        // Test all Error constructors
        capture(new Error());
        capture(new Error("message"));
        capture(new Error("message", { cause: "cause" }));
        
        capture(new TypeError());
        capture(new TypeError("type error"));
        
        capture(new SyntaxError());
        capture(new SyntaxError("syntax error"));
        
        capture(new RangeError());
        capture(new RangeError("range error"));
        
        capture(new ReferenceError());
        capture(new ReferenceError("ref error"));
        
        capture(new EvalError());
        capture(new EvalError("eval error"));
        
        capture(new URIError());
        capture(new URIError("uri error"));
        
        capture(new AggregateError([], "aggregate error"));
        capture(new AggregateError([new Error("e1")], "multiple"));
        
        // Test with complex arguments
        const msg = "dynamic";
        capture(new Error(msg));
        capture(new TypeError(getErrorMessage()));
        
        // Test that other constructors are not affected
        capture(new Date());
        capture(new Map());
        capture(new Set());
        
        function getErrorMessage() { return "computed"; }
      `,
    },
    capture: [
      "Error()",
      'Error("message")',
      'Error("message", { cause: "cause" })',
      "TypeError()",
      'TypeError("type error")',
      "SyntaxError()",
      'SyntaxError("syntax error")',
      "RangeError()",
      'RangeError("range error")',
      "ReferenceError()",
      'ReferenceError("ref error")',
      "EvalError()",
      'EvalError("eval error")',
      "URIError()",
      'URIError("uri error")',
      'AggregateError([], "aggregate error")',
      'AggregateError([Error("e1")], "multiple")',
      "Error(msg)",
      "TypeError(getErrorMessage())",
      "/* @__PURE__ */ new Date",
      "/* @__PURE__ */ new Map",
      "/* @__PURE__ */ new Set",
    ],
    minifySyntax: true,
    target: "bun",
  });

  itBundled("minify/ErrorConstructorWithVariables", {
    files: {
      "/entry.js": /* js */ `
        function capture(val) { console.log(val); return val; }
        // Test that Error constructors work with variables and expressions
        const e1 = new Error("test1");
        const e2 = new TypeError("test2");
        const e3 = new SyntaxError("test3");
        
        capture(e1.message);
        capture(e2.message);
        capture(e3.message);
        
        // Test that they're still Error instances
        capture(e1 instanceof Error);
        capture(e2 instanceof TypeError);
        capture(e3 instanceof SyntaxError);
        
        // Test with try-catch
        try {
          throw new RangeError("out of range");
        } catch (e) {
          capture(e.message);
        }
      `,
    },
    capture: [
      "val",
      "e1.message",
      "e2.message",
      "e3.message",
      "e1 instanceof Error",
      "e2 instanceof TypeError",
      "e3 instanceof SyntaxError",
      "e.message",
    ],
    minifySyntax: true,
    target: "bun",
    run: {
      stdout: "test1\ntest2\ntest3\ntrue\ntrue\ntrue\nout of range",
    },
  });

  itBundled("minify/ErrorConstructorPreservesSemantics", {
    files: {
      "/entry.js": /* js */ `
        function capture(val) { console.log(val); return val; }
        // Verify that Error() and new Error() have identical behavior
        const e1 = new Error("with new");
        const e2 = Error("without new");
        
        // Both should be Error instances
        capture(e1 instanceof Error);
        capture(e2 instanceof Error);
        
        // Both should have the same message
        capture(e1.message === "with new");
        capture(e2.message === "without new");
        
        // Both should have stack traces
        capture(typeof e1.stack === "string");
        capture(typeof e2.stack === "string");
        
        // Test all error types
        const errors = [
          [new TypeError("t1"), TypeError("t2")],
          [new SyntaxError("s1"), SyntaxError("s2")],
          [new RangeError("r1"), RangeError("r2")],
        ];
        
        for (const [withNew, withoutNew] of errors) {
          capture(withNew.constructor === withoutNew.constructor);
        }
      `,
    },
    capture: [
      "val",
      "e1 instanceof Error",
      "e2 instanceof Error",
      'e1.message === "with new"',
      'e2.message === "without new"',
      'typeof e1.stack === "string"',
      'typeof e2.stack === "string"',
      "withNew.constructor === withoutNew.constructor",
    ],
    minifySyntax: true,
    target: "bun",
    run: {
      stdout: "true\ntrue\ntrue\ntrue\ntrue\ntrue\ntrue\ntrue\ntrue",
    },
  });

  itBundled("minify/AdditionalGlobalConstructorOptimization", {
    files: {
      "/entry.js": /* js */ `
        // Test Array constructor
        capture(new Array());
        capture(new Array(3));
        capture(new Array(1, 2, 3));
        
        // Test Array with non-numeric single arguments (should convert to literal)
        capture(new Array("string"));
        capture(new Array(true));
        capture(new Array(null));
        capture(new Array(undefined));
        capture(new Array({}));
        
        // Test Object constructor
        capture(new Object());
        capture(new Object(null));
        capture(new Object({ a: 1 }));
        
        // Test Function constructor
        capture(new Function("return 42"));
        capture(new Function("a", "b", "return a + b"));
        
        // Test RegExp constructor
        capture(new RegExp("test"));
        capture(new RegExp("test", "gi"));
        capture(new RegExp(/abc/));
        
        // Test with variables
        const pattern = "\\d+";
        capture(new RegExp(pattern));
        
        // Test that other constructors are preserved
        capture(new Date());
        capture(new Map());
        capture(new Set());
      `,
    },
    capture: [
      "[]", // new Array() -> []
      "Array(3)", // new Array(3) stays as Array(3) because it creates sparse array
      `[
  1,
  2,
  3
]`, // new Array(1, 2, 3) -> [1, 2, 3]
      `[
  "string"
]`, // new Array("string") -> ["string"]
      `[
  !0
]`, // new Array(true) -> [true] (minified to !0)
      `[
  null
]`, // new Array(null) -> [null]
      `[
  void 0
]`, // new Array(undefined) -> [void 0]
      `[
  {}
]`, // new Array({}) -> [{}]
      "{}", // new Object() -> {}
      "{}", // new Object(null) -> {}
      "{ a: 1 }", // new Object({ a: 1 }) -> { a: 1 }
      'Function("return 42")',
      'Function("a", "b", "return a + b")',
      'new RegExp("test")',
      'new RegExp("test", "gi")',
      "new RegExp(/abc/)",
      "new RegExp(pattern)",
      "/* @__PURE__ */ new Date",
      "/* @__PURE__ */ new Map",
      "/* @__PURE__ */ new Set",
    ],
    minifySyntax: true,
    target: "bun",
  });

  itBundled("minify/ArrayConstructorWithNumberAndMinifyWhitespace", {
    files: {
      "/entry.js": /* js */ `
        capture(new Array(0));
        capture(new Array(1));
        capture(new Array(2));
        capture(new Array(3));
        capture(new Array(4));
        capture(new Array(5));
        capture(new Array(6));
        capture(new Array(7));
        capture(new Array(8));
        capture(new Array(9));
        capture(new Array(10));
        capture(new Array(11));
        capture(new Array(4.5));
      `,
    },
    capture: [
      "[]", // new Array() -> []
      "[,]", // new Array(1) -> [undefined]
      "[,,]", // new Array(2) -> [undefined, undefined]
      "[,,,]", // new Array(3) -> [undefined, undefined, undefined]
      "[,,,,]", // new Array(4) -> [undefined, undefined, undefined, undefined]
      "[,,,,,]", // new Array(5) -> [undefined x 5]
      "[,,,,,,]", // new Array(6) -> [undefined x 6]
      "[,,,,,,,]", // new Array(7) -> [undefined x 7]
      "[,,,,,,,,]", // new Array(8) -> [undefined x 8]
      "[,,,,,,,,,]", // new Array(9) -> [undefined x 9]
      "[,,,,,,,,,,]", // new Array(10) -> [undefined x 10]
      "Array(11)", // new Array(11) -> Array(11)
      "Array(4.5)", // new Array(4.5) is Array(4.5) because it's not an integer
    ],
    minifySyntax: true,
    minifyWhitespace: true,
    target: "bun",
  });

  itBundled("minify/GlobalConstructorSemanticsPreserved", {
    files: {
      "/entry.js": /* js */ `
        function capture(val) { console.log(val); return val; }
        
        // Test Array semantics
        const a1 = new Array(1, 2, 3);
        const a2 = Array(1, 2, 3);
        capture(JSON.stringify(a1) === JSON.stringify(a2));
        capture(a1.constructor === a2.constructor);
        
        // Test sparse array semantics - new Array(5) creates sparse array
        const sparse = new Array(5);
        capture(sparse.length === 5);
        capture(0 in sparse === false); // No element at index 0
        capture(JSON.stringify(sparse) === "[null,null,null,null,null]");

        // Single-arg variable case: must preserve sparse semantics
        const n = 3;
        const a3 = new Array(n);
        const a4 = Array(n);
        capture(a3.length === a4.length && a3.length === 3 && a3[0] === undefined);
        
        // Test Object semantics
        const o1 = new Object();
        const o2 = Object();
        capture(typeof o1 === typeof o2);
        capture(o1.constructor === o2.constructor);
        
        // Test Function semantics
        const f1 = new Function("return 1");
        const f2 = Function("return 1");
        capture(typeof f1 === typeof f2);
        capture(f1() === f2());
        
        // Test RegExp semantics
        const r1 = new RegExp("test", "g");
        const r2 = RegExp("test", "g");
        capture(r1.source === r2.source);
        capture(r1.flags === r2.flags);
      `,
    },
    capture: [
      "val",
      "JSON.stringify(a1) === JSON.stringify(a2)",
      "a1.constructor === a2.constructor",
      "sparse.length === 5",
      "0 in sparse === !1",
      'JSON.stringify(sparse) === "[null,null,null,null,null]"',
      "a3.length === a4.length && a3.length === 3 && a3[0] === void 0",
      "typeof o1 === typeof o2",
      "o1.constructor === o2.constructor",
      "typeof f1 === typeof f2",
      "f1() === f2()",
      "r1.source === r2.source",
      "r1.flags === r2.flags",
    ],
    minifySyntax: true,
    target: "bun",
    run: {
      stdout: "true\ntrue\ntrue\ntrue\ntrue\ntrue\ntrue\ntrue\ntrue\ntrue\ntrue\ntrue",
    },
  });

  itBundled("minify/TypeofUndefinedOptimization", {
    files: {
      "/entry.js": /* js */ `
        // Test all equality operators with typeof undefined
        console.log(typeof x !== 'undefined');
        console.log(typeof x != 'undefined');
        console.log('undefined' !== typeof x);
        console.log('undefined' != typeof x);

        console.log(typeof x === 'undefined');
        console.log(typeof x == 'undefined');
        console.log('undefined' === typeof x);
        console.log('undefined' == typeof x);

        // These should not be optimized
        console.log(typeof x === 'string');
        console.log(x === 'undefined');
        console.log('undefined' === y);
        console.log(typeof x === 'undefinedx');
      `,
    },
    minifySyntax: true,
    minifyWhitespace: true,
    minifyIdentifiers: false,
    onAfterBundle(api) {
      const file = api.readFile("out.js");
      expect(normalizeBunSnapshot(file)).toMatchInlineSnapshot(
        `"console.log(typeof x<"u");console.log(typeof x<"u");console.log(typeof x<"u");console.log(typeof x<"u");console.log(typeof x>"u");console.log(typeof x>"u");console.log(typeof x>"u");console.log(typeof x>"u");console.log(typeof x==="string");console.log(x==="undefined");console.log(y==="undefined");console.log(typeof x==="undefinedx");"`,
      );
    },
  });

  // https://github.com/oven-sh/bun/issues/26371
  // Minified bundler output missing semicolon between statements when
  // using both default and named imports from "bun" module
  itBundled("minify/BunImportSemicolonInsertion", {
    files: {
      "/entry.js": /* js */ `
        import bun, { embeddedFiles } from "bun"
        console.log(typeof embeddedFiles)
        console.log(typeof bun.argv)
      `,
    },
    minifySyntax: true,
    minifyWhitespace: true,
    minifyIdentifiers: true,
    target: "bun",
    run: {
      stdout: "object\nobject",
    },
  });

  itBundled("minify/BunImportNamespaceAndNamed", {
    files: {
      "/entry.js": /* js */ `
        import * as bun from "bun"
        import { embeddedFiles } from "bun"
        console.log(typeof embeddedFiles)
        console.log(typeof bun.argv)
      `,
    },
    minifySyntax: true,
    minifyWhitespace: true,
    minifyIdentifiers: true,
    target: "bun",
    run: {
      stdout: "object\nobject",
    },
  });

  itBundled("minify/BunImportDefaultNamespaceAndNamed", {
    files: {
      "/entry.js": /* js */ `
        import bun, * as bunNs from "bun"
        import { embeddedFiles } from "bun"
        console.log(typeof embeddedFiles)
        console.log(typeof bun.argv)
        console.log(typeof bunNs.argv)
      `,
    },
    minifySyntax: true,
    minifyWhitespace: true,
    minifyIdentifiers: true,
    target: "bun",
    run: {
      stdout: "object\nobject\nobject",
    },
  });
});
