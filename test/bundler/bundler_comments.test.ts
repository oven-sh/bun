import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { SourceMap, type SourceMapping } from "node:module";
import { join } from "node:path";
import { itBundled } from "./expectBundled";

describe("single-line comments", () => {
  itBundled("unix newlines", {
    files: {
      "/entry.js": `// This is a comment\nconsole.log("hello");\n// Another comment\n`,
    },
    onAfterBundle(api) {
      const output = api.readFile("/out.js");
      api.expectFile("/out.js").toContain("hello");
    },
  });

  itBundled("windows newlines", {
    files: {
      "/entry.js": `// This is a comment\r\nconsole.log("hello");\r\n// Another comment\r\n`,
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("hello");
    },
  });

  itBundled("no trailing newline", {
    files: {
      "/entry.js": `// This is a comment\nconsole.log("hello");\n// No newline at end`,
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("hello");
    },
  });

  itBundled("non-ascii characters", {
    files: {
      "/entry.js": `// 你好，世界\n// Привет, мир\n// こんにちは世界\nconsole.log("hello");\n`,
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("hello");
    },
  });

  itBundled("emoji", {
    files: {
      "/entry.js": `// 🚀 🔥 💯\nconsole.log("hello");\n`,
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("hello");
    },
  });

  itBundled("invalid surrogate pair at beginning", {
    files: {
      "/entry.js": `// \uDC00 invalid surrogate\nconsole.log("hello");\n`,
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("hello");
    },
  });

  itBundled("invalid surrogate pair at end", {
    files: {
      "/entry.js": `// invalid surrogate \uD800\nconsole.log("hello");\n`,
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("hello");
    },
  });

  itBundled("invalid surrogate pair in middle", {
    files: {
      "/entry.js": `// invalid \uD800\uDC00\uD800 surrogate\nconsole.log("hello");\n`,
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("hello");
    },
  });

  itBundled("multiple comments on same line", {
    files: {
      "/entry.js": `const x = 5; // first comment // second comment\nconsole.log(x);\n`,
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("console.log(x)");
    },
  });

  itBundled("comment with ASI", {
    files: {
      "/entry.js": `const x = 5// first comment // second comment\nconsole.log(x)`,
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("console.log(x)");
    },
  });

  itBundled("comment at end of file without newline", {
    files: {
      "/entry.js": `console.log("hello"); //`,
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("hello");
    },
  });

  itBundled("empty comments", {
    files: {
      "/entry.js": `//\n//\nconsole.log("hello");\n//`,
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("hello");
    },
  });

  itBundled("comments with special characters", {
    files: {
      "/entry.js": `// Comment with \\ backslash\n// Comment with \" quote\n// Comment with \t tab\nconsole.log("hello");\n`,
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("hello");
    },
  });

  itBundled("comments with control characters", {
    files: {
      "/entry.js": `// Comment with \u0000 NULL\n// Comment with \u0001 SOH\nconsole.log("hello");\n`,
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("hello");
    },
  });

  itBundled("comments with minification", {
    files: {
      "/entry.js": `// This should be removed\nconsole.log("hello");\n// This too`,
    },
    minifyWhitespace: true,
    minifySyntax: true,
    onAfterBundle(api) {
      api.expectFile("/out.js").toEqualIgnoringWhitespace('console.log("hello");');
    },
  });

  for (const minify of [true, false]) {
    itBundled(
      `some code and an empty comment without newline preceding ${minify ? "with minification" : "without minification"}`,
      {
        files: {
          "/entry.js": `console.log("hello");//`,
        },
        minifyWhitespace: minify,
        minifySyntax: minify,
        run: {
          stdout: "hello",
        },
      },
    );
    itBundled(`some code and then only an empty comment ${minify ? "with minification" : "without minification"}`, {
      files: {
        "/entry.js": `console.log("hello");\n//`,
      },
      minifyWhitespace: minify,
      minifySyntax: minify,
      run: {
        stdout: "hello",
      },
    });
    itBundled(`only an empty comment ${minify ? "with minification" : "without minification"}`, {
      files: {
        "/entry.js": `//`,
      },
      minifyWhitespace: minify,
      minifySyntax: minify,
      run: {
        stdout: "",
      },
    });
    itBundled("only a comment", {
      files: {
        "/entry.js": `// This is a comment`,
      },
      minifyWhitespace: true,
      minifySyntax: true,
      run: {
        stdout: "",
      },
    });
  }

  itBundled("trailing //# sourceMappingURL=", {
    files: {
      "/entry.js": `// This is a comment\nconsole.log("hello");\n//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZXhhbXBsZS5qcyIsInNvdXJjZSI6Ii8vZXhhbXBsZS5qcyJ9`,
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("hello");
    },
  });

  itBundled("trailing //# sourceMappingURL= with == at end", {
    files: {
      "/entry.js": `// This is a comment\nconsole.log("hello");\n//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZXhhbXBsZS5qcyIsInNvdXJjZSI6Ii8vZXhhbXBsZS5qcyJ9==`,
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("hello");
    },
  });

  itBundled("trailing //# sourceMappingURL= with = at end", {
    files: {
      "/entry.js": `// This is a comment\nconsole.log("hello");\n//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZXhhbXBsZS5qcyIsInNvdXJjZSI6Ii8vZXhhbXBsZS5qcyJ9=`,
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("hello");
    },
  });

  itBundled("leading //# sourceMappingURL= with = at end", {
    files: {
      "/entry.js": `//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZXhhbXBsZS5qcyIsInNvdXJjZSI6Ii8vZXhhbXBsZS5qcyJ9=\n// This is a comment\nconsole.log("hello");`,
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("hello");
    },
  });

  itBundled("leading trailing newline //# sourceMappingURL= with = at end", {
    files: {
      "/entry.js": `//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZXhhbXBsZS5qcyIsInNvdXJjZSI6Ii8vZXhhbXBsZS5qcyJ9=\n// This is a comment\nconsole.log("hello");\n`,
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("hello");
    },
  });

  itBundled("leading newline and sourcemap, trailing newline //# sourceMappingURL= with = at end", {
    files: {
      "/entry.js": `\n//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZXhhbXBsZS5qcyIsInNvdXJjZSI6Ii8vZXhhbXBsZS5qcyJ9=\n// This is a comment\nconsole.log("hello");\n`,
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("hello");
    },
  });

  itBundled("__PURE__ comment in single-line comment basic", {
    files: {
      "/entry.js": `//#__PURE__\nconsole.log("hello");`,
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("hello");
    },
  });

  itBundled("__PURE__ comment in single-line comment with spaces", {
    files: {
      "/entry.js": `// #__PURE__ \nconsole.log("hello");`,
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("hello");
    },
  });

  // A marker that is not the first word of a `//` comment is prose, not an
  // annotation. An unused pure call is removed even without minification, so a
  // false match deletes code.
  itBundled("__PURE__ comment in single-line comment with text before", {
    files: {
      "/entry.js": `// some text #__PURE__\nconsole.log("hello");`,
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("hello");
    },
  });

  itBundled("__PURE__ comment in single-line comment with tab before", {
    files: {
      "/entry.js": `//\t@__PURE__\nconsole.log("hello");`,
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("hello");
    },
  });

  itBundled("quoted /*#__PURE__*/ inside a single-line comment", {
    files: {
      "/entry.js": `function repro() {\n  // \`/*#__PURE__*/\`\n  console.log("hello");\n}\nrepro();`,
    },
    run: {
      stdout: "hello",
    },
  });

  itBundled("quoted /*#__PURE__*/ after text inside a single-line comment", {
    files: {
      "/entry.js": `// Wrap class inside init: \`/*#__PURE__*/ (() => { let C = class C {}; return C; })()\`\nconsole.log("hello");`,
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("hello");
    },
  });

  itBundled("many markers after leading whitespace in a single-line comment", {
    files: {
      "/entry.js": `//${Buffer.alloc(4096, " ").toString()}${Buffer.alloc(4096, "@").toString()}__PURE__\nconsole.log("hello");`,
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("hello");
    },
  });

  itBundled("__PURE__ comment in single-line comment with text after", {
    files: {
      "/entry.js": `// #__PURE__ some text\nconsole.log("hello");`,
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("hello");
    },
  });

  itBundled("__PURE__ comment in single-line comment with unicode characters", {
    files: {
      "/entry.js": `// 你好 #__PURE__ 世界\nconsole.log("hello");`,
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("hello");
    },
  });

  itBundled("__PURE__ comment in single-line comment with unicode characters after", {
    files: {
      "/entry.js": `// #__PURE__ 世界\nconsole.log("hello");`,
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("hello");
    },
  });

  itBundled("__PURE__ comment in single-line comment with emoji", {
    files: {
      "/entry.js": `// 🚀 #__PURE__ 🔥\nconsole.log("hello");`,
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("hello");
    },
  });

  itBundled("__PURE__ comment in single-line comment with invalid surrogate pair", {
    files: {
      "/entry.js": `// \uD800 #__PURE__ \uDC00\nconsole.log("hello");`,
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("hello");
    },
  });

  itBundled("multiple __PURE__ comments in single-line comments", {
    files: {
      "/entry.js": `//#__PURE__\nconsole.log("hello");\n//#__PURE__\nconsole.log("world");`,
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("hello");
      api.expectFile("/out.js").not.toContain("world");
    },
  });

  itBundled("__PURE__ comment in single-line comment with minification", {
    files: {
      "/entry.js": `//#__PURE__\nconsole.log("hello");`,
    },
    minifyWhitespace: true,
    minifySyntax: true,
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("hello");
    },
  });

  itBundled("__PURE__ comment in single-line comment with windows newlines", {
    files: {
      "/entry.js": `//#__PURE__\r\nconsole.log("hello");`,
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("hello");
    },
  });

  itBundled("__PURE__ comment in single-line comment at end of file", {
    files: {
      "/entry.js": `console.log("hello");\n//#__PURE__`,
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain("hello");
    },
  });

  itBundled("__PURE__ comment in single-line comment in middle of a statement", {
    files: {
      "/entry.js": `console.log(//#__PURE__\n123);`,
    },
    run: {
      stdout: "123",
    },
  });
});

