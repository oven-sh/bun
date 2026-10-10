import { describe, expect, test } from "bun:test";
import { promises as fs, mkdirSync, symlinkSync, unlinkSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import * as path from "path";

// These tests verify that a Bun.build() call does not resolve from what an earlier
// Bun.build() call, or the runtime, cached in the same process. Every build has its
// own directory cache (src/resolver/dir_cache.rs) and reads each directory from disk.

// Note: Not using describe.concurrent because these tests specifically test
// what one Bun.build() call leaves behind for the next one in the same process.
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
});

// One process per build always gives these results. A build must give them too
// when the process has built, or resolved, the same project before.
describe("a build reads the file system as it is when Bun.build() is called", () => {
  const tsconfigPaths = (dir: string) => JSON.stringify({ compilerOptions: { paths: { "@lib/*": [`./${dir}/*`] } } });
  const usesAlias = `import { from } from "@lib/mod"; console.log(from);`;
  const usesPackage = `import { from } from "pkg"; console.log(from);`;
  const exportsFrom = (name: string) => `export const from = "from ${name}";`;
  const notInstalled = `Could not resolve: "pkg". Maybe you need to "bun install"?`;

  function write(dir: string, file: string, contents: string) {
    file = path.join(dir, file);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, contents);
  }

  // The string that index.ts prints, or the build errors.
  async function bundled(dir: string, options: Partial<Bun.BuildConfig> = {}) {
    const result = await Bun.build({ entrypoints: [path.join(dir, "index.ts")], throw: false, ...options });
    if (!result.success) return result.logs.map(log => log.message);
    return (await result.outputs[0].text()).match(/"from [^"]*"/)?.[0];
  }

  describe("after another build", () => {
    test("tsconfig.json paths changed", async () => {
      using tmp = tempDir("build-fresh-paths", {
        "index.ts": usesAlias,
        "v1/mod.ts": exportsFrom("v1"),
        "v2/mod.ts": exportsFrom("v2"),
        "tsconfig.json": tsconfigPaths("v1"),
      });
      const dir = String(tmp);
      const before = await bundled(dir);
      write(dir, "tsconfig.json", tsconfigPaths("v2"));
      expect([before, await bundled(dir)]).toEqual(['"from v1"', '"from v2"']);
    });

    test("tsconfig.json created", async () => {
      using tmp = tempDir("build-fresh-tsconfig", {
        "index.ts": usesAlias,
        "v1/mod.ts": exportsFrom("v1"),
      });
      const dir = String(tmp);
      const before = await bundled(dir);
      write(dir, "tsconfig.json", tsconfigPaths("v1"));
      expect([before, await bundled(dir)]).toEqual([
        [`Could not resolve: "@lib/mod". Maybe you need to "bun install"?`],
        '"from v1"',
      ]);
    });

    test("package.json main changed", async () => {
      using tmp = tempDir("build-fresh-main", {
        "index.ts": usesPackage,
        "node_modules/pkg/a.js": exportsFrom("a"),
        "node_modules/pkg/b.js": exportsFrom("b"),
        "node_modules/pkg/package.json": `{ "name": "pkg", "main": "./a.js" }`,
      });
      const dir = String(tmp);
      const before = await bundled(dir);
      write(dir, "node_modules/pkg/package.json", `{ "name": "pkg", "main": "./b.js" }`);
      expect([before, await bundled(dir)]).toEqual(['"from a"', '"from b"']);
    });

    test("package installed, then removed", async () => {
      using tmp = tempDir("build-fresh-install", { "index.ts": usesPackage });
      const dir = String(tmp);
      const before = await bundled(dir);
      write(dir, "node_modules/pkg/index.js", exportsFrom("pkg"));
      write(dir, "node_modules/pkg/package.json", `{ "name": "pkg", "main": "./index.js" }`);
      const installed = await bundled(dir);
      await fs.rm(path.join(dir, "node_modules"), { recursive: true });
      expect([before, installed, await bundled(dir)]).toEqual([[notInstalled], '"from pkg"', [notInstalled]]);
    });

    test.skipIf(isWindows)("directory symlink retargeted", async () => {
      using tmp = tempDir("build-fresh-symlink", {
        "index.ts": `import { from } from "./link/mod"; console.log(from);`,
        "v1/mod.ts": exportsFrom("v1"),
        "v2/mod.ts": exportsFrom("v2"),
      });
      const dir = String(tmp);
      symlinkSync("v1", path.join(dir, "link"));
      const before = await bundled(dir);
      unlinkSync(path.join(dir, "link"));
      symlinkSync("v2", path.join(dir, "link"));
      expect([before, await bundled(dir)]).toEqual(['"from v1"', '"from v2"']);
    });

    // Nothing changes on disk. The two builds read different main fields
    // from the same package.json.
    test("another target", async () => {
      using tmp = tempDir("build-fresh-target", {
        "index.ts": usesPackage,
        "node_modules/pkg/main.js": exportsFrom("main"),
        "node_modules/pkg/browser.js": exportsFrom("browser"),
        "node_modules/pkg/package.json": `{ "name": "pkg", "main": "./main.js", "browser": "./browser.js" }`,
      });
      const dir = String(tmp);
      expect([await bundled(dir, { target: "node" }), await bundled(dir, { target: "browser" })]).toEqual([
        '"from main"',
        '"from browser"',
      ]);
    });

    // The build waits in the queue of the bundle thread behind a build that an
    // async onLoad holds open. It was queued after the file was written.
    test("a build that was queued behind it", async () => {
      using tmp = tempDir("build-fresh-queued", {
        "index.ts": `import { from } from "./generated"; console.log(from);`,
        "parked.ts": `import "parked:module";`,
      });
      const dir = String(tmp);
      const gate = Promise.withResolvers<void>();
      const entered = Promise.withResolvers<void>();
      const before = await bundled(dir);
      const parked = Bun.build({
        entrypoints: [path.join(dir, "parked.ts")],
        throw: false,
        plugins: [
          {
            name: "park",
            setup(build) {
              build.onResolve({ filter: /^parked:/ }, args => ({ path: args.path, namespace: "parked" }));
              build.onLoad({ filter: /.*/, namespace: "parked" }, async () => {
                entered.resolve();
                await gate.promise;
                return { contents: "export default 1;", loader: "js" };
              });
            },
          },
        ],
      });
      await entered.promise;
      write(dir, "generated.ts", exportsFrom("generated"));
      const queued = bundled(dir);
      gate.resolve();
      expect([before, await queued, (await parked).success]).toEqual([
        ['Could not resolve: "./generated"'],
        '"from generated"',
        true,
      ]);
    });
  });

  describe("after the runtime resolved from the same directories", () => {
    test("tsconfig.json paths changed", async () => {
      using tmp = tempDir("build-fresh-runtime-paths", {
        "index.ts": usesAlias,
        "v1/mod.ts": exportsFrom("v1"),
        "v2/mod.ts": exportsFrom("v2"),
        "tsconfig.json": tsconfigPaths("v1"),
      });
      const dir = String(tmp);
      const resolved = path.relative(dir, Bun.resolveSync("@lib/mod", dir));
      write(dir, "tsconfig.json", tsconfigPaths("v2"));
      expect([resolved, await bundled(dir)]).toEqual([path.join("v1", "mod.ts"), '"from v2"']);
    });

    test("package installed", async () => {
      using tmp = tempDir("build-fresh-runtime-install", { "index.ts": usesPackage, "package.json": "{}" });
      const dir = String(tmp);
      expect(() => Bun.resolveSync("./node_modules/pkg/index.js", dir)).toThrow();
      write(dir, "node_modules/pkg/index.js", exportsFrom("pkg"));
      write(dir, "node_modules/pkg/package.json", `{ "name": "pkg", "main": "./index.js" }`);
      expect(await bundled(dir)).toBe('"from pkg"');
    });

    // The runtime reads "main" from the package.json. The build is for the
    // browser and reads "browser".
    test("package built for another target", async () => {
      using tmp = tempDir("build-fresh-runtime-target", {
        "index.ts": usesPackage,
        "node_modules/pkg/main.js": exportsFrom("main"),
        "node_modules/pkg/browser.js": exportsFrom("browser"),
        "node_modules/pkg/package.json": `{ "name": "pkg", "main": "./main.js", "browser": "./browser.js" }`,
      });
      const dir = String(tmp);
      const resolved = path.relative(dir, Bun.resolveSync("pkg", dir));
      expect([resolved, await bundled(dir, { target: "browser" })]).toEqual([
        path.join("node_modules", "pkg", "main.js"),
        '"from browser"',
      ]);
    });

    // The first build of a process: the runtime listed the directory to
    // resolve the script, before the script wrote the file.
    test("file written by the script that builds", async () => {
      using tmp = tempDir("build-fresh-first-build", {
        "index.ts": `import { from } from "./generated"; console.log(from);`,
        "build.ts": `
          import { writeFileSync } from "node:fs";
          writeFileSync("./generated.ts", 'export const from = "from generated";');
          const result = await Bun.build({ entrypoints: ["./index.ts"], throw: false });
          console.log(result.success ? "ok" : result.logs.map(log => log.message).join("; "));
        `,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "build.ts"],
        env: bunEnv,
        cwd: String(tmp),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout).toBe("ok\n");
      expect(exitCode).toBe(0);
    });
  });
});
