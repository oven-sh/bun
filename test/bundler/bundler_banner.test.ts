import { describe, expect } from "bun:test";
import { itBundled } from "./expectBundled";

describe("bundler", () => {
  itBundled("banner/CommentBanner", {
    banner: "// developed with love in SF",
    files: {
      "/a.js": `console.log("Hello, world!")`,
    },
    onAfterBundle(api) {
      api.expectFile("out.js").toContain("// developed with love in SF");
    },
  });
  itBundled("banner/MultilineBanner", {
    banner: `"use client";
// This is a multiline banner
// It can contain multiple lines of comments or code`,
    files: {
      /* js*/ "index.js": `console.log("Hello, world!")`,
    },
    onAfterBundle(api) {
      api.expectFile("out.js").toContain(`"use client";
// This is a multiline banner
// It can contain multiple lines of comments or code`);
    },
  });
  itBundled("banner/UseClientBanner", {
    banner: '"use client";',
    files: {
      /* js*/ "index.js": `console.log("Hello, world!")`,
    },
    onAfterBundle(api) {
      api.expectFile("out.js").toContain('"use client";');
    },
  });

  itBundled("banner/BannerWithCJSAndTargetBun", {
    banner: "// Copyright 2024 Example Corp",
    format: "cjs",
    target: "bun",
    backend: "api",
    outdir: "/out",
    minifyWhitespace: true,
    files: {
      "a.js": `module.exports = 1;`,
    },
    onAfterBundle(api) {
      const content = api.readFile("/out/a.js");
      expect(content).toMatchInlineSnapshot(`
        "// @bun @bun-cjs
        (function(exports, require, module, __filename, __dirname) {// Copyright 2024 Example Corp
        module.exports=1;})
        "
      `);
    },
  });

  itBundled("banner/HashbangBannerWithCJSAndTargetBun", {
    banner: "#!/usr/bin/env -S node --enable-source-maps\n// Additional banner content",
    format: "cjs",
    target: "bun",
    backend: "api",
    outdir: "/out",
    minifyWhitespace: true,
    files: {
      "/a.js": `module.exports = 1;`,
    },
    onAfterBundle(api) {
      const content = api.readFile("/out/a.js");
      expect(content).toMatchInlineSnapshot(`
        "#!/usr/bin/env -S node --enable-source-maps
        // @bun @bun-cjs
        (function(exports, require, module, __filename, __dirname) {// Additional banner content
        module.exports=1;})
        "
      `);
    },
  });

  itBundled("banner/SourceHashbangWithBannerAndCJSTargetBun", {
    banner: "// Copyright 2024 Example Corp",
    format: "cjs",
    target: "bun",
    outdir: "/out",
    minifyWhitespace: true,
    backend: "api",
    files: {
      "/a.js": `#!/usr/bin/env node
module.exports = 1;`,
    },
    onAfterBundle(api) {
      const content = api.readFile("/out/a.js");
      expect(content).toMatchInlineSnapshot(`
        "#!/usr/bin/env node
        // @bun @bun-cjs
        (function(exports, require, module, __filename, __dirname) {// Copyright 2024 Example Corp
        module.exports=1;})
        "
      `);
    },
  });

  itBundled("banner/NonAsciiBannerTargetBun", {
    banner: 'globalThis.BNR = "béta🚀";',
    target: "bun",
    files: {
      "/a.js": `console.log(globalThis.BNR, globalThis.BNR.length);`,
    },
    onAfterBundle(api) {
      const content = api.readFile("out.js");
      expect(content).toStartWith("// @bun\n");
      expect(content).toContain('globalThis.BNR = "béta🚀";');
    },
    run: { stdout: "béta🚀 6" },
  });

  itBundled("banner/NonAsciiIdentifierBannerTargetBun", {
    banner: "globalThis.café = 42;",
    target: "bun",
    files: {
      "/a.js": `console.log(globalThis.café);`,
    },
    onAfterBundle(api) {
      expect(api.readFile("out.js")).toStartWith("// @bun\n");
    },
    run: { stdout: "42" },
  });

  itBundled("banner/NonAsciiBannerTargetBunImported", {
    banner: 'globalThis.BNR = "béta🚀";',
    target: "bun",
    files: {
      "/a.js": `console.log(globalThis.BNR, globalThis.BNR.length);`,
    },
    runtimeFiles: {
      "/importer.js": `import "./out.js";`,
    },
    onAfterBundle(api) {
      expect(api.readFile("out.js")).toStartWith("// @bun\n");
    },
    run: { file: "/importer.js", stdout: "béta🚀 6" },
  });

  itBundled("banner/NonAsciiBannerTargetBunBytecode", {
    banner: 'globalThis.BNR = "béta🚀";',
    target: "bun",
    format: "cjs",
    bytecode: true,
    backend: "api",
    outdir: "/out",
    files: {
      "/a.js": `console.log(globalThis.BNR, globalThis.BNR.length);`,
    },
    onAfterBundle(api) {
      expect(api.readFile("/out/a.js")).toStartWith("// @bun @bytecode @bun-cjs\n");
    },
    run: {
      stdout: "béta🚀 6",
      env: { BUN_JSC_verboseDiskCache: "1" },
      validate({ stderr }) {
        expect(stderr).toContain("[Disk Cache] Cache hit for sourceCode");
      },
    },
  });

  itBundled("banner/BannerWithESMAndTargetBun", {
    banner: "// Copyright 2024 Example Corp",
    format: "esm",
    target: "bun",
    backend: "api",
    minifyWhitespace: true,
    files: {
      "/a.js": `export default 1;`,
    },
    onAfterBundle(api) {
      const content = api.readFile("out.js");
      // @bun comment should come first, then banner
      const bunCommentIndex = content.indexOf("// @bun");
      const bannerIndex = content.indexOf("// Copyright 2024 Example Corp");

      expect(bunCommentIndex).toBe(0);
      expect(bannerIndex).toBeGreaterThan(bunCommentIndex);
      // No CJS wrapper in ESM format
      expect(content).not.toContain("(function(exports, require, module, __filename, __dirname)");
      expect(content).toMatchInlineSnapshot(`
        "// @bun
        // Copyright 2024 Example Corp
        var a_default=1;export{a_default as default};
        "
      `);
    },
  });

  itBundled("banner/HashbangBannerWithESMAndTargetBun", {
    banner: "#!/usr/bin/env -S node --enable-source-maps\n// Additional banner content",
    format: "esm",
    target: "bun",
    backend: "api",
    outdir: "/out",
    minifyWhitespace: true,
    files: {
      "/a.js": `export default 1;`,
    },
    onAfterBundle(api) {
      const content = api.readFile("/out/a.js");
      expect(content).toMatchInlineSnapshot(`
        "#!/usr/bin/env -S node --enable-source-maps
        // @bun
        // Additional banner content
        var a_default=1;export{a_default as default};
        "
      `);
    },
  });

  itBundled("banner/BannerWithBytecodeAndCJSTargetBun", {
    banner: "// Copyright 2024 Example Corp",
    format: "cjs",
    target: "bun",
    backend: "api",
    bytecode: true,
    minifyWhitespace: true,
    outdir: "/out",
    files: {
      "/a.js": `module.exports = 1;`,
    },
    onAfterBundle(api) {
      const content = api.readFile("/out/a.js");
      expect(content).toMatchInlineSnapshot(`
        "// @bun @bytecode @bun-cjs
        (function(exports, require, module, __filename, __dirname) {// Copyright 2024 Example Corp
        module.exports=1;})
        "
      `);
      // @bun @bytecode @bun-cjs comment should come first, then CJS wrapper, then banner
      const bunBytecodeIndex = content.indexOf("// @bun @bytecode @bun-cjs");
      const wrapperIndex = content.indexOf("(function(exports, require, module, __filename, __dirname) {");
      const bannerIndex = content.indexOf("// Copyright 2024 Example Corp");

      expect(bunBytecodeIndex).toBe(0);
      expect(wrapperIndex).toBeGreaterThan(bunBytecodeIndex);
      expect(bannerIndex).toBeGreaterThan(wrapperIndex);
    },
  });

  itBundled("banner/HashbangBannerWithBytecodeAndCJSTargetBun", {
    banner: "#!/usr/bin/env bun\n// Production build",
    format: "cjs",
    target: "bun",
    bytecode: true,
    backend: "api",
    outdir: "/out",
    minifyWhitespace: true,
    files: {
      "/a.js": `module.exports = 1;`,
    },
    onAfterBundle(api) {
      const content = api.readFile("/out/a.js");

      expect(content).toMatchInlineSnapshot(`
        "#!/usr/bin/env bun
        // @bun @bytecode @bun-cjs
        (function(exports, require, module, __filename, __dirname) {// Production build
        module.exports=1;})
        "
      `);
    },
  });

  itBundled("banner/SourceHashbangWithBytecodeAndCJSTargetBun", {
    banner: "// Copyright 2024 Example Corp",
    format: "cjs",
    target: "bun",
    bytecode: true,
    outdir: "/out",
    minifyWhitespace: true,
    backend: "api",
    files: {
      "/a.js": `#!/usr/bin/env bun
module.exports = 1;
console.log("bun!");`,
    },
    onAfterBundle(api) {
      const content = api.readFile("/out/a.js");
      // Shebang from source should come first, then @bun pragma
      expect(content).toMatchInlineSnapshot(`
        "#!/usr/bin/env bun
        // @bun @bytecode @bun-cjs
        (function(exports, require, module, __filename, __dirname) {// Copyright 2024 Example Corp
        module.exports=1;console.log("bun!");})
        "
      `);
    },
    run: {
      stdout: "bun!\n",
    },
  });
});