describe("printed /* @__PURE__ */ comments", () => {
  // A pure call prints `/* @__PURE__ */` before its target. The target is still the first
  // token of the arrow body, of the `export default` expression, or of the statement, so it
  // keeps the parentheses that position needs.
  for (const backend of ["api", "cli"] as const) {
    itBundled(`pure call target keeps its parentheses at an expression start (${backend})`, {
      files: {
        "/entry.js": [
          "const has = (o, k) => /* @__PURE__ */ ({}).hasOwnProperty.call(o, k);",
          "const tag = x => /*#__PURE__*/ ({}).toString.call(x);",
          "const index = k => /* @__PURE__ */ ({ a: 1 })[k]();",
          "const optional = () => /* @__PURE__ */ ({ a: 2 }).valueOf?.();",
          "const left = () => /* @__PURE__ */ ({}).valueOf() && 3;",
          "const test = () => /* @__PURE__ */ ({}).valueOf() ? 4 : 0;",
          "const inner = () => /* @__PURE__ */ ({ f: () => () => 5 }).f()();",
          "const template = () => /* @__PURE__ */ ({ f: () => () => 6 }).f``();",
          "const asyncArrow = async () => /* @__PURE__ */ ({ a: 7 }).valueOf();",
          // No parentheses here: a function may start an arrow body, the outer
          // parentheses come before the comment, and `new` comes before its target.
          "const fn = () => /* @__PURE__ */ (function () { return 8; })();",
          "const wrapped = () => (/* @__PURE__ */ ({ a: { b: 9 } }).valueOf()).a;",
          "const ctor = () => /* @__PURE__ */ new ({ C: class { a = 10; } }).C();",
          'console.log(has({ a: 1 }, "a"), tag(null), index("valueOf").a, optional().a, left(), test());',
          "console.log(inner(), template(), fn(), wrapped().b, ctor().a, 22 / /* @__PURE__ */ Number(2));",
          "asyncArrow().then(o => console.log(o.a));",
          '/* @__PURE__ */ ({}).valueOf() || console.log("object");',
          '/* @__PURE__ */ (function () {})() || console.log("function");',
          '/* @__PURE__ */ (class { static f() {} }).f() || console.log("class");',
          '/* @__PURE__ */ new (function () { return Object(false); })() && console.log("new");',
        ].join("\n"),
      },
      backend,
      onAfterBundle(api) {
        api
          .expectFile("/out.js")
          .toBe(
            [
              "// entry.js",
              "var has = (o, k) => /* @__PURE__ */ ({}).hasOwnProperty.call(o, k);",
              "var tag = (x) => /* @__PURE__ */ ({}).toString.call(x);",
              "var index = (k) => /* @__PURE__ */ ({ a: 1 })[k]();",
              "var optional = () => /* @__PURE__ */ ({ a: 2 }).valueOf?.();",
              "var left = () => /* @__PURE__ */ ({}).valueOf() && 3;",
              "var test = () => /* @__PURE__ */ ({}).valueOf() ? 4 : 0;",
              "var inner = () => /* @__PURE__ */ ({ f: () => () => 5 }).f()();",
              "var template = () => /* @__PURE__ */ ({ f: () => () => 6 }).f``();",
              "var asyncArrow = async () => /* @__PURE__ */ ({ a: 7 }).valueOf();",
              "var fn = () => /* @__PURE__ */ function() {",
              "  return 8;",
              "}();",
              "var wrapped = () => (/* @__PURE__ */ { a: { b: 9 } }.valueOf()).a;",
              "var ctor = () => /* @__PURE__ */ new { C: class {",
              "  a = 10;",
              "} }.C;",
              'console.log(has({ a: 1 }, "a"), tag(null), index("valueOf").a, optional().a, left(), test());',
              "console.log(inner(), template(), fn(), wrapped().b, ctor().a, 22 / /* @__PURE__ */ Number(2));",
              "asyncArrow().then((o) => console.log(o.a));",
              '/* @__PURE__ */ ({}).valueOf() || console.log("object");',
              '/* @__PURE__ */ (function() {})() || console.log("function");',
              "/* @__PURE__ */ (class {",
              "  static f() {}",
              '}).f() || console.log("class");',
              "/* @__PURE__ */ new function() {",
              "  return Object(false);",
              '} && console.log("new");',
              "",
            ].join("\n"),
          );
      },
      run: { stdout: "true [object Null] 1 2 3 4\n5 6 8 9 10 11\nfunction\nclass\nnew\n7" },
    });
  }
  itBundled("pure call target keeps its parentheses with minified whitespace", {
    files: {
      "/entry.js": /* js */ `
        const has = (o, k) => /* @__PURE__ */ ({}).hasOwnProperty.call(o, k);
        console.log(has({ a: 1 }, "a"));
      `,
    },
    minifyWhitespace: true,
    emitDCEAnnotations: true,
    onAfterBundle(api) {
      api
        .expectFile("/out.js")
        .toBe('var has=(o,k)=>/*@__PURE__*/({}).hasOwnProperty.call(o,k);console.log(has({a:1},"a"));\n');
    },
    run: { stdout: "true" },
  });
  // Without a space, the `/` of the division and the `/*` of the comment start a line comment.
  itBundled("pure call after a division is not in a line comment with minified whitespace", {
    files: {
      "/entry.js": /* js */ `
        const two = () => 2;
        class Four { valueOf() { return 4; } }
        const call = 8 / /* @__PURE__ */ two();
        const made = 8 / /* @__PURE__ */ new Four();
        console.log(call, made);
      `,
    },
    minifyWhitespace: true,
    emitDCEAnnotations: true,
    onAfterBundle(api) {
      api
        .expectFile("/out.js")
        .toBe(
          "var two=()=>2;class Four{valueOf(){return 4}}var call=8/ /*@__PURE__*/two();var made=8/ /*@__PURE__*/new Four;console.log(call,made);\n",
        );
    },
    run: { stdout: "4 2" },
  });
  // `--minify-syntax` turns the block body into an expression body.
  itBundled("pure call target keeps its parentheses after --minify-syntax", {
    files: {
      "/entry.js": /* js */ `
        const has = (o, k) => { return /* @__PURE__ */ ({}).hasOwnProperty.call(o, k); };
        console.log(has({ a: 1 }, "a"));
      `,
    },
    minifySyntax: true,
    onAfterBundle(api) {
      api
        .expectFile("/out.js")
        .toBe(
          [
            "// entry.js",
            "var has = (o, k) => /* @__PURE__ */ ({}).hasOwnProperty.call(o, k);",
            'console.log(has({ a: 1 }, "a"));',
            "",
          ].join("\n"),
        );
    },
    run: { stdout: "true" },
  });
  // The object literal comes from `--define`: the source has no parentheses to keep.
  itBundled("pure call target from --define keeps its parentheses", {
    files: {
      "/entry.js": /* js */ `
        const f = () => /* @__PURE__ */ EMPTY.toString();
        console.log(f());
      `,
    },
    define: { EMPTY: "{}" },
    onAfterBundle(api) {
      api
        .expectFile("/out.js")
        .toBe(["// entry.js", "var f = () => /* @__PURE__ */ ({}).toString();", "console.log(f());", ""].join("\n"));
    },
    run: { stdout: "[object Object]" },
  });
  // `bun build --no-bundle` keeps the `export default` statement. Without the parentheses,
  // `export default function(x) {...}(41);` is a function declaration and then the
  // statement `(41);`, so the module exports the function.
  {
    const cases = {
      "function-call": {
        source: "export default /* @__PURE__ */ (function (x) { return x + 1; })(41);",
        pretty: "export default /* @__PURE__ */ (function(x) {\n  return x + 1;\n})(41);\n",
        minified: "export default /*@__PURE__*/(function(x){return x+1})(41);",
        read: "value",
        result: 42,
      },
      "function-member": {
        source: "export default /*#__PURE__*/ (function () { return this; }).call(7);",
        pretty: "export default /* @__PURE__ */ (function() {\n  return this;\n}).call(7);\n",
        minified: "export default /*@__PURE__*/(function(){return this}).call(7);",
        read: "value",
        result: 7,
      },
      "async-function": {
        source: "export default /* @__PURE__ */ (async function () { return 10; })();",
        pretty: "export default /* @__PURE__ */ (async function() {\n  return 10;\n})();\n",
        minified: "export default /*@__PURE__*/(async function(){return 10})();",
        read: "await value",
        result: 10,
      },
      "class-member": {
        source: "export default /* @__PURE__ */ (class { static f() { return 8; } }).f();",
        pretty: "export default /* @__PURE__ */ (class {\n  static f() {\n    return 8;\n  }\n}).f();\n",
        minified: "export default /*@__PURE__*/(class{static f(){return 8}}).f();",
        read: "value",
        result: 8,
      },
      "inner-call": {
        source: "export default /* @__PURE__ */ (function () { return () => 11; })()();",
        pretty: "export default /* @__PURE__ */ (function() {\n  return () => 11;\n})()();\n",
        minified: "export default /*@__PURE__*/(function(){return()=>11})()();",
        read: "value",
        result: 11,
      },
      "arrow-body": {
        source: "export default () => /* @__PURE__ */ ({ a: 9 }).valueOf();",
        pretty: "export default () => /* @__PURE__ */ ({ a: 9 }).valueOf();\n",
        minified: "export default ()=>/*@__PURE__*/({a:9}).valueOf();",
        read: "value().a",
        result: 9,
      },
      // No parentheses in the four below. An object may start an `export default` expression.
      "object-member": {
        source: "export default /* @__PURE__ */ ({ a: 13 }).valueOf();",
        pretty: "export default /* @__PURE__ */ { a: 13 }.valueOf();\n",
        minified: "export default /*@__PURE__*/{a:13}.valueOf();",
        read: "value.a",
        result: 13,
      },
      "arrow-function-target": {
        source: "export default () => /* @__PURE__ */ (function () { return 16; })();",
        pretty: "export default () => /* @__PURE__ */ function() {\n  return 16;\n}();\n",
        minified: "export default ()=>/*@__PURE__*/function(){return 16}();",
        read: "value()",
        result: 16,
      },
      "new-class": {
        source: "export default /* @__PURE__ */ new (class { a = 14; })();",
        pretty: "export default /* @__PURE__ */ new class {\n  a = 14;\n};\n",
        minified: "export default /*@__PURE__*/new class{a=14};",
        read: "value.a",
        result: 14,
      },
      "wrapped": {
        source: "export default (/* @__PURE__ */ (function () { return { x: 15 }; })()).x;",
        pretty: "export default (/* @__PURE__ */ function() {\n  return { x: 15 };\n}()).x;\n",
        minified: "export default (/*@__PURE__*/function(){return{x:15}}()).x;",
        read: "value",
        result: 15,
      },
    };
    const names = Object.keys(cases) as (keyof typeof cases)[];
    for (const mode of ["pretty", "minified"] as const) {
      test.concurrent(`pure call target keeps its parentheses at an export default start (${mode})`, async () => {
        using dir = tempDir("pure-comment-export-default", {
          ...Object.fromEntries(names.map(name => [`${name}.js`, cases[name].source])),
          "run.js": [
            ...names.map((name, i) => `import value${i} from "./out/${name}.js";`),
            `console.log(JSON.stringify({ ${names.map((name, i) => `"${name}": ${cases[name].read.replace("value", `value${i}`)}`).join(", ")} }));`,
          ].join("\n"),
        });
        const cwd = String(dir);

        await using build = Bun.spawn({
          cmd: [
            bunExe(),
            "build",
            "--no-bundle",
            ...(mode === "minified" ? ["--minify-whitespace", "--emit-dce-annotations"] : []),
            ...names.map(name => `${name}.js`),
            "--outdir=out",
          ],
          cwd,
          env: bunEnv,
          stdio: ["ignore", "pipe", "pipe"],
        });
        const [, buildStderr, buildExitCode] = await Promise.all([
          build.stdout.text(),
          build.stderr.text(),
          build.exited,
        ]);
        expect({ stderr: buildStderr, exitCode: buildExitCode }).toEqual({ stderr: "", exitCode: 0 });

        const printed = await Promise.all(names.map(name => Bun.file(join(cwd, "out", `${name}.js`)).text()));
        expect(Object.fromEntries(names.map((name, i) => [name, printed[i]]))).toEqual(
          Object.fromEntries(names.map(name => [name, cases[name][mode]])),
        );

        await using run = Bun.spawn({
          cmd: [bunExe(), "run.js"],
          cwd,
          env: bunEnv,
          stdio: ["ignore", "pipe", "pipe"],
        });
        const [stdout, stderr, exitCode] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);
        expect({ stdout, stderr, exitCode }).toEqual({
          stdout: JSON.stringify(Object.fromEntries(names.map(name => [name, cases[name].result]))) + "\n",
          stderr: "",
          exitCode: 0,
        });
      });
    }
  }
});

