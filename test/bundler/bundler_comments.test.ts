import { describe, expect } from "bun:test";
import { SourceMap } from "node:module";
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

  itBundled("__PURE__ comment in single-line comment with text before", {
    files: {
      "/entry.js": `// some text #__PURE__\nconsole.log("hello");`,
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("hello");
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
      api.expectFile("/out.js").not.toContain("hello");
    },
  });

  itBundled("__PURE__ comment in single-line comment with emoji", {
    files: {
      "/entry.js": `// 🚀 #__PURE__ 🔥\nconsole.log("hello");`,
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("hello");
    },
  });

  itBundled("__PURE__ comment in single-line comment with invalid surrogate pair", {
    files: {
      "/entry.js": `// \uD800 #__PURE__ \uDC00\nconsole.log("hello");`,
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").not.toContain("hello");
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
      const entry = sm.findEntry(commentLineIndex, 0);

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

describe("legal comments", () => {
  // Like esbuild, keep a comment that contains the word "@license" or
  // "@preserve", not only "/*!" and "//!". "@copyright" alone is not legal,
  // and neither is a longer word such as "@licensee".
  const legalForms = [
    "/*! bang block */",
    "//! bang line",
    "/* @license MIT Copyright (c) Foo */",
    "/** @license Apache-2.0 */",
    "/* @preserve keep this */",
    "// @license line form",
    "// @preserve line form",
    "/**\n * @license BSD-3-Clause\n * Copyright (c) Bar\n */",
    "/* @license*/",
    "/* see foo@license for the word boundary */",
  ];
  const droppedForms = [
    "/* @copyright not legal */",
    "/* plain comment */",
    "/* the @licensee agrees */",
    "/* @preserved for posterity */",
    "// see the @licenses folder",
    "/* @license_x */",
    "/* @license9 */",
  ];
  const header = legalForms.join("\n") + "\n" + droppedForms.join("\n") + "\n";

  function expectEachFormOnce(output: string) {
    for (const form of legalForms) {
      expect(output.split(form)).toHaveLength(2);
    }
    for (const form of droppedForms) {
      expect(output).not.toContain(form);
    }
  }

  for (const minify of [false, true]) {
    itBundled(`@license and @preserve comments are kept ${minify ? "with" : "without"} minification`, {
      files: {
        "/entry.js": header + `console.log("hello");\n`,
      },
      minifyWhitespace: minify,
      minifySyntax: minify,
      minifyIdentifiers: minify,
      run: {
        stdout: "hello",
      },
      onAfterBundle(api) {
        const output = api.readFile("/out.js");
        expectEachFormOnce(output);
        // The comments stay ahead of the statement they annotate.
        expect(output.indexOf(legalForms.at(-1)!)).toBeLessThan(output.indexOf("console.log"));
      },
    });
  }

  itBundled("@license comments are kept when the file is transpiled without bundling", {
    files: {
      "/entry.ts": header + `export const x: number = 1;\n`,
    },
    bundling: false,
    onAfterBundle(api) {
      const output = api.readFile("/out.js");
      expectEachFormOnce(output);
      expect(output.indexOf(legalForms.at(-1)!)).toBeLessThan(output.indexOf("export const x"));
    },
  });

  // Parsing "import(" used to clear every legal comment that was still waiting
  // for the next statement boundary.
  itBundled("a legal comment before import() is kept", {
    files: {
      "/entry.js": `
        export const load = /*! before the arrow */ () => import("external-pkg");
        export const load2 = () => import(/* @license inside the parens */ "external-pkg");
        export const load3 = () => /* @preserve before import */ import("external-pkg");
        console.log(typeof load, typeof load2, typeof load3);
      `,
    },
    external: ["external-pkg"],
    run: {
      stdout: "function function function",
    },
    onAfterBundle(api) {
      const output = api.readFile("/out.js");
      expect(output.split("/*! before the arrow */")).toHaveLength(2);
      expect(output.split("/* @license inside the parens */")).toHaveLength(2);
      expect(output.split("/* @preserve before import */")).toHaveLength(2);
    },
  });
});
