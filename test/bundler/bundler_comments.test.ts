import { describe } from "bun:test";
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

describe("legal comments", () => {
  itBundled("preserve /*! style comments", {
    files: {
      "/entry.js": `/*!
 * This is a legal comment with ! - should be preserved
 * Copyright 2024 Test Corp
 */
console.log("hello");`,
    },
    onAfterBundle(api) {
      const output = api.readFile("/out.js");
      api.expectFile("/out.js").toContain("This is a legal comment with ! - should be preserved");
      api.expectFile("/out.js").toContain("Copyright 2024 Test Corp");
      api.expectFile("/out.js").toContain("hello");
    },
  });

  itBundled("preserve //! style comments", {
    files: {
      "/entry.js": `//! This is a line comment with ! - should be preserved
console.log("hello");`,
    },
    onAfterBundle(api) {
      const output = api.readFile("/out.js");
      api.expectFile("/out.js").toContain("//! This is a line comment with ! - should be preserved");
      api.expectFile("/out.js").toContain("hello");
    },
  });

  itBundled("preserve @license comments", {
    files: {
      "/entry.js": `/**
 * @license MIT
 * This should be preserved as it contains @license
 */
console.log("hello");`,
    },
    onAfterBundle(api) {
      const output = api.readFile("/out.js");
      api.expectFile("/out.js").toContain("@license MIT");
      api.expectFile("/out.js").toContain("This should be preserved as it contains @license");
      api.expectFile("/out.js").toContain("hello");
    },
  });

  itBundled("preserve @preserve comments", {
    files: {
      "/entry.js": `/**
 * @preserve
 * This should be preserved as it contains @preserve
 */
console.log("hello");`,
    },
    onAfterBundle(api) {
      const output = api.readFile("/out.js");
      api.expectFile("/out.js").toContain("@preserve");
      api.expectFile("/out.js").toContain("This should be preserved as it contains @preserve");
      api.expectFile("/out.js").toContain("hello");
    },
  });

  itBundled("preserve @copyright comments", {
    files: {
      "/entry.js": `/**
 * @copyright
 * This should be preserved as it contains @copyright
 */
console.log("hello");`,
    },
    onAfterBundle(api) {
      const output = api.readFile("/out.js");
      api.expectFile("/out.js").toContain("@copyright");
      api.expectFile("/out.js").toContain("This should be preserved as it contains @copyright");
      api.expectFile("/out.js").toContain("hello");
    },
  });

  itBundled("remove regular JSDoc comments", {
    files: {
      "/entry.js": `/**
 * This is a regular JSDoc comment - should be removed
 */
console.log("hello");`,
    },
    onAfterBundle(api) {
      const output = api.readFile("/out.js");
      api.expectFile("/out.js").not.toContain("This is a regular JSDoc comment - should be removed");
      api.expectFile("/out.js").toContain("hello");
    },
  });

  itBundled("remove regular line comments", {
    files: {
      "/entry.js": `// This is a regular line comment - should be removed
console.log("hello");`,
    },
    onAfterBundle(api) {
      const output = api.readFile("/out.js");
      api.expectFile("/out.js").not.toContain("This is a regular line comment - should be removed");
      api.expectFile("/out.js").toContain("hello");
    },
  });

  itBundled("mixed legal and regular comments", {
    files: {
      "/entry.js": `/*!
 * Legal comment with ! - preserved
 */
/**
 * @license MIT
 * Legal @license comment - preserved
 */
/**
 * Regular JSDoc comment - removed
 */
// Regular line comment - removed
//! Legal line comment - preserved
console.log("hello");`,
    },
    onAfterBundle(api) {
      const output = api.readFile("/out.js");
      // Should preserve legal comments
      api.expectFile("/out.js").toContain("Legal comment with ! - preserved");
      api.expectFile("/out.js").toContain("@license MIT");
      api.expectFile("/out.js").toContain("Legal @license comment - preserved");
      api.expectFile("/out.js").toContain("//! Legal line comment - preserved");

      // Should remove regular comments
      api.expectFile("/out.js").not.toContain("Regular JSDoc comment - removed");
      api.expectFile("/out.js").not.toContain("Regular line comment - removed");

      api.expectFile("/out.js").toContain("hello");
    },
  });

  itBundled("legal comments with minification", {
    files: {
      "/entry.js": `/*!
 * Legal comment - should be preserved even with minification
 */
/**
 * @license MIT
 * License comment - preserved
 */
/**
 * Regular comment - should be removed
 */
console.log("hello");`,
    },
    minifyWhitespace: true,
    minifySyntax: true,
    onAfterBundle(api) {
      const output = api.readFile("/out.js");
      // Legal comments should still be preserved
      api.expectFile("/out.js").toContain("Legal comment - should be preserved even with minification");
      api.expectFile("/out.js").toContain("@license MIT");
      api.expectFile("/out.js").toContain("License comment - preserved");

      // Regular comments should be removed
      api.expectFile("/out.js").not.toContain("Regular comment - should be removed");

      api.expectFile("/out.js").toContain("hello");
    },
  });

  itBundled("case sensitivity in legal comments", {
    files: {
      "/entry.js": `/**
 * @LICENSE MIT (uppercase)
 * @PRESERVE (uppercase)
 * @COPYRIGHT (uppercase)
 */
/**
 * @License MIT (mixed case)
 * @Preserve (mixed case)  
 * @Copyright (mixed case)
 */
console.log("hello");`,
    },
    onAfterBundle(api) {
      const output = api.readFile("/out.js");
      // Should preserve exact case and not do case-insensitive matching
      api.expectFile("/out.js").not.toContain("@LICENSE MIT (uppercase)");
      api.expectFile("/out.js").not.toContain("@PRESERVE (uppercase)");
      api.expectFile("/out.js").not.toContain("@COPYRIGHT (uppercase)");
      api.expectFile("/out.js").not.toContain("@License MIT (mixed case)");
      api.expectFile("/out.js").not.toContain("@Preserve (mixed case)");
      api.expectFile("/out.js").not.toContain("@Copyright (mixed case)");
      api.expectFile("/out.js").toContain("hello");
    },
  });

  itBundled("legal comments in nested positions", {
    files: {
      "/entry.js": `function test() {
  /*!
   * Legal comment inside function - should be preserved
   */
  return "hello";
}
console.log(test());`,
    },
    onAfterBundle(api) {
      const output = api.readFile("/out.js");
      api.expectFile("/out.js").toContain("Legal comment inside function - should be preserved");
      api.expectFile("/out.js").toContain("hello");
    },
  });
});
