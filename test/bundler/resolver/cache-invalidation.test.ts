import { describe, expect, test } from "bun:test";
import { promises as fs, writeFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { createRequire } from "module";
import * as path from "path";

// These tests verify that the resolver properly invalidates cache across multiple
// Bun.build() calls in the same process when files/directories are deleted and recreated.
// This tests the fix in src/fs.zig and src/resolver/resolver.zig for generation > 0 behavior.

// Note: Not using describe.concurrent because these tests specifically test
// cache invalidation behavior across multiple Bun.build() calls in the same process,
// and the resolver generation counter is process-global state.
describe("resolver cache invalidation", () => {
  test("directory with index.js deleted then recreated", async () => {
    using dir = tempDir("cache-test-index-js", {
      "entry.js": `export { value } from "./subdir";`,
      "subdir/index.js": `export const value = 42;`,
    });

    const subdirPath = path.join(String(dir), "subdir");

    // Build 1: Should succeed
    const result1 = await Bun.build({
      entrypoints: [path.join(String(dir), "entry.js")],
      outdir: path.join(String(dir), "out1"),
    });
    expect(result1.success).toBe(true);
    const text1 = await result1.outputs[0].text();
    expect(text1).toContain("42");

    // Delete directory
    await fs.rm(subdirPath, { recursive: true });

    // Build 2: Should fail
    let build2Failed = false;
    try {
      const result2 = await Bun.build({
        entrypoints: [path.join(String(dir), "entry.js")],
        outdir: path.join(String(dir), "out2"),
      });
      build2Failed = !result2.success;
    } catch (e) {
      build2Failed = true;
    }
    expect(build2Failed).toBe(true);

    // Recreate directory
    await fs.mkdir(subdirPath);
    await fs.writeFile(path.join(subdirPath, "index.js"), `export const value = 99;`);

    // Build 3: Should succeed with new value
    const result3 = await Bun.build({
      entrypoints: [path.join(String(dir), "entry.js")],
      outdir: path.join(String(dir), "out3"),
    });
    expect(result3.success).toBe(true);
    const text3 = await result3.outputs[0].text();
    expect(text3).toContain("99");
  });

  test("directory with index.ts deleted then recreated", async () => {
    using dir = tempDir("cache-test-index-ts", {
      "entry.ts": `export { add } from "./utils";`,
      "utils/index.ts": `export const add = (a: number, b: number) => a + b;`,
    });

    const utilsPath = path.join(String(dir), "utils");

    // Build 1: Should succeed
    const result1 = await Bun.build({
      entrypoints: [path.join(String(dir), "entry.ts")],
      outdir: path.join(String(dir), "out1"),
    });
    expect(result1.success).toBe(true);

    // Delete directory
    await fs.rm(utilsPath, { recursive: true });

    // Build 2: Should fail
    let build2Failed = false;
    try {
      const result2 = await Bun.build({
        entrypoints: [path.join(String(dir), "entry.ts")],
        outdir: path.join(String(dir), "out2"),
      });
      build2Failed = !result2.success;
    } catch (e) {
      build2Failed = true;
    }
    expect(build2Failed).toBe(true);

    // Recreate directory
    await fs.mkdir(utilsPath);
    await fs.writeFile(path.join(utilsPath, "index.ts"), `export const add = (a: number, b: number) => a * b;`);

    // Build 3: Should succeed with new implementation
    const result3 = await Bun.build({
      entrypoints: [path.join(String(dir), "entry.ts")],
      outdir: path.join(String(dir), "out3"),
    });
    expect(result3.success).toBe(true);
    const text3 = await result3.outputs[0].text();
    // Verify it's using multiplication (new), not addition (old)
    expect(text3).toContain("a * b");
    expect(text3).not.toContain("a + b");
  });

  test("direct file deleted then recreated", async () => {
    using dir = tempDir("cache-test-direct-file", {
      "entry.js": `export { config } from "./config.js";`,
      "config.js": `export const config = { version: 1 };`,
    });

    const configPath = path.join(String(dir), "config.js");

    // Build 1: Should succeed
    const result1 = await Bun.build({
      entrypoints: [path.join(String(dir), "entry.js")],
      outdir: path.join(String(dir), "out1"),
    });
    expect(result1.success).toBe(true);
    const text1 = await result1.outputs[0].text();
    expect(text1).toContain("1");

    // Delete file
    await fs.rm(configPath);

    // Build 2: Should fail
    let build2Failed = false;
    try {
      const result2 = await Bun.build({
        entrypoints: [path.join(String(dir), "entry.js")],
        outdir: path.join(String(dir), "out2"),
      });
      build2Failed = !result2.success;
    } catch (e) {
      build2Failed = true;
    }
    expect(build2Failed).toBe(true);

    // Recreate file with new content
    await fs.writeFile(configPath, `export const config = { version: 2 };`);

    // Build 3: Should succeed with new content
    const result3 = await Bun.build({
      entrypoints: [path.join(String(dir), "entry.js")],
      outdir: path.join(String(dir), "out3"),
    });
    expect(result3.success).toBe(true);
    const text3 = await result3.outputs[0].text();
    expect(text3).toContain("2");
  });

  test("nested directory deleted then recreated", async () => {
    using dir = tempDir("cache-test-nested", {
      "entry.js": `export { value } from "./deep/nested/module.js";`,
      "deep/nested/module.js": `export const value = "original";`,
    });

    const deepPath = path.join(String(dir), "deep");

    // Build 1: Should succeed
    const result1 = await Bun.build({
      entrypoints: [path.join(String(dir), "entry.js")],
      outdir: path.join(String(dir), "out1"),
    });
    expect(result1.success).toBe(true);

    // Delete parent directory
    await fs.rm(deepPath, { recursive: true });

    // Build 2: Should fail
    let build2Failed = false;
    try {
      const result2 = await Bun.build({
        entrypoints: [path.join(String(dir), "entry.js")],
        outdir: path.join(String(dir), "out2"),
      });
      build2Failed = !result2.success;
    } catch (e) {
      build2Failed = true;
    }
    expect(build2Failed).toBe(true);

    // Recreate directory structure
    const nestedPath = path.join(deepPath, "nested");
    await fs.mkdir(deepPath);
    await fs.mkdir(nestedPath);
    await fs.writeFile(path.join(nestedPath, "module.js"), `export const value = "recreated";`);

    // Build 3: Should succeed
    const result3 = await Bun.build({
      entrypoints: [path.join(String(dir), "entry.js")],
      outdir: path.join(String(dir), "out3"),
    });
    expect(result3.success).toBe(true);
    const text3 = await result3.outputs[0].text();
    expect(text3).toContain("recreated");
  });

  test("extension resolution after file deletion", async () => {
    using dir = tempDir("cache-test-extension", {
      "entry.js": `export { helper } from "./helper";`,
      "helper.js": `export const helper = "js version";`,
    });

    const helperJsPath = path.join(String(dir), "helper.js");
    const helperTsPath = path.join(String(dir), "helper.ts");

    // Build 1: Resolves to .js
    const result1 = await Bun.build({
      entrypoints: [path.join(String(dir), "entry.js")],
      outdir: path.join(String(dir), "out1"),
    });
    expect(result1.success).toBe(true);
    const text1 = await result1.outputs[0].text();
    expect(text1).toContain("js version");

    // Delete .js file
    await fs.rm(helperJsPath);

    // Build 2: Should fail
    let build2Failed = false;
    try {
      const result2 = await Bun.build({
        entrypoints: [path.join(String(dir), "entry.js")],
        outdir: path.join(String(dir), "out2"),
      });
      build2Failed = !result2.success;
    } catch (e) {
      build2Failed = true;
    }
    expect(build2Failed).toBe(true);

    // Create .ts file instead
    await fs.writeFile(helperTsPath, `export const helper = "ts version";`);

    // Build 3: Should resolve to .ts
    const result3 = await Bun.build({
      entrypoints: [path.join(String(dir), "entry.js")],
      outdir: path.join(String(dir), "out3"),
    });
    expect(result3.success).toBe(true);
    const text3 = await result3.outputs[0].text();
    expect(text3).toContain("ts version");
  });

  test("package.json exports field after deletion and recreation", async () => {
    using dir = tempDir("cache-test-pkg-exports", {
      "entry.js": `export { value } from "mypkg";`,
      "node_modules/mypkg/package.json": JSON.stringify({
        name: "mypkg",
        exports: {
          ".": "./dist/index.js",
        },
      }),
      "node_modules/mypkg/dist/index.js": `export const value = "v1";`,
    });

    const pkgPath = path.join(String(dir), "node_modules", "mypkg");
    const distPath = path.join(pkgPath, "dist");

    // Build 1: Should resolve via exports
    const result1 = await Bun.build({
      entrypoints: [path.join(String(dir), "entry.js")],
      outdir: path.join(String(dir), "out1"),
    });
    expect(result1.success).toBe(true);
    const text1 = await result1.outputs[0].text();
    expect(text1).toContain("v1");

    // Delete dist directory
    await fs.rm(distPath, { recursive: true });

    // Build 2: Should fail
    let build2Failed = false;
    try {
      const result2 = await Bun.build({
        entrypoints: [path.join(String(dir), "entry.js")],
        outdir: path.join(String(dir), "out2"),
      });
      build2Failed = !result2.success;
    } catch (e) {
      build2Failed = true;
    }
    expect(build2Failed).toBe(true);

    // Recreate dist with new version
    await fs.mkdir(distPath);
    await fs.writeFile(path.join(distPath, "index.js"), `export const value = "v2";`);

    // Build 3: Should succeed with new version
    const result3 = await Bun.build({
      entrypoints: [path.join(String(dir), "entry.js")],
      outdir: path.join(String(dir), "out3"),
    });
    expect(result3.success).toBe(true);
    const text3 = await result3.outputs[0].text();
    expect(text3).toContain("v2");
  });

  test("bare import with local node_modules after deletion", async () => {
    using dir = tempDir("cache-test-bare-import", {
      "entry.js": `export { value } from "mylib";`,
      "node_modules/mylib/index.js": `export const value = "v1";`,
      "node_modules/mylib/package.json": JSON.stringify({ name: "mylib" }),
    });

    const nodeModulesMylib = path.join(String(dir), "node_modules", "mylib");

    // Build 1: Should resolve to node_modules
    const result1 = await Bun.build({
      entrypoints: [path.join(String(dir), "entry.js")],
      outdir: path.join(String(dir), "out1"),
    });
    expect(result1.success).toBe(true);
    const text1 = await result1.outputs[0].text();
    expect(text1).toContain("v1");

    // Delete node_modules/mylib
    await fs.rm(nodeModulesMylib, { recursive: true });

    // Build 2: Should fail (no fallback for bare imports)
    let build2Failed = false;
    try {
      const result2 = await Bun.build({
        entrypoints: [path.join(String(dir), "entry.js")],
        outdir: path.join(String(dir), "out2"),
      });
      build2Failed = !result2.success;
    } catch (e) {
      build2Failed = true;
    }
    expect(build2Failed).toBe(true);

    // Recreate node_modules/mylib with new version
    await fs.mkdir(nodeModulesMylib, { recursive: true });
    await fs.writeFile(path.join(nodeModulesMylib, "package.json"), JSON.stringify({ name: "mylib" }));
    await fs.writeFile(path.join(nodeModulesMylib, "index.js"), `export const value = "v2";`);

    // Build 3: Should succeed with new version
    const result3 = await Bun.build({
      entrypoints: [path.join(String(dir), "entry.js")],
      outdir: path.join(String(dir), "out3"),
    });
    expect(result3.success).toBe(true);
    const text3 = await result3.outputs[0].text();
    expect(text3).toContain("v2");
  });

  test("a package installed after a build that missed it", async () => {
    using dir = tempDir("cache-test-late-package", {
      "entry.js": `export { value } from "latelib";`,
      "node_modules/.keep": "",
    });

    // Build 1: the package is not there, and the miss is cached
    const result1 = await Bun.build({
      entrypoints: [path.join(String(dir), "entry.js")],
      outdir: path.join(String(dir), "out1"),
      throw: false,
    });
    expect(result1.success).toBe(false);

    const latelib = path.join(String(dir), "node_modules", "latelib");
    await fs.mkdir(latelib);
    await fs.writeFile(path.join(latelib, "package.json"), JSON.stringify({ name: "latelib" }));
    await fs.writeFile(path.join(latelib, "index.js"), `export const value = "late";`);

    // Build 2: finds the package
    const result2 = await Bun.build({
      entrypoints: [path.join(String(dir), "entry.js")],
      outdir: path.join(String(dir), "out2"),
    });
    expect(result2.success).toBe(true);
    expect(await result2.outputs[0].text()).toContain("late");
  });

  test("sibling directory resolution after parent deletion", async () => {
    using dir = tempDir("cache-test-sibling", {
      "src/index.js": `export { helper } from "../lib/helper.js";`,
      "lib/helper.js": `export const helper = "original";`,
    });

    const libPath = path.join(String(dir), "lib");

    // Build 1: Should resolve sibling directory
    const result1 = await Bun.build({
      entrypoints: [path.join(String(dir), "src", "index.js")],
      outdir: path.join(String(dir), "out1"),
    });
    expect(result1.success).toBe(true);

    // Delete lib directory
    await fs.rm(libPath, { recursive: true });

    // Build 2: Should fail
    let build2Failed = false;
    try {
      const result2 = await Bun.build({
        entrypoints: [path.join(String(dir), "src", "index.js")],
        outdir: path.join(String(dir), "out2"),
      });
      build2Failed = !result2.success;
    } catch (e) {
      build2Failed = true;
    }
    expect(build2Failed).toBe(true);

    // Recreate lib directory
    await fs.mkdir(libPath);
    await fs.writeFile(path.join(libPath, "helper.js"), `export const helper = "recreated";`);

    // Build 3: Should succeed
    const result3 = await Bun.build({
      entrypoints: [path.join(String(dir), "src", "index.js")],
      outdir: path.join(String(dir), "out3"),
    });
    expect(result3.success).toBe(true);
    const text3 = await result3.outputs[0].text();
    expect(text3).toContain("recreated");
  });

  // A build checks the config files of each directory that it reads. A lookup at the runtime that fails reads them
  // again for its own directory and not for the ones below it: the next build must not take the new aliases for the
  // files of that directory and the old ones for the files below it.
  test.each([
    ["and nothing else", false],
    ["and a lookup from the directory of the config files that fails", true],
  ])("config files edited between two builds are read again for every directory below them, %s", async (_, fails) => {
    const aliases = (target: string) =>
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@lib": [target] } } });
    const manifest = (target: string) => JSON.stringify({ name: "config-edit", imports: { "#lib": target } });
    const user = `import { lib } from "@lib"; import { lib as imported } from "#lib"; export default [lib, imported];`;
    using dir = tempDir("cache-test-config-edit", {
      // With a node_modules in sight, the lookup that fails does not ask the registry for a package.
      "node_modules/.keep": "",
      "tsconfig.json": aliases("./lib/old.ts"),
      "package.json": manifest("./lib/old.ts"),
      "lib/old.ts": `export const lib = "old";`,
      "lib/new.ts": `export const lib = "new";`,
      "top.ts": user,
      "src/a/one.ts": user,
      "src/b/deep/two.ts": user,
      "entry.ts": `import top from "./top"; import one from "./src/a/one"; import two from "./src/b/deep/two"; console.log(top, one, two);`,
    });
    const root = String(dir);
    // What each file got for "@lib" and for "#lib".
    const build = async () => {
      const result = await Bun.build({ entrypoints: [path.join(root, "entry.ts")], metafile: true });
      const answers: Record<string, string> = {};
      for (const [file, input] of Object.entries(result.metafile!.inputs)) {
        const name = path.basename(file, ".ts");
        if (name !== "entry" && name !== "old" && name !== "new") {
          answers[name] = input.imports.map(it => path.basename(it.path, ".ts")).join(" ");
        }
      }
      return answers;
    };
    expect(await build()).toEqual({ top: "old old", one: "old old", two: "old old" });

    writeFileSync(path.join(root, "tsconfig.json"), aliases("./lib/new.ts"));
    writeFileSync(path.join(root, "package.json"), manifest("./lib/new.ts"));
    if (fails) {
      const lookup = () => createRequire(path.join(root, "x.cjs")).resolve("@not-there");
      expect(lookup).toThrow("Cannot find module '@not-there'");
    }

    expect(await build()).toEqual({ top: "new new", one: "new new", two: "new new" });
  });

  // The second build takes the record of sub/ as the first one left it, and says again what the first one read there.
  test("a config file that does not parse fails each build of its project", async () => {
    using dir = tempDir("cache-test-unparsed-config", {
      "entry.ts": `import { value } from "./sub/mod.ts"; console.log(value);`,
      "sub/mod.ts": `export const value = 1;`,
      "sub/tsconfig.json": `{ "compilerOptions": { "paths": `,
    });
    const build = async () => {
      const result = await Bun.build({ entrypoints: [path.join(String(dir), "entry.ts")], throw: false });
      return { success: result.success, logs: result.logs.map(log => log.message) };
    };
    const first = await build();
    expect(first).toEqual({ success: false, logs: ["Unexpected end of file"] });
    expect(await build()).toEqual(first);
  });

  test("a lookup that finds its module when it is run again keeps the error of the config file it read", async () => {
    using dir = tempDir("cache-test-rerun-keeps-config-error", {
      "entry.js": `import { early } from "./lib/early.js"; import { value } from "./pkg"; console.log(early, value);`,
      "lib/early.js": `export const early = 1;`,
      "pkg/package.json": JSON.stringify({ name: "pkg", main: "../lib/late.js" }),
      "pkg/tsconfig.json": `{ "compilerOptions": { "paths": `,
    });
    const root = String(dir);
    // The build has listed lib/ for the first import. The plugin writes lib/late.js and declines, so the lookup of
    // "./pkg" reads pkg/ for the first time, with its tsconfig.json, and misses in lib/. It finds lib/late.js when it
    // is run again.
    const writesTheMainFile: Bun.BunPlugin = {
      name: "writes-the-main-file",
      setup(build) {
        build.onResolve({ filter: /^\.\/pkg$/ }, () => {
          writeFileSync(path.join(root, "lib", "late.js"), `export const value = 2;`);
          return undefined;
        });
      },
    };
    const result = await Bun.build({
      entrypoints: [path.join(root, "entry.js")],
      plugins: [writesTheMainFile],
      throw: false,
    });
    expect({ success: result.success, logs: result.logs.map(log => log.message) }).toEqual({
      success: false,
      logs: ["Unexpected end of file"],
    });
  });

  // A build reads the tsconfig.json and the .env of the working directory before its first lookup: as they are then.
  // The .env is new: a build opens one only when the listing of that directory has it. The jsx factory of that read
  // goes to part.tsx, whose import a plugin declines. The entry gets the one that its own lookup read.
  test("a build takes the paths, the jsx factory and the .env that were written since the build before it", async () => {
    using dir = tempDir("cache-test-build-config", {
      "package.json": `{}`,
      "tsconfig.json": JSON.stringify({
        compilerOptions: { jsx: "react", jsxFactory: "h1", paths: { "@lib": ["./a.ts"] } },
      }),
      "a.ts": `export const v = "lib-a";\n`,
      "b.ts": `export const v = "lib-b";\n`,
      "src/part.tsx": `export default <span />;\n`,
      "src/entry.tsx": `
        import { v } from "@lib";
        import part from "./part.tsx";
        console.log(<div />, part, v, process.env.LATE_VALUE);
      `,
      "driver.ts": `
        import { writeFileSync } from "node:fs";
        const declines = {
          name: "declines",
          setup(build) {
            build.onResolve({ filter: /part\\.tsx$/ }, () => undefined);
          },
        };
        const build = async () => {
          const result = await Bun.build({
            entrypoints: ["./src/entry.tsx"],
            env: "inline",
            plugins: [declines],
            throw: false,
          });
          if (!result.success) return result.logs.map(log => log.message).join(" | ");
          const text = await result.outputs[0].text();
          const env = text.includes("from-dot-env") ? "the .env" : "no .env";
          return [text.match(/lib-[ab]/)?.[0], [...text.matchAll(/\\bh[12]\\b/g)].join("+"), env].join(", ");
        };
        console.log(await build());
        const compilerOptions = { jsx: "react", jsxFactory: "h2", paths: { "@lib": ["./b.ts"] } };
        writeFileSync("tsconfig.json", JSON.stringify({ compilerOptions }));
        writeFileSync(".env", "LATE_VALUE=from-dot-env\\n");
        console.log(await build());
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "driver.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "lib-a, h1+h1, no .env\nlib-b, h2+h2, the .env\n",
      stderr: "",
      exitCode: 0,
    });
  });
});
