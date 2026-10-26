import { describe, expect, test } from "bun:test";
import { promises as fs, mkdirSync, rmSync, writeFileSync } from "fs";
import { tempDir } from "harness";
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

// A cached directory holds what it took from the directories above it: the package.json and the tsconfig.json that
// apply to it, and a link to its parent. A require that fails drops one directory from the cache.
describe("a directory dropped from the cache", () => {
  const drop = (dir: string) => expect(() => require(path.join(dir, "not-there.js"))).toThrow();
  const probe = (specifier: string) => `
    const { basename } = require("path");
    module.exports = () => {
      try {
        return basename(require.resolve("${specifier}"));
      } catch (e) {
        return e.code;
      }
    };
  `;
  const probes = (specifier: string) => ({
    "a.js": "",
    "b.js": "",
    "probe.js": probe(specifier),
    "src/probe.js": probe(specifier),
    "src/deep/probe.js": probe(specifier),
  });
  /** What the specifier resolves to from the project root, from src and from src/deep, asked in that order. */
  function resolved(root: string, order: ("root" | "src" | "deep")[] = ["root", "src", "deep"]) {
    const dirs = { root: "", src: "src", deep: "src/deep" };
    const from = Object.fromEntries(order.map(at => [at, require(path.join(root, dirs[at], "probe.js"))()]));
    return { root: from.root, src: from.src, deep: from.deep };
  }
  const everywhere = (file: string) => ({ root: file, src: file, deep: file });
  const imports = (target: string) => JSON.stringify({ name: "app", imports: { "#lib": target } });
  const paths = (target: string) => JSON.stringify({ compilerOptions: { paths: { "@lib": [target] } } });

  test.each([
    ["package.json", "#lib", imports],
    ["tsconfig.json", "@lib", paths],
  ])("a new %s reaches the directories below it", (config, specifier, contents) => {
    using dir = tempDir("runtime-cache-config", { ...probes(specifier), [config]: contents("./a.js") });
    const root = String(dir);
    expect(resolved(root)).toEqual(everywhere("a.js"));

    writeFileSync(path.join(root, config), contents("./b.js"));
    drop(root);
    expect(resolved(root, ["deep", "src", "root"])).toEqual(everywhere("b.js"));

    writeFileSync(path.join(root, config), contents("./a.js"));
    drop(root);
    expect(resolved(root, ["root", "src", "deep"])).toEqual(everywhere("a.js"));
  });

  test("a package.json that is created or deleted reaches the directories below it", () => {
    using dir = tempDir("runtime-cache-config-created", probes("#lib"));
    const root = String(dir);
    expect(resolved(root)).toEqual(everywhere("MODULE_NOT_FOUND"));

    writeFileSync(path.join(root, "package.json"), imports("./a.js"));
    drop(root);
    expect(resolved(root, ["deep", "src", "root"])).toEqual(everywhere("a.js"));

    rmSync(path.join(root, "package.json"));
    drop(root);
    expect(resolved(root, ["deep", "src", "root"])).toEqual(everywhere("MODULE_NOT_FOUND"));
  });

  test("a new node_modules folder reaches the directories below it", () => {
    using dir = tempDir("runtime-cache-node-modules", probes("installed-later"));
    const root = String(dir);
    expect(resolved(root)).toEqual(everywhere("MODULE_NOT_FOUND"));

    mkdirSync(path.join(root, "node_modules", "installed-later"), { recursive: true });
    writeFileSync(path.join(root, "node_modules", "installed-later", "index.js"), "");
    drop(root);
    expect(resolved(root, ["deep", "src", "root"])).toEqual(everywhere("index.js"));
  });

  test("a new file that a tsconfig.json below extends reaches that directory", () => {
    using dir = tempDir("runtime-cache-extends", {
      ...probes("@lib"),
      "tsconfig.base.json": paths("./a.js"),
      "src/tsconfig.json": JSON.stringify({ extends: "../tsconfig.base.json" }),
    });
    const root = String(dir);
    expect(resolved(root, ["src", "deep"])).toEqual({ root: undefined, src: "a.js", deep: "a.js" });

    writeFileSync(path.join(root, "tsconfig.base.json"), paths("./b.js"));
    drop(root);
    expect(resolved(root, ["deep", "src"])).toEqual({ root: undefined, src: "b.js", deep: "b.js" });
  });

  test.each([
    ["the directory above it first", ["", "src"]],
    ["the directory above it last", ["src", ""]],
  ])("a directory that is dropped with %s is read again", (_, order) => {
    using dir = tempDir("runtime-cache-two-drops", {
      ...probes("#lib"),
      "package.json": JSON.stringify({ name: "app" }),
      "src/package.json": imports("./a.js"),
      "src/a.js": "",
      "src/b.js": "",
    });
    const root = String(dir);
    expect(resolved(root, ["src", "deep"])).toEqual({ root: undefined, src: "a.js", deep: "a.js" });

    writeFileSync(path.join(root, "src", "package.json"), imports("./b.js"));
    for (const sub of order) drop(path.join(root, sub));
    expect(resolved(root, ["deep", "src"])).toEqual({ root: undefined, src: "b.js", deep: "b.js" });
  });

  test("the directories below it stay as they are when nothing changed", () => {
    using dir = tempDir("runtime-cache-no-change", { ...probes("#lib"), "package.json": imports("./a.js") });
    const root = String(dir);
    expect(resolved(root)).toEqual(everywhere("a.js"));
    for (const order of [[""], ["src", ""], ["", "src"], ["src/deep"], ["", "src", "src/deep"]]) {
      for (const sub of order) drop(path.join(root, sub));
      expect(resolved(root, ["deep", "src", "root"])).toEqual(everywhere("a.js"));
    }
  });
});
