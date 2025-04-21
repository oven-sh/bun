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
