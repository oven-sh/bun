import { describe, expect } from "bun:test";
import { itBundled } from "./expectBundled";

describe("bundler", () => {
  itBundled("footer/CommentFooter", {
    footer: "// developed with love in SF",
    backend: "cli",
    files: {
      "/a.js": `console.log("Hello, world!")`,
    },
    onAfterBundle(api) {
      api.expectFile("out.js").toEndWith('// developed with love in SF"\n');
    },
  });
  itBundled("footer/MultilineFooter", {
    footer: `/**
 * This is copyright of [...] ${new Date().getFullYear()}
 * do not redistribute without consent of [...]
*/`,
    backend: "cli",
    files: {
      "index.js": `console.log("Hello, world!")`,
    },
    onAfterBundle(api) {
      api.expectFile("out.js").toEndWith(`/**
 * This is copyright of [...] ${new Date().getFullYear()}
 * do not redistribute without consent of [...]
*/\"\n`);
    },
  });

  // With --target=bun --format=cjs the output is wrapped in
  // `(function(exports, require, module, __filename, __dirname) { ... })` and
  // Bun's loader takes the program's completion value as that function. The
  // footer has to go inside the wrapper (like the banner). A footer statement
  // after `})` makes the completion value `undefined` and the file fails to
  // load with "Expected CommonJS module to have a function wrapper".
  itBundled("footer/CommentFooterWithCJSAndTargetBun", {
    footer: "// developed with love in SF",
    format: "cjs",
    target: "bun",
    backend: "api",
    outdir: "/out",
    minifyWhitespace: true,
    files: {
      "/a.js": `module.exports = 1;`,
    },
    onAfterBundle(api) {
      expect(api.readFile("/out/a.js")).toMatchInlineSnapshot(`
        "// @bun @bun-cjs
        (function(exports, require, module, __filename, __dirname) {module.exports=1;

        // developed with love in SF
        })
        "
      `);
    },
  });

  itBundled("footer/CodeFooterWithCJSAndTargetBun", {
    banner: `console.log("banner ran");`,
    footer: `console.log("footer ran");`,
    format: "cjs",
    target: "bun",
    backend: "api",
    outdir: "/out",
    files: {
      "/entry.ts": `console.log("main ran");\nexport const x = 1;`,
    },
    onAfterBundle(api) {
      const content = api.readFile("/out/entry.js");
      expect(content).toStartWith(
        `// @bun @bun-cjs\n(function(exports, require, module, __filename, __dirname) {console.log("banner ran");\n`,
      );
      expect(content).toEndWith(`\nconsole.log("footer ran");\n})\n`);
    },
    run: {
      file: "/out/entry.js",
      stdout: "banner ran\nmain ran\nfooter ran",
    },
  });

  itBundled("footer/CodeFooterWithBytecodeAndCJSTargetBun", {
    footer: `console.log("footer ran");`,
    format: "cjs",
    target: "bun",
    bytecode: true,
    backend: "api",
    outdir: "/out",
    minifyWhitespace: true,
    files: {
      "/a.js": `module.exports = 1;\nconsole.log("main ran");`,
    },
    onAfterBundle(api) {
      expect(api.readFile("/out/a.js")).toMatchInlineSnapshot(`
        "// @bun @bytecode @bun-cjs
        (function(exports, require, module, __filename, __dirname) {module.exports=1;console.log("main ran");

        console.log("footer ran");
        })
        "
      `);
    },
    run: {
      file: "/out/a.js",
      stdout: "main ran\nfooter ran",
    },
  });
});
