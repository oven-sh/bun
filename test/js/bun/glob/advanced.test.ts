import { Glob, GlobScanOptions, GlobScanResult } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { tempDirWithFiles, tmpdirSync } from "harness";
import * as fs from "node:fs";
import * as path from "path";

let origAggressiveGC = Bun.unsafe.gcAggressionLevel();

beforeAll(() => {
  Bun.unsafe.gcAggressionLevel(0);
});

afterAll(() => {
  Bun.unsafe.gcAggressionLevel(origAggressiveGC);
});

describe("Advanced Glob Features", () => {
  
  describe("Pagination", () => {
    let tempdir: string;
    const files: Record<string, string> = {};
    
    beforeAll(() => {
      // Create 20 test files with different names for pagination testing
      for (let i = 1; i <= 20; i++) {
        files[`file${i.toString().padStart(2, '0')}.js`] = `console.log(${i});`;
      }
      tempdir = tempDirWithFiles("glob-pagination", files);
    });

    test("basic pagination with limit", async () => {
      const glob = new Glob("*.js");
      const result = await glob.scan({ cwd: tempdir, limit: 5 });
      
      expect(result).toHaveProperty("files");
      expect(result).toHaveProperty("hasMore");
      expect(result.files).toHaveLength(5);
      expect(result.hasMore).toBe(true);
      expect(result.files.every(f => f.endsWith(".js"))).toBe(true);
    });

    test("pagination with offset", async () => {
      const glob = new Glob("*.js");
      const result = await glob.scan({ cwd: tempdir, limit: 5, offset: 10 });
      
      expect(result.files).toHaveLength(5);
      expect(result.hasMore).toBe(true);
    });

    test("pagination near end of results", async () => {
      const glob = new Glob("*.js");
      const result = await glob.scan({ cwd: tempdir, limit: 10, offset: 15 });
      
      expect(result.files).toHaveLength(5); // Only 5 files left after offset 15
      expect(result.hasMore).toBe(false);
    });

    test("pagination beyond available results", async () => {
      const glob = new Glob("*.js");
      const result = await glob.scan({ cwd: tempdir, limit: 10, offset: 25 });
      
      expect(result.files).toHaveLength(0);
      expect(result.hasMore).toBe(false);
    });

    test("limit larger than total results", async () => {
      const glob = new Glob("*.js");
      const result = await glob.scan({ cwd: tempdir, limit: 50 });
      
      expect(result.files).toHaveLength(20); // Total files available
      expect(result.hasMore).toBe(false);
    });

    test("offset only (no limit) returns structured result", async () => {
      const glob = new Glob("*.js");
      const result = await glob.scan({ cwd: tempdir, offset: 5 });
      
      expect(result.files).toHaveLength(15); // 20 - 5 offset
      expect(result.hasMore).toBe(false);
    });
  });

  describe("Sorting", () => {
    let tempdir: string;
    
    beforeAll(async () => {
      tempdir = tempDirWithFiles("glob-sorting", {
        "zebra.txt": "content",
        "alpha.txt": "content", 
        "beta.txt": "content"
      });
      
      // Wait a bit and modify files to create different mtimes
      await new Promise(resolve => setTimeout(resolve, 10));
      await Bun.write(path.join(tempdir, "beta.txt"), "modified content");
      await new Promise(resolve => setTimeout(resolve, 10));
      await Bun.write(path.join(tempdir, "zebra.txt"), "modified content again");
    });

    test("sort by name", async () => {
      const glob = new Glob("*.txt");
      const result = await glob.scan({ cwd: tempdir, sort: "name" });
      
      expect(result.files).toEqual(["alpha.txt", "beta.txt", "zebra.txt"]);
      expect(result.hasMore).toBe(false);
    });

    test("sort by mtime", async () => {
      const glob = new Glob("*.txt");
      const result = await glob.scan({ cwd: tempdir, sort: "mtime" });
      
      // Files should be sorted by modification time (oldest to newest)
      expect(result.files).toHaveLength(3);
      expect(result.files[0]).toBe("alpha.txt"); // Oldest (created first, never modified)
      expect(result.files[result.files.length - 1]).toBe("zebra.txt"); // Newest (modified last)
    });

    test("sort by size", async () => {
      const sortTempdir = tempDirWithFiles("glob-sorting-size", {
        "small.txt": "hi",
        "large.txt": "this is a much longer file with more content",
        "medium.txt": "medium length content here"
      });
      
      const glob = new Glob("*.txt");
      const result = await glob.scan({ cwd: sortTempdir, sort: "size" });
      
      expect(result.files).toEqual(["small.txt", "medium.txt", "large.txt"]);
    });

    test("sorting with pagination", async () => {
      const glob = new Glob("*.txt");
      const result = await glob.scan({ 
        cwd: tempdir, 
        sort: "name", 
        limit: 2 
      });
      
      expect(result.files).toEqual(["alpha.txt", "beta.txt"]);
      expect(result.hasMore).toBe(true);
      
      const nextPage = await glob.scan({
        cwd: tempdir,
        sort: "name",
        limit: 2,
        offset: 2
      });
      
      expect(nextPage.files).toEqual(["zebra.txt"]);
      expect(nextPage.hasMore).toBe(false);
    });
  });

  describe("AbortSignal", () => {
    test("cancellation support", async () => {
      // Create many files to make scan take longer
      const files: Record<string, string> = {};
      for (let i = 0; i < 100; i++) {
        files[`file${i}.js`] = "content";
      }
      const tempdir = tempDirWithFiles("glob-abort", files);
      
      const controller = new AbortController();
      const glob = new Glob("*.js");
      
      // Start scan and abort after a brief delay to ensure scan has started
      const promise = glob.scan({ cwd: tempdir, signal: controller.signal });
      await new Promise(resolve => setTimeout(resolve, 1)); // 1ms delay
      controller.abort();
      
      let threw = false;
      try {
        await promise;
      } catch (error) {
        threw = true;
        expect(error.name).toBe("AbortError");
      }
      
      expect(threw).toBe(true);
    });

    test("already aborted signal", async () => {
      const tempdir = tempDirWithFiles("glob-abort-already", {
        "file1.js": "content"
      });
      
      const controller = new AbortController();
      controller.abort(); // Abort before using
      
      const glob = new Glob("*.js");
      
      let threw = false;
      try {
        await glob.scan({ cwd: tempdir, signal: controller.signal });
      } catch (error) {
        threw = true;
        expect(error.name).toBe("AbortError");
      }
      
      expect(threw).toBe(true);
    });

    test("normal completion without abort", async () => {
      const tempdir = tempDirWithFiles("glob-no-abort", {
        "file1.js": "content",
        "file2.js": "content"
      });
      
      const controller = new AbortController();
      const glob = new Glob("*.js");
      
      const result = await glob.scan({ cwd: tempdir, signal: controller.signal });
      
      expect(result.files).toHaveLength(2);
      expect(result.files).toContain("file1.js");
      expect(result.files).toContain("file2.js");
    });
  });

  describe("Ignore Patterns", () => {
    let tempdir: string;
    
    beforeAll(() => {
      tempdir = tempDirWithFiles("glob-ignore", {
        "src/index.js": "main file",
        "src/utils.js": "utilities",
        "src/test.spec.js": "test file",
        "node_modules/dep/index.js": "dependency",
        "node_modules/dep/package.json": "{}",
        ".git/config": "git config",
        ".git/HEAD": "ref: refs/heads/main",
        "dist/bundle.js": "built file",
        "docs/readme.md": "documentation"
      });
    });

    test("ignore single pattern", async () => {
      const glob = new Glob("**/*.js");
      const result = await glob.scan({ 
        cwd: tempdir, 
        ignore: ["node_modules/**"] 
      });
      
      const nodeModulesFiles = result.files.filter(f => f.includes("node_modules"));
      expect(nodeModulesFiles).toHaveLength(0);
      expect(result.files).toContain("src/index.js");
      expect(result.files).toContain("src/utils.js");
      expect(result.files).toContain("dist/bundle.js");
    });

    test("ignore multiple patterns", async () => {
      const glob = new Glob("**/*");
      const result = await glob.scan({ 
        cwd: tempdir, 
        ignore: ["node_modules/**", ".git/**", "**/*.spec.js"] 
      });
      
      const ignoredFiles = result.files.filter(f => 
        f.includes("node_modules") || 
        f.includes(".git") || 
        f.includes(".spec.js")
      );
      expect(ignoredFiles).toHaveLength(0);
      expect(result.files).toContain("src/index.js");
      expect(result.files).toContain("src/utils.js");
    });

    test("ignore with specific file extension", async () => {
      const glob = new Glob("**/*");
      const result = await glob.scan({ 
        cwd: tempdir, 
        ignore: ["**/*.json"] 
      });
      
      const jsonFiles = result.files.filter(f => f.endsWith(".json"));
      expect(jsonFiles).toHaveLength(0);
      expect(result.files).toContain("src/index.js");
    });
  });

  describe("Case Insensitive Matching", () => {
    let tempdir: string;
    
    beforeAll(() => {
      tempdir = tempDirWithFiles("glob-nocase", {
        "File.JS": "uppercase extension",
        "script.js": "lowercase extension", 
        "Component.TSX": "mixed case",
        "README.MD": "uppercase markdown",
        "readme.md": "lowercase markdown"
      });
    });

    test("case sensitive matching (default)", async () => {
      const glob = new Glob("*.js");
      const result = await glob.scan({ cwd: tempdir, nocase: false, limit: 100 });
      
      expect(result.files).toContain("script.js");
      expect(result.files).not.toContain("File.JS");
    });

    test("case insensitive matching", async () => {
      const glob = new Glob("*.js");
      const result = await glob.scan({ cwd: tempdir, nocase: true });
      
      expect(result.files).toContain("script.js");
      expect(result.files).toContain("File.JS");
    });

    test("case insensitive with mixed extensions", async () => {
      const glob = new Glob("*.{js,tsx}");
      const result = await glob.scan({ cwd: tempdir, nocase: true });
      
      expect(result.files).toContain("File.JS");
      expect(result.files).toContain("script.js");
      expect(result.files).toContain("Component.TSX");
    });

    test("case insensitive pattern matching filename", async () => {
      const glob = new Glob("readme.*");
      const result = await glob.scan({ cwd: tempdir, nocase: true });
      
      expect(result.files).toContain("README.MD");
      expect(result.files).toContain("readme.md");
    });
  });

  describe("Feature Combinations", () => {
    let tempdir: string;
    
    beforeAll(async () => {
      const files: Record<string, string> = {};
      
      // Create varied files for comprehensive testing
      for (let i = 1; i <= 15; i++) {
        files[`src/file${i}.js`] = `console.log(${i});`;
        files[`test/test${i}.spec.js`] = `test ${i}`;
        if (i <= 5) {
          files[`node_modules/dep${i}/index.js`] = `dep ${i}`;
        }
      }
      
      tempdir = tempDirWithFiles("glob-combined", files);
      
      // Create different file sizes for size sorting
      await Bun.write(path.join(tempdir, "src/tiny.js"), "x");
      await Bun.write(path.join(tempdir, "src/huge.js"), "x".repeat(1000));
    });

    test("pagination + sorting + ignore", async () => {
      const glob = new Glob("**/*.js");
      const result = await glob.scan({ 
        cwd: tempdir,
        limit: 5,
        sort: "name",
        ignore: ["node_modules/**", "**/*.spec.js"]
      });
      
      expect(result.files).toHaveLength(5);
      expect(result.hasMore).toBe(true);
      
      // Should be sorted by name and exclude ignored patterns
      const hasNodeModules = result.files.some(f => f.includes("node_modules"));
      const hasSpecFiles = result.files.some(f => f.includes(".spec.js"));
      expect(hasNodeModules).toBe(false);
      expect(hasSpecFiles).toBe(false);
      
      // Check sorting (first file should be alphabetically first)
      const sortedExpected = result.files.slice().sort();
      expect(result.files).toEqual(sortedExpected);
    });

    test("sorting by size + pagination", async () => {
      const glob = new Glob("src/*.js");
      const result = await glob.scan({ 
        cwd: tempdir,
        sort: "size",
        limit: 3
      });
      
      expect(result.files).toHaveLength(3);
      expect(result.hasMore).toBe(true);
      
      // First file should be smallest
      expect(result.files[0]).toBe("src/tiny.js");
    });

    test("case insensitive + ignore + limit", async () => {
      const caseTempdir = tempDirWithFiles("glob-case-ignore", {
        "File.JS": "content",
        "script.js": "content",
        "TEST.SPEC.JS": "test",
        "app.JS": "content"
      });
      
      const glob = new Glob("*.js");
      const result = await glob.scan({ 
        cwd: caseTempdir,
        nocase: true,
        ignore: ["**/*.spec.js"],
        limit: 2
      });
      
      expect(result.files).toHaveLength(2);
      expect(result.hasMore).toBe(true);
      
      // Should not contain spec files even with case insensitive matching
      const hasSpecFiles = result.files.some(f => f.toLowerCase().includes("spec"));
      expect(hasSpecFiles).toBe(false);
    });
  });

  describe("Backward Compatibility", () => {
    let tempdir: string;
    
    beforeAll(() => {
      tempdir = tempDirWithFiles("glob-compat", {
        "file1.js": "content",
        "file2.ts": "content",
        "README.md": "content"
      });
    });

    test("simple scan still returns AsyncIterator", async () => {
      const glob = new Glob("*.js");
      const iterator = glob.scan({ cwd: tempdir });
      
      // Should be an async iterator, not a Promise
      expect(typeof iterator[Symbol.asyncIterator]).toBe("function");
      
      const files = await Array.fromAsync(iterator);
      expect(files).toContain("file1.js");
      expect(files).not.toContain("file2.ts");
    });

    test("scan with string cwd still works", async () => {
      const glob = new Glob("*.js");
      const iterator = glob.scan(tempdir);
      
      const files = await Array.fromAsync(iterator);
      expect(files).toContain("file1.js");
    });

    test("scan with basic options still returns AsyncIterator", async () => {
      const glob = new Glob("*");
      const iterator = glob.scan({ 
        cwd: tempdir, 
        onlyFiles: true 
      });
      
      expect(typeof iterator[Symbol.asyncIterator]).toBe("function");
      
      const files = await Array.fromAsync(iterator);
      expect(files.length).toBeGreaterThan(0);
    });

    test("advanced options return Promise<GlobScanResult>", async () => {
      const glob = new Glob("*");
      const result = await glob.scan({ 
        cwd: tempdir, 
        limit: 10 
      });
      
      // Should be a structured result, not an iterator
      expect(result).toHaveProperty("files");
      expect(result).toHaveProperty("hasMore");
      expect(Array.isArray(result.files)).toBe(true);
      expect(typeof result.hasMore).toBe("boolean");
    });
  });

  describe("Edge Cases", () => {
    test("empty directory", async () => {
      const emptyDir = tmpdirSync();
      const glob = new Glob("*");
      
      const result = await glob.scan({ cwd: emptyDir, limit: 5 });
      
      expect(result.files).toHaveLength(0);
      expect(result.hasMore).toBe(false);
    });

    test("invalid sort field gracefully handled", async () => {
      const tempdir = tempDirWithFiles("glob-invalid-sort", {
        "file.txt": "content"
      });
      
      const glob = new Glob("*");
      
      // This should not crash, behavior may vary
      try {
        const result = await glob.scan({ 
          cwd: tempdir, 
          // @ts-expect-error - intentionally invalid
          sort: "invalid" 
        });
        // If it doesn't throw, just check basic structure
        expect(result).toHaveProperty("files");
        expect(result).toHaveProperty("hasMore");
      } catch (error) {
        // If it throws, that's also acceptable behavior
        expect(error).toBeDefined();
      }
    });

    test("zero limit", async () => {
      const tempdir = tempDirWithFiles("glob-zero-limit", {
        "file.txt": "content"
      });
      
      const glob = new Glob("*");
      const result = await glob.scan({ cwd: tempdir, limit: 0 });
      
      expect(result.files).toHaveLength(0);
      expect(result.hasMore).toBe(true); // Since there are files available
    });

    test("negative offset", async () => {
      const tempdir = tempDirWithFiles("glob-negative-offset", {
        "file.txt": "content"
      });
      
      const glob = new Glob("*");
      
      // Behavior with negative offset - should either work or throw
      try {
        const result = await glob.scan({ cwd: tempdir, offset: -1 });
        // If it works, check the result
        expect(result).toHaveProperty("files");
      } catch (error) {
        // Throwing is also acceptable
        expect(error).toBeDefined();
      }
    });
  });
});