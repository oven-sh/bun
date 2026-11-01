import { describe, expect, test } from "bun:test";
import { existsSync, promises as fs, mkdirSync, symlinkSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { createRequire } from "module";
import * as path from "path";

// These tests verify that the resolver properly invalidates cache at runtime
// when using require() across file system changes within the same process.
// These test the same cache invalidation logic as the Bun.build tests but for runtime require().

describe.concurrent("runtime cache invalidation", () => {
  test("directory with index.js deleted then recreated", async () => {
    using dir = tempDir("runtime-cache-index-js", {
      "subdir/index.js": `module.exports = { value: 42 };`,
    });

    const subdirPath = path.join(String(dir), "subdir");
    const requirePath = subdirPath;

    // Require 1: Should succeed
    const result1 = require(requirePath);
    expect(result1.value).toBe(42);

    // Clear require cache
    const resolvedPath = require.resolve(requirePath);
    delete require.cache[resolvedPath];

    // Delete directory
    await fs.rm(subdirPath, { recursive: true });

    // Require 2: Should fail
    let require2Failed = false;
    try {
      require(requirePath);
    } catch (e) {
      require2Failed = true;
    }
    expect(require2Failed).toBe(true);

    // Recreate directory with new content
    await fs.mkdir(subdirPath);
    await fs.writeFile(path.join(subdirPath, "index.js"), `module.exports = { value: 99 };`);

    // Require 3: Should succeed with new value
    const result3 = require(requirePath);
    expect(result3.value).toBe(99);
  });

  test("direct file deleted then recreated", async () => {
    using dir = tempDir("runtime-cache-direct-file", {
      "config.js": `module.exports = { version: 1 };`,
    });

    const configPath = path.join(String(dir), "config.js");

    // Require 1: Should succeed
    const result1 = require(configPath);
    expect(result1.version).toBe(1);

    // Clear require cache
    const resolvedPath = require.resolve(configPath);
    delete require.cache[resolvedPath];

    // Delete file
    await fs.rm(configPath);

    // Require 2: Should fail
    let require2Failed = false;
    try {
      require(configPath);
    } catch (e) {
      require2Failed = true;
    }
    expect(require2Failed).toBe(true);

    // Recreate file with new content
    await fs.writeFile(configPath, `module.exports = { version: 2 };`);

    // Require 3: Should succeed with new value
    const result3 = require(configPath);
    expect(result3.version).toBe(2);
  });

  test("nested directory deleted then recreated", async () => {
    using dir = tempDir("runtime-cache-nested", {
      "deep/nested/module.js": `module.exports = { value: "original" };`,
    });

    const modulePath = path.join(String(dir), "deep", "nested", "module.js");
    const deepPath = path.join(String(dir), "deep");

    // Require 1: Should succeed
    const result1 = require(modulePath);
    expect(result1.value).toBe("original");

    // Clear require cache
    delete require.cache[require.resolve(modulePath)];

    // Delete parent directory
    await fs.rm(deepPath, { recursive: true });

    // Require 2: Should fail
    let require2Failed = false;
    try {
      require(modulePath);
    } catch (e) {
      require2Failed = true;
    }
    expect(require2Failed).toBe(true);

    // Recreate directory structure
    const nestedPath = path.join(deepPath, "nested");
    await fs.mkdir(deepPath);
    await fs.mkdir(nestedPath);
    await fs.writeFile(path.join(nestedPath, "module.js"), `module.exports = { value: "recreated" };`);

    // Require 3: Should succeed
    const result3 = require(modulePath);
    expect(result3.value).toBe("recreated");
  });
});

// The resolver keeps one listing per directory for the life of the process. A lookup that misses
// runs once more at a fresh generation, so each listing it consults is read again. These cases
// create the file or the package after the resolver has read the directory.
describe.concurrent("a file or package created after the resolver read its directory", () => {
  const link = (target: string, at: string) => symlinkSync(target, at, isWindows ? "junction" : "dir");

  test("a file added to a package under node_modules (#47608)", async () => {
    using dir = tempDir("runtime-cache-late-file", {
      "node_modules/@pk/a.ts": `export const a = 1;`,
    });
    const root = String(dir);
    const req = createRequire(path.join(root, "main.ts"));

    expect(req("@pk/a.ts")).toEqual({ a: 1 });
    writeFileSync(path.join(root, "node_modules", "@pk", "b.ts"), `export const b = 2;`);
    expect(req("@pk/b.ts")).toEqual({ b: 2 });
    expect(Bun.resolveSync("@pk/b.ts", root)).toBe(path.join(root, "node_modules", "@pk", "b.ts"));
  });

  test("a file added to a package that node_modules links to, the script from #47608", async () => {
    using dir = tempDir("runtime-cache-late-file-link", {
      "pk/a.ts": `export const a = 1;`,
      "node_modules/.keep": "",
    });
    const root = String(dir);
    const pk = path.join(root, "pk");
    link(pk, path.join(root, "node_modules", "@pk"));
    const req = createRequire(path.join(root, "main.ts"));

    expect(req("@pk/a.ts")).toEqual({ a: 1 });
    writeFileSync(path.join(pk, "b.ts"), `export const b = 2;`);
    expect(existsSync(path.join(pk, "b.ts"))).toBe(true);
    expect(req(path.join(pk, "b.ts"))).toEqual({ b: 2 });
    expect(req("@pk/b.ts")).toEqual({ b: 2 });
  });

  test("a package subpath that missed, then was written", async () => {
    using dir = tempDir("runtime-cache-miss-then-write", {
      "node_modules/@pk/a.ts": `export const a = 1;`,
    });
    const root = String(dir);
    const req = createRequire(path.join(root, "main.ts"));

    expect(req("@pk/a.ts")).toEqual({ a: 1 });
    expect(() => req("@pk/c.ts")).toThrow("Cannot find module '@pk/c.ts'");
    writeFileSync(path.join(root, "node_modules", "@pk", "c.ts"), `export const c = 3;`);
    expect(req("@pk/c.ts")).toEqual({ c: 3 });
    expect((await import(path.join(root, "node_modules", "@pk", "c.ts"))).c).toBe(3);
  });

  test("a package added to a node_modules that was read, after a miss", async () => {
    using dir = tempDir("runtime-cache-late-package", {
      "node_modules/warm/index.js": `module.exports = "warm";`,
    });
    const root = String(dir);
    const req = createRequire(path.join(root, "main.js"));

    expect(req("warm")).toBe("warm");
    expect(() => req("late-pkg")).toThrow("Cannot find module 'late-pkg'");
    mkdirSync(path.join(root, "node_modules", "late-pkg"));
    writeFileSync(
      path.join(root, "node_modules", "late-pkg", "package.json"),
      `{ "name": "late-pkg", "main": "lib.js" }`,
    );
    writeFileSync(path.join(root, "node_modules", "late-pkg", "lib.js"), `module.exports = "late";`);
    expect(req("late-pkg")).toBe("late");
  });

  test("a node_modules created next to the importer after a miss", async () => {
    using dir = tempDir("runtime-cache-late-node-modules", {
      "main.js": "",
    });
    const root = String(dir);
    const req = createRequire(path.join(root, "main.js"));

    expect(() => req("late-pkg")).toThrow("Cannot find module 'late-pkg'");
    mkdirSync(path.join(root, "node_modules", "late-pkg"), { recursive: true });
    writeFileSync(path.join(root, "node_modules", "late-pkg", "index.js"), `module.exports = "late";`);
    expect(req("late-pkg")).toBe("late");
  });

  test("a node_modules created in an ancestor of the importer after a miss", async () => {
    using dir = tempDir("runtime-cache-late-ancestor-node-modules", {
      "app/src/lib/main.js": "",
    });
    const root = String(dir);
    const req = createRequire(path.join(root, "app", "src", "lib", "main.js"));

    expect(() => req("late-pkg")).toThrow("Cannot find module 'late-pkg'");
    mkdirSync(path.join(root, "app", "node_modules", "late-pkg"), { recursive: true });
    writeFileSync(path.join(root, "app", "node_modules", "late-pkg", "index.js"), `module.exports = "late";`);
    expect(req("late-pkg")).toBe("late");
  });

  test("a package installed under a `paths` entry after a miss", async () => {
    using dir = tempDir("runtime-cache-late-paths-root", {
      "other/.keep": "",
      "main.js": "",
    });
    const root = String(dir);
    const req = createRequire(path.join(root, "main.js"));
    const other = path.join(root, "other");

    expect(() => req.resolve("late-pkg", { paths: [other] })).toThrow("Cannot find module 'late-pkg'");
    mkdirSync(path.join(other, "node_modules", "late-pkg"), { recursive: true });
    writeFileSync(path.join(other, "node_modules", "late-pkg", "index.js"), `module.exports = "late";`);
    expect(req.resolve("late-pkg", { paths: [other] })).toBe(path.join(other, "node_modules", "late-pkg", "index.js"));
  });

  test("an imports entry added to the package.json next to the importer after a miss", async () => {
    using dir = tempDir("runtime-cache-edited-package-json", {
      "package.json": `{ "name": "app", "imports": { "#a": "./a.js" } }`,
      "a.js": `module.exports = "a";`,
      "b.js": `module.exports = "b";`,
      "main.js": "",
    });
    const root = String(dir);
    const req = createRequire(path.join(root, "main.js"));

    expect(req("#a")).toBe("a");
    expect(() => req("#b")).toThrow("Cannot find module '#b'");
    writeFileSync(path.join(root, "package.json"), `{ "name": "app", "imports": { "#a": "./a.js", "#b": "./b.js" } }`);
    expect(req("#b")).toBe("b");
  });

  test("a link in node_modules whose target is created after a miss", async () => {
    using dir = tempDir("runtime-cache-link-target-later", {
      "node_modules/.keep": "",
      "main.js": "",
    });
    const root = String(dir);
    const req = createRequire(path.join(root, "main.js"));
    const target = path.join(root, "store", "linked");
    link(target, path.join(root, "node_modules", "linked"));

    expect(() => req("linked")).toThrow("Cannot find module 'linked'");
    mkdirSync(target, { recursive: true });
    writeFileSync(path.join(target, "index.js"), `module.exports = "linked";`);
    expect(req("linked")).toBe("linked");
  });

  test("a file added under the directory an exports map points at", async () => {
    using dir = tempDir("runtime-cache-late-exports-target", {
      "node_modules/@pk/lib/package.json": `{ "name": "@pk/lib", "exports": { "./*": "./dist/*.js" } }`,
      "node_modules/@pk/lib/dist/a.js": `module.exports = "a";`,
    });
    const root = String(dir);
    const req = createRequire(path.join(root, "main.js"));

    expect(req("@pk/lib/a")).toBe("a");
    writeFileSync(path.join(root, "node_modules", "@pk", "lib", "dist", "b.js"), `module.exports = "b";`);
    expect(req("@pk/lib/b")).toBe("b");
  });

  test("a file added under the directory a tsconfig path points at (#12372)", async () => {
    using dir = tempDir("runtime-cache-late-tsconfig-path", {
      "tsconfig.json": `{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }`,
      "src/a.ts": `export const a = 1;`,
    });
    const root = String(dir);
    const req = createRequire(path.join(root, "main.ts"));

    expect(req("@/a")).toEqual({ a: 1 });
    writeFileSync(path.join(root, "src", "b.ts"), `export const b = 2;`);
    expect(req("@/b")).toEqual({ b: 2 });
  });

  test("a package added to a NODE_PATH directory after a miss", async () => {
    using dir = tempDir("runtime-cache-late-node-path", {
      "global/warm/index.js": `module.exports = "warm";`,
      "main.js": `
        const { mkdirSync, writeFileSync } = require("node:fs");
        const { join } = require("node:path");
        console.log(require("warm"));
        try { require("late-pkg"); } catch (e) { console.log(e.code); }
        mkdirSync(join(__dirname, "global", "late-pkg"));
        writeFileSync(join(__dirname, "global", "late-pkg", "index.js"), "module.exports = 'late';");
        console.log(require("late-pkg"));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.js"],
      cwd: String(dir),
      env: { ...bunEnv, NODE_PATH: path.join(String(dir), "global") },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "warm\nMODULE_NOT_FOUND\nlate\n", stderr: "", exitCode: 0 });
  });

  test("a miss that stays a miss reports the module once", async () => {
    using dir = tempDir("runtime-cache-unchanged-miss", {
      "node_modules/@pk/a.ts": `export const a = 1;`,
    });
    const root = String(dir);
    const req = createRequire(path.join(root, "main.ts"));

    expect(req("@pk/a.ts")).toEqual({ a: 1 });
    for (let i = 0; i < 3; i++) {
      let message = "";
      try {
        req("@pk/nope.ts");
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).toBe(`Cannot find module '@pk/nope.ts'\nRequire stack:\n- ${path.join(root, "main.ts")}`);
    }
  });
});
