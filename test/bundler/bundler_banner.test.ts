import { describe, expect } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { BundlerTestBundleAPI, itBundled } from "./expectBundled";

// api.readFile() normalizes CRLF to LF, so read the raw bytes instead.
function readRawOutput(api: BundlerTestBundleAPI, name: string): string {
  return readFileSync(path.join(api.outdir, name), "utf8");
}

// Asserts that the first generated line with a mapping in `name`.map is the
// line of `name` that `console.log(` is on. Line breaks are counted the way a
// JS parser (and a source map consumer) counts them: a CRLF is one line break.
function expectFirstMappingOnConsoleLogLine(api: BundlerTestBundleAPI, name: string) {
  const outputLines = readRawOutput(api, name).split(/\r\n|\r|\n/);
  const consoleLogLine = outputLines.findIndex(line => line.startsWith("console.log("));
  expect(consoleLogLine).toBeGreaterThan(0);

  const { mappings } = JSON.parse(api.readFile(`/out/${name}.map`));
  const firstMappedLine = mappings.split(";").findIndex((line: string) => line.length > 0);
  expect(firstMappedLine).toBe(consoleLogLine);
}

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

  // `--banner "$(cat banner.txt)"` with a CRLF banner.txt gives a banner whose
  // lines end in "\r\n" and whose last line ends in a bare "\r" (the shell strips
  // the final "\n"). The "\n" the bundler appends completes that "\r\n", which is
  // one line break in the output, and the source map has to be placed accordingly.
  // The hashbang line itself is emitted without the "\r", like a source hashbang.
  for (const [name, banner, expectedOutputPrefix] of [
    ["LFBanner", "#!/usr/bin/env bun\n// banner", "#!/usr/bin/env bun\n// banner\n"],
    ["HashbangEndingInCR", "#!/usr/bin/env bun\r", "#!/usr/bin/env bun\n"],
    ["CRLFHashbangBanner", "#!/usr/bin/env bun\r\n// banner\r\n", "#!/usr/bin/env bun\n// banner\r\n"],
    ["CRLFHashbangBannerEndingInCR", "#!/usr/bin/env bun\r\n// banner\r", "#!/usr/bin/env bun\n// banner\r\n"],
    ["CRLFBannerEndingInCR", "// line one\r\n// line two\r", "// line one\r\n// line two\r\n"],
  ] as const) {
    itBundled(`banner/SourceMapWith${name}`, {
      banner,
      backend: "api",
      outdir: "/out",
      sourceMap: "external",
      files: {
        "/a.js": `console.log("Hello, world!");`,
      },
      onAfterBundle(api) {
        expectFirstMappingOnConsoleLogLine(api, "a.js");
        expect(readRawOutput(api, "a.js")).toStartWith(expectedOutputPrefix);
      },
    });
  }
});
