import { describe, expect, test } from "bun:test";
import { promises as fs } from "fs";
import { expectRssDeltaBelow, isASAN, isDebug, isWindows, tempDir } from "harness";
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

  // FileSystemRouter.reload() makes the resolver read the directory, and each
  // directory below it, again. That read keeps what it knows about each name
  // that is still listed, and it finds a name by its lowercased form. In the
  // tests below a name stands for something else after the change while its
  // lowercased form is the same.
  function readAgain(root: string) {
    // No file has this extension, so the router itself looks at no file.
    new Bun.FileSystemRouter({ dir: root, style: "nextjs", fileExtensions: [".no-route"] }).reload();
  }

  test("file renamed to another case", async () => {
    using dir = tempDir("runtime-cache-case-rename", {
      "Listed.js": `module.exports = { value: "listed" };`,
      "Loaded.js": `module.exports = { value: "loaded" };`,
    });
    const root = String(dir);
    // The resolver has the path of Loaded.js. It has only the name of Listed.js.
    expect(path.basename(require.resolve(path.join(root, "Loaded.js")))).toBe("Loaded.js");

    await fs.rename(path.join(root, "Listed.js"), path.join(root, "listed.js"));
    await fs.rename(path.join(root, "Loaded.js"), path.join(root, "loaded.js"));
    readAgain(root);

    expect(["listed.js", "loaded.js"].map(file => path.basename(require.resolve(path.join(root, file))))).toEqual([
      "listed.js",
      "loaded.js",
    ]);
    expect(require(path.join(root, "listed.js")).value).toBe("listed");
  });

  test("import corrected to the case of the file", async () => {
    using dir = tempDir("runtime-cache-case-import", {
      "config.js": `module.exports = { value: 42 };`,
    });
    const root = String(dir);
    // Loads only where the file system ignores case.
    try {
      require(path.join(root, "CONFIG"));
    } catch {}
    readAgain(root);

    expect(path.basename(require.resolve(path.join(root, "config")))).toBe("config.js");
    expect(require(path.join(root, "config")).value).toBe(42);
  });

  test.skipIf(isWindows)("symlink replaced by a file", async () => {
    using dir = tempDir("runtime-cache-symlink-to-file", {
      "target.js": `module.exports = { value: "target" };`,
    });
    const root = String(dir);
    await fs.symlink("target.js", path.join(root, "config.js"));
    expect(path.basename(require.resolve(path.join(root, "config.js")))).toBe("target.js");

    await fs.rm(path.join(root, "config.js"));
    await fs.writeFile(path.join(root, "config.js"), `module.exports = { value: "file" };`);
    readAgain(root);

    expect(path.basename(require.resolve(path.join(root, "config.js")))).toBe("config.js");
    expect(require(path.join(root, "config.js")).value).toBe("file");
  });

  test.skipIf(isWindows)("symlink to a directory points somewhere else", async () => {
    using dir = tempDir("runtime-cache-symlink-to-dir", {
      "first/config.js": `module.exports = { value: "first" };`,
      "first/nested/config.js": `module.exports = { value: "first nested" };`,
      "second/config.js": `module.exports = { value: "second" };`,
      "second/nested/config.js": `module.exports = { value: "second nested" };`,
    });
    const root = String(dir);
    const current = path.join(root, "current");
    // The real path of a name below the symlink is kept with the name.
    const realPaths = () =>
      ["config.js", "nested/config.js"].map(file =>
        path.relative(path.dirname(current), require.resolve(path.join(current, file))).replaceAll(path.sep, "/"),
      );
    await fs.symlink("first", current);
    expect(realPaths()).toEqual(["first/config.js", "first/nested/config.js"]);

    await fs.rm(current);
    await fs.symlink("second", current);
    readAgain(root);

    expect(realPaths()).toEqual(["second/config.js", "second/nested/config.js"]);
    expect(require(path.join(current, "nested/config.js")).value).toBe("second nested");
  });

  // The listing that a failed require() drops could not be freed or used again,
  // so every miss kept one more of them: about 100 KB beside 500 files.
  test("a failed require() does not keep the listing it drops", async () => {
    const files: Record<string, string> = { "few/file.txt": "" };
    for (let i = 0; i < 500; i++) files[`many/file-${i}.txt`] = "";
    using dir = tempDir("runtime-cache-listings", files);
    const misses = isASAN || isDebug ? 60 : 100;
    const code = `
      const { renameSync, writeFileSync } = require("node:fs");
      const { createRequire } = require("node:module");
      const many = ${JSON.stringify(path.join(String(dir), "many"))};
      const fromMany = createRequire(many + "/entry.js");
      const fromFew = createRequire(${JSON.stringify(path.join(String(dir), "few", "entry.js"))});
      function miss(from, specifier = "./does-not-exist.js") {
        try {
          from(specifier);
        } catch {}
      }
      function growth(cycles, cycle) {
        for (let i = 0; i < 5; i++) cycle();
        Bun.gc(true);
        const before = process.memoryUsage.rss();
        for (let i = 0; i < cycles; i++) cycle();
        Bun.gc(true);
        return (process.memoryUsage.rss() - before) / 1024 / 1024;
      }
      // What the first hundred misses cost is not about the directory.
      for (let i = 0; i < 100; i++) miss(fromFew);
      // An absolute specifier reads the directory of the missing file again.
      const absolute = growth(${misses}, () => miss(fromMany, many + "/does-not-exist.js"));
      // A relative one reads the directory of the importer again, also after
      // that directory went away and came back.
      const relative = growth(${misses / 2}, () => {
        miss(fromMany);
        renameSync(many, many + "-gone");
        miss(fromMany);
        renameSync(many + "-gone", many);
        miss(fromMany);
      });
      // A file takes the place of the directory for one miss. The error of
      // that read is kept apart from the listing.
      writeFileSync(many + "-file", "");
      const replaced = growth(${misses}, () => {
        renameSync(many, many + "-gone");
        renameSync(many + "-file", many);
        miss(fromMany);
        renameSync(many, many + "-file");
        renameSync(many + "-gone", many);
        miss(fromMany, many + "/does-not-exist.js");
      });
      console.log(JSON.stringify({ deltaMiB: Math.max(absolute, relative, replaced) }));
    `;
    await expectRssDeltaBelow(["-e", code], { release: 5, debug: 4 });
  });
});
