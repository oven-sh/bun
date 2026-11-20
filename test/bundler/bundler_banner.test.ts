import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { chmodSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { itBundled, type BundlerTestBundleAPI } from "./expectBundled";

// Two entry points that import one module. With `splitting`, that module goes to a chunk that is not an entry point.
const twoEntryPointsAndSharedModule = {
  "/a.js": `import { shared } from "./shared.js"; console.log("a ok", shared());`,
  "/b.js": `import { shared } from "./shared.js"; console.log("b ok", shared());`,
  "/shared.js": `console.log("shared evaluated"); export function shared() { return "shared-value"; }`,
};

// Whether the file system keeps an execute bit in the mode of a file.
const hasExecuteBit = (() => {
  using dir = tempDir("banner-execute-bit", { "file": "" });
  const path = join(String(dir), "file");
  chmodSync(path, 0o755);
  return (statSync(path).mode & 0o111) !== 0;
})();

// The `.js` files of the output directory in name order. `file` has the content hash of a chunk name replaced.
function outputFiles(api: BundlerTestBundleAPI) {
  return readdirSync(api.outdir)
    .filter(file => file.endsWith(".js"))
    .sort()
    .map(file => ({ file: file.replace(/^chunk-\w+/, "chunk-[hash]"), path: join(api.outdir, file) }));
}

// For each output file: its first `lineCount` lines, and whether its mode has an execute bit.
function outputHeaders(api: BundlerTestBundleAPI, lineCount: number) {
  return outputFiles(api).map(({ file, path }) => ({
    file,
    lines: readFileSync(path, "utf8").split("\n").slice(0, lineCount),
    executable: (statSync(path).mode & 0o111) !== 0,
  }));
}

// For each output file: the line that its first `console.log(` is on, and the first line that its source map has a
// mapping for. Both count from 0.
function outputFirstMappedLines(api: BundlerTestBundleAPI) {
  return outputFiles(api).map(({ file, path }) => ({
    file,
    consoleLogLine: readFileSync(path, "utf8")
      .split("\n")
      .findIndex(line => line.startsWith("console.log(")),
    firstMappedLine: JSON.parse(readFileSync(path + ".map", "utf8"))
      .mappings.split(";")
      .findIndex((line: string) => line.length > 0),
  }));
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

  // A hashbang is only valid as the first bytes of a file. A shared chunk is not an entry point, but it gets the
  // `// @bun` pragma too, so the banner's hashbang has to come before that pragma. Only the entry points are executable.
  for (const [name, banner, header] of [
    ["HashbangOnlyBanner", "#!/usr/bin/env bun", ["#!/usr/bin/env bun", "// @bun"]],
    [
      "HashbangBanner",
      "#!/usr/bin/env bun\n// Additional banner content",
      ["#!/usr/bin/env bun", "// @bun", "// Additional banner content"],
    ],
  ] as const) {
    itBundled(`banner/${name}WithSplittingAndTargetBun`, {
      banner,
      format: "esm",
      target: "bun",
      backend: "api",
      outdir: "/out",
      splitting: true,
      chunkNaming: "chunk-[hash].[ext]",
      entryPoints: ["/a.js", "/b.js"],
      files: twoEntryPointsAndSharedModule,
      onAfterBundle(api) {
        expect(outputHeaders(api, header.length)).toEqual([
          { file: "a.js", lines: [...header], executable: hasExecuteBit },
          { file: "b.js", lines: [...header], executable: hasExecuteBit },
          { file: "chunk-[hash].js", lines: [...header], executable: false },
        ]);
      },
      run: {
        file: "/out/a.js",
        stdout: "shared evaluated\na ok shared-value",
      },
    });
  }

  // The same build from the command line. The "cli" backend of itBundled puts the banner in quotes.
  test("banner/HashbangBannerWithSplittingAndTargetBunCLI", async () => {
    using dir = tempDir("banner-hashbang-splitting", {
      "a.js": twoEntryPointsAndSharedModule["/a.js"],
      "b.js": twoEntryPointsAndSharedModule["/b.js"],
      "shared.js": twoEntryPointsAndSharedModule["/shared.js"],
    });

    await using build = Bun.spawn({
      cmd: [
        bunExe(),
        "build",
        "--splitting",
        "--target=bun",
        "--banner",
        "#!/usr/bin/env bun",
        "./a.js",
        "./b.js",
        "--outdir",
        "out",
      ],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, buildStderr, buildExitCode] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
    expect({ stderr: buildStderr, exitCode: buildExitCode }).toEqual({ stderr: "", exitCode: 0 });

    await using proc = Bun.spawn({
      cmd: [bunExe(), join("out", "a.js")],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "shared evaluated\na ok shared-value\n",
      stderr: "",
      exitCode: 0,
    });
  });

  // For another target there is no pragma, so nothing comes before the banner on a shared chunk. The banner is then
  // written as it is, blank line included. An entry point takes the hashbang line out of the banner first.
  itBundled("banner/HashbangBannerWithSplittingAndTargetNode", {
    banner: "#!/usr/bin/env node\n\n// Additional banner content",
    format: "esm",
    target: "node",
    backend: "api",
    outdir: "/out",
    splitting: true,
    chunkNaming: "chunk-[hash].[ext]",
    entryPoints: ["/a.js", "/b.js"],
    files: twoEntryPointsAndSharedModule,
    onAfterBundle(api) {
      expect(outputHeaders(api, 3)).toEqual([
        {
          file: "a.js",
          lines: ["#!/usr/bin/env node", "// Additional banner content", "import {"],
          executable: hasExecuteBit,
        },
        {
          file: "b.js",
          lines: ["#!/usr/bin/env node", "// Additional banner content", "import {"],
          executable: hasExecuteBit,
        },
        {
          file: "chunk-[hash].js",
          lines: ["#!/usr/bin/env node", "", "// Additional banner content"],
          executable: false,
        },
      ]);
    },
    run: {
      file: "/out/a.js",
      stdout: "shared evaluated\na ok shared-value",
    },
  });

  // The entry point's own hashbang is the first line. A second hashbang cannot follow it, so the banner's is left out.
  for (const { name, format, target, expected } of [
    {
      name: "ESMTargetBun",
      format: "esm",
      target: "bun",
      expected: `#!/usr/bin/env node\n// @bun\n// Additional banner content\nconsole.log("ran");\n`,
    },
    {
      name: "CJSTargetBun",
      format: "cjs",
      target: "bun",
      expected:
        "#!/usr/bin/env node\n// @bun @bun-cjs\n" +
        `(function(exports, require, module, __filename, __dirname) {// Additional banner content\nconsole.log("ran");})\n`,
    },
    {
      name: "ESMTargetNode",
      format: "esm",
      target: "node",
      expected: `#!/usr/bin/env node\n// Additional banner content\nconsole.log("ran");\n`,
    },
  ] as const) {
    itBundled(`banner/SourceHashbangWithHashbangBannerAnd${name}`, {
      banner: "#!/usr/bin/env bun\n// Additional banner content",
      format,
      target,
      backend: "api",
      outdir: "/out",
      minifyWhitespace: true,
      files: {
        "/a.js": `#!/usr/bin/env node
console.log("ran");`,
      },
      onAfterBundle(api) {
        expect(api.readFile("/out/a.js")).toBe(expected);
      },
      run: {
        stdout: "ran",
      },
    });
  }

  // Only the hashbang comment of the banner is left out. As in the parser, that comment ends at the first line break,
  // and a lone CR, U+2028 and U+2029 are line breaks too. The text after it is code, and it stays.
  test("banner/SourceHashbangWithHashbangBannerKeepsTheRestOfTheBanner", async () => {
    using dir = tempDir("banner-source-hashbang", { "a.js": `#!/usr/bin/env node\nconsole.log("ran");` });
    // Each banner, and what it leaves between the entry point's hashbang line and its code.
    const cases = [
      ["#!/usr/bin/env bun", ""],
      ["#!/usr/bin/env bun\n", ""],
      ["#!/usr/bin/env bun\n\n// rest", "// rest\n"],
      ["#!/usr/bin/env bun\r\n// rest", "// rest\n"],
      ["#!/usr/bin/env bun\rrest();", "rest();\n"],
      ["#!/usr/bin/env bun\u2028rest();", "rest();\n"],
      ["#!/usr/bin/env bun\u2029rest();", "rest();\n"],
      // U+20AC starts with the same byte as U+2028 and U+2029. It is not a line break.
      ["#!/usr/bin/env \u20AC\nrest();", "rest();\n"],
      ["// no hashbang\nrest();", "// no hashbang\nrest();\n"],
    ];
    const outputs: string[] = [];
    for (const [banner] of cases) {
      const build = await Bun.build({
        entrypoints: [join(String(dir), "a.js")],
        target: "node",
        minify: { whitespace: true },
        banner,
      });
      outputs.push(await build.outputs[0].text());
    }
    expect(outputs).toEqual(cases.map(([, rest]) => `#!/usr/bin/env node\n${rest}console.log("ran");\n`));
  });

  // The target of a dynamic import is an entry point chunk, so it also keeps its own hashbang.
  itBundled("banner/DynamicImportSourceHashbangWithHashbangBannerAndTargetBun", {
    banner: "#!/usr/bin/env bun\n// Additional banner content",
    format: "esm",
    target: "bun",
    backend: "api",
    outdir: "/out",
    splitting: true,
    chunkNaming: "chunk-[hash].[ext]",
    files: {
      "/a.js": `const { value } = await import("./dynamic.js"); console.log("a ok", value);`,
      "/dynamic.js": `#!/usr/bin/env node
export const value = "dynamic-value";`,
    },
    onAfterBundle(api) {
      expect(outputHeaders(api, 3)).toEqual([
        {
          file: "a.js",
          lines: ["#!/usr/bin/env bun", "// @bun", "// Additional banner content"],
          executable: hasExecuteBit,
        },
        {
          file: "chunk-[hash].js",
          lines: ["#!/usr/bin/env node", "// @bun", "// Additional banner content"],
          executable: hasExecuteBit,
        },
      ]);
    },
    run: {
      file: "/out/a.js",
      stdout: "a ok dynamic-value",
    },
  });

  // An entry point that another entry point imports moves to a shared chunk. That chunk is not an entry point, so it
  // takes the banner's hashbang. The hashbang of the file stays on the entry point's own chunk.
  itBundled("banner/ImportedEntryPointSourceHashbangWithHashbangBannerAndTargetBun", {
    banner: "#!/usr/bin/env bun\n// Additional banner content",
    format: "esm",
    target: "bun",
    backend: "api",
    outdir: "/out",
    splitting: true,
    chunkNaming: "chunk-[hash].[ext]",
    entryPoints: ["/a.js", "/b.js"],
    files: {
      "/a.js": `#!/usr/bin/env node
export const a = "a-value"; console.log("a evaluated");`,
      "/b.js": `import { a } from "./a.js"; console.log("b ok", a);`,
    },
    onAfterBundle(api) {
      expect(outputHeaders(api, 3)).toEqual([
        {
          file: "a.js",
          lines: ["#!/usr/bin/env node", "// @bun", "// Additional banner content"],
          executable: hasExecuteBit,
        },
        {
          file: "b.js",
          lines: ["#!/usr/bin/env bun", "// @bun", "// Additional banner content"],
          executable: hasExecuteBit,
        },
        {
          file: "chunk-[hash].js",
          lines: ["#!/usr/bin/env bun", "// @bun", "// Additional banner content"],
          executable: false,
        },
      ]);
    },
    run: {
      file: "/out/b.js",
      stdout: "a evaluated\nb ok a-value",
    },
  });

  // The source map of each chunk counts the hashbang line and the pragma line that come before the banner. The
  // hashbang line of a CRLF banner keeps its CR. That CR and the line feed written after it are one line break.
  for (const [name, lineBreak] of [
    ["", "\n"],
    ["CRLF", "\r\n"],
  ]) {
    itBundled(`banner/SourceMapWithHashbang${name}BannerAndSplitting`, {
      banner: `#!/usr/bin/env bun${lineBreak}// Additional banner content`,
      format: "esm",
      target: "bun",
      backend: "api",
      outdir: "/out",
      splitting: true,
      chunkNaming: "chunk-[hash].[ext]",
      sourceMap: "linked",
      entryPoints: ["/a.js", "/b.js"],
      files: twoEntryPointsAndSharedModule,
      onAfterBundle(api) {
        expect(outputFirstMappedLines(api)).toEqual([
          { file: "a.js", consoleLogLine: 8, firstMappedLine: 8 },
          { file: "b.js", consoleLogLine: 8, firstMappedLine: 8 },
          { file: "chunk-[hash].js", consoleLogLine: 5, firstMappedLine: 5 },
        ]);
      },
      run: {
        file: "/out/a.js",
        stdout: "shared evaluated\na ok shared-value",
      },
    });
  }

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