describe("multi-line comments", () => {
  itBundled("comment with \\r\\n has sourcemap", {
    files: {
      "/entry.js": "/*!\r\n * Legal comment line 1\r\n * Legal comment line 2\r\n */\r\nexport const x = 1;",
    },
    sourceMap: "external",
    onAfterBundle(api) {
      const output = api.readFile("/out.js");
      const sourcemapContent = api.readFile("/out.js.map");
      const sourcemap = JSON.parse(sourcemapContent);
      const sm = new SourceMap(sourcemap);

      // Find the multi-line legal comment in the output
      const outputLines = output.split("\n");
      let commentLineIndex = -1;
      for (let i = 0; i < outputLines.length; i++) {
        if (outputLines[i].includes("Legal comment")) {
          commentLineIndex = i;
          break;
        }
      }

      expect(commentLineIndex).toBeGreaterThanOrEqual(0);

      // The multi-line legal comment should have a sourcemap entry
      const entry = sm.findEntry(commentLineIndex, 0) as SourceMapping;

      // Verify we found a mapping for the comment
      expect(entry).toBeTruthy();
      expect(Object.keys(entry).length).toBeGreaterThan(0);

      // The mapping should point back to the original source
      expect(entry!.originalSource!).toContain("entry.js");
      expect(typeof entry.originalLine).toBe("number");
      expect(entry.originalLine).toBeGreaterThanOrEqual(0);
    },
  });

  // The lexer skips >=512-byte block comment bodies with SIMD; these verify
  // large comments end-to-end (legal comment preservation, ASI, output code).
  itBundled("large legal comment is preserved and does not corrupt the code after it", {
    files: {
      "/entry.js":
        "/*!\r\n" +
        " * Legal header line with some padding text to make the comment large enough.\r\n".repeat(20) +
        " * Licensed under the ünïcödé license 🦊\r\n" +
        " */\r\n" +
        'console.log("hello");',
    },
    run: {
      stdout: "hello",
    },
    onAfterBundle(api) {
      const output = api.readFile("/out.js");
      expect(output).toContain("Legal header line with some padding text");
      expect(output).toContain("Licensed under the ünïcödé license 🦊");
    },
  });

  itBundled("newline inside a large block comment triggers ASI", {
    files: {
      "/entry.js": `function f() { return /*${Buffer.alloc(600, "x").toString()}\n${Buffer.alloc(600, "y").toString()}*/ "value" }\nconsole.log(String(f()));`,
    },
    run: {
      stdout: "undefined",
    },
  });

  itBundled("no ASI when a large block comment contains no newline", {
    files: {
      "/entry.js": `function f() { return /*${Buffer.alloc(1200, "x").toString()}*/ "value" }\nconsole.log(String(f()));`,
    },
    run: {
      stdout: "value",
    },
  });
});
