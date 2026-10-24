import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, tempDir, tmpdirSync } from "harness";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

let dirc = 0;
function nextdir() {
  return `test${++dirc}`;
}

// Helper function to create a temporary directory for testing
function getTmpDir() {
  const tempDir = path.join(
    tmpdirSync("mkdir-test"),
    `bun-fs-mkdir-test-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );

  // Create the temp dir if it doesn't exist
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  return tempDir;
}

describe("fs.mkdir", () => {
  let tmpdir: string;

  // Setup a fresh tmpdir before tests
  beforeEach(() => {
    tmpdir = getTmpDir();
  });

  // Clean up after tests
  afterEach(() => {
    try {
      fs.rmSync(tmpdir, { recursive: true, force: true });
    } catch (err) {
      // Ignore cleanup errors
    }
  });

  it("creates directory using assigned path", async () => {
    const pathname = path.join(tmpdir, nextdir());

    await new Promise<void>((resolve, reject) =>
      fs.mkdir(pathname, err => {
        if (err) return reject(err);
        resolve();
      }),
    );
    expect(fs.existsSync(pathname)).toBe(true);
  });

  it("creates directory with assigned mode value", async () => {
    const pathname = path.join(tmpdir, nextdir());

    await new Promise<void>((resolve, reject) =>
      fs.mkdir(pathname, 0o777, err => {
        if (err) return reject(err);
        resolve();
      }),
    );
    expect(fs.existsSync(pathname)).toBe(true);
  });

  it("creates directory with mode passed as an options object", async () => {
    const pathname = path.join(tmpdir, nextdir());

    await new Promise<void>((resolve, reject) =>
      fs.mkdir(pathname, { mode: 0o777 }, err => {
        if (err) return reject(err);
        resolve();
      }),
    );
    expect(fs.existsSync(pathname)).toBe(true);
  });

  it("throws for invalid path types", () => {
    [false, 1, {}, [], null, undefined].forEach((invalidPath: any) => {
      expect(() => fs.mkdir(invalidPath, () => {})).toThrow(TypeError);
    });
  });
});

describe("fs.mkdirSync", () => {
  let tmpdir: string;

  beforeEach(() => {
    tmpdir = getTmpDir();
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpdir, { recursive: true, force: true });
    } catch (err) {
      // Ignore cleanup errors
    }
  });

  it("creates directory with assigned path", () => {
    const pathname = path.join(tmpdir, nextdir());

    fs.mkdirSync(pathname);
    expect(fs.existsSync(pathname)).toBe(true);
  });

  it("creates directory with mode passed as an options object", () => {
    const pathname = path.join(tmpdir, nextdir());

    fs.mkdirSync(pathname, { mode: 0o777 });
    expect(fs.existsSync(pathname)).toBe(true);
  });

  it.skipIf(isWindows)("creates a directory honoring mode bits above 0o777", () => {
    const pathname = path.join(tmpdir, nextdir());

    fs.mkdirSync(pathname, { mode: 0o1777 });
    const mode = fs.statSync(pathname).mode;
    expect(mode & 0o777).toBe(0o777 & ~process.umask());
    // macOS mkdir(2) does not honor the sticky bit in the mode argument.
    if (isLinux) {
      expect(mode & 0o7000).toBe(0o1000);
    }
  });

  it("throws for invalid path types", () => {
    [false, 1, {}, [], null, undefined].forEach((invalidPath: any) => {
      expect(() => fs.mkdirSync(invalidPath)).toThrow(TypeError);
    });
  });
});

describe("fs.mkdir - recursive", () => {
  let tmpdir: string;

  beforeEach(() => {
    tmpdir = getTmpDir();
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpdir, { recursive: true, force: true });
    } catch (err) {
      // Ignore cleanup errors
    }
  });

  it("creates nested directories when both top-level and sub-folders don't exist", () => {
    const dir1 = nextdir();
    const dir2 = nextdir();
    const pathname = path.join(tmpdir, dir1, dir2);

    fs.mkdirSync(pathname, { recursive: true });
    expect(fs.existsSync(pathname)).toBe(true);
    expect(fs.statSync(pathname).isDirectory()).toBe(true);
  });

  it("doesn't throw when directory already exists with recursive flag", () => {
    const dir1 = nextdir();
    const dir2 = nextdir();
    const pathname = path.join(tmpdir, dir1, dir2);

    fs.mkdirSync(pathname, { recursive: true });
    expect(() => fs.mkdirSync(pathname, { recursive: true })).not.toThrow();
    expect(fs.existsSync(pathname)).toBe(true);
    expect(fs.statSync(pathname).isDirectory()).toBe(true);
  });

  it("throws when path is a file with recursive flag", () => {
    const dir1 = nextdir();
    const dir2 = nextdir();
    const pathname = path.join(tmpdir, dir1, dir2);

    // Create the parent directory
    fs.mkdirSync(path.dirname(pathname));

    // Create a file with the same name as the desired directory
    fs.writeFileSync(pathname, "", "utf8");

    expect(() => fs.mkdirSync(pathname, { recursive: true })).toThrow(Error);
  });

  it("throws when part of the path is a file with recursive flag", () => {
    const dir1 = nextdir();
    const dir2 = nextdir();
    const filename = path.join(tmpdir, dir1);
    const pathname = path.join(filename, dir2, nextdir());

    // Need to check if tmpdir exists to avoid EEXIST error
    if (!fs.existsSync(tmpdir)) {
      fs.mkdirSync(tmpdir, { recursive: true });
    }

    // Create a file with the same name as a directory in the path
    fs.writeFileSync(filename, "", "utf8");

    expect(() => fs.mkdirSync(pathname, { recursive: true })).toThrow(Error);
  });

  it("throws for invalid recursive option types", () => {
    const pathname = path.join(tmpdir, nextdir());

    ["", 1, {}, [], null, Symbol("test"), () => {}].forEach((recursive: any) => {
      expect(() => fs.mkdirSync(pathname, { recursive })).toThrow(TypeError);
    });
  });
});

describe("fs.mkdir - return values", () => {
  let tmpdir: string;

  beforeEach(() => {
    tmpdir = getTmpDir();
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpdir, { recursive: true, force: true });
    } catch (err) {
      // Ignore cleanup errors
    }
  });

  it("returns first folder created with recursive when all folders are new", async () => {
    const dir1 = nextdir();
    const dir2 = nextdir();
    const firstPathCreated = path.join(tmpdir, dir1);
    const pathname = path.join(tmpdir, dir1, dir2);

    const result = await new Promise<string | undefined>((resolve, reject) =>
      fs.mkdir(pathname, { recursive: true }, (err, result) => {
        if (err) return reject(err);
        resolve(result);
      }),
    );
    expect(fs.existsSync(pathname)).toBe(true);
    expect(fs.statSync(pathname).isDirectory()).toBe(true);
    expect(result).toBe(path.toNamespacedPath(firstPathCreated));
  });

  it("returns last folder created with recursive when only last folder is new", async () => {
    const dir1 = nextdir();
    const dir2 = nextdir();
    const pathname = path.join(tmpdir, dir1, dir2);

    // Create the parent directory
    fs.mkdirSync(path.join(tmpdir, dir1));

    const result = await new Promise<string | undefined>((resolve, reject) =>
      fs.mkdir(pathname, { recursive: true }, (err, result) => {
        if (err) return reject(err);
        resolve(result);
      }),
    );
    expect(fs.existsSync(pathname)).toBe(true);
    expect(fs.statSync(pathname).isDirectory()).toBe(true);
    expect(result).toBe(path.toNamespacedPath(pathname));
  });

  it("returns undefined with recursive when no new folders are created", async () => {
    const dir1 = nextdir();
    const dir2 = nextdir();
    const pathname = path.join(tmpdir, dir1, dir2);

    // Create the directories first
    fs.mkdirSync(pathname, { recursive: true });

    const result = await new Promise<string | undefined>((resolve, reject) =>
      fs.mkdir(pathname, { recursive: true }, (err, result) => {
        if (err) return reject(err);
        resolve(result);
      }),
    );
    expect(fs.existsSync(pathname)).toBe(true);
    expect(fs.statSync(pathname).isDirectory()).toBe(true);
    expect(result).toBeUndefined();
  });

  it("mkdirSync returns first folder created with recursive when all folders are new", () => {
    const dir1 = nextdir();
    const dir2 = nextdir();
    const firstPathCreated = path.join(tmpdir, dir1);
    const pathname = path.join(tmpdir, dir1, dir2);

    const result = fs.mkdirSync(pathname, { recursive: true });
    expect(fs.existsSync(pathname)).toBe(true);
    expect(fs.statSync(pathname).isDirectory()).toBe(true);
    expect(result).toBe(path.toNamespacedPath(firstPathCreated));
  });

  it("mkdirSync returns undefined with recursive when no new folders are created", () => {
    const dir1 = nextdir();
    const dir2 = nextdir();
    const pathname = path.join(tmpdir, dir1, dir2);

    // Create the directories first
    fs.mkdirSync(pathname, { recursive: true });

    const result = fs.mkdirSync(pathname, { recursive: true });
    expect(fs.existsSync(pathname)).toBe(true);
    expect(fs.statSync(pathname).isDirectory()).toBe(true);
    expect(result).toBeUndefined();
  });
});

describe.skipIf(!isWindows)("fs.mkdir - recursive Windows relative paths", () => {
  it.each(["sync", "promise", "callback"])("preserves dot components and logical junction cwd (%s)", async method => {
    using dir = tempDir("mkdir-relative", {});
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const assert = require("node:assert/strict");
          const fs = require("node:fs");
          const path = require("node:path");
          const { promisify } = require("node:util");
          const root = process.env.MKDIR_ROOT;
          const method = process.env.MKDIR_VARIANT;
          const mkdir = method === "sync" ? fs.mkdirSync : method === "promise" ? fs.promises.mkdir : promisify(fs.mkdir);
          const logical = path.join(root, "logical");
          const work = path.join(logical, "work");
          const physical = path.join(root, "physical");
          const target = path.join(physical, "target");
          fs.mkdirSync(work, { recursive: true });
          fs.mkdirSync(path.join(logical, "sibling"));
          fs.writeFileSync(path.join(logical, "file"), "unchanged");
          fs.mkdirSync(target, { recursive: true });
          const junction = path.join(logical, "junction");
          fs.symlinkSync(target, junction, "junction");
          process.chdir(work);
          const driveRelative = path.parse(work).root.slice(0, 2) + path.join("..", "sibling");
          for (const input of [driveRelative, ".", "..", "../sibling", "..\\\\sibling", ".\\\\..\\\\sibling", work + "\\\\..\\\\sibling"]) {
            assert.equal(await mkdir(input, { recursive: true }), undefined);
            await assert.rejects(async () => mkdir(input, { recursive: false }), { code: "EEXIST" });
          }
          await assert.rejects(async () => mkdir("../file", { recursive: true }), { code: "EEXIST" });
          const unpaired = Buffer.concat([Buffer.from("../unpaired-"), Buffer.from([0xed, 0xa0, 0x80])]);
          fs.mkdirSync(unpaired);
          assert.equal(fs.statSync(unpaired).isDirectory(), true);
          assert.equal(await mkdir(unpaired, { recursive: true }), undefined);
          const firstCreated = path.join("..", "created");
          const created = await mkdir(path.join(firstCreated, "nested"), { recursive: true });
          assert.equal(typeof created, "string");
          const createdStat = fs.statSync(created, { bigint: true });
          const expectedStat = fs.statSync(path.join(logical, "created"), { bigint: true });
          assert.deepEqual([createdStat.dev, createdStat.ino], [expectedStat.dev, expectedStat.ino]);
          assert.equal(fs.statSync(path.join(logical, "created", "nested")).isDirectory(), true);
          process.chdir(junction);
          assert.equal(process.cwd(), junction);
          assert.equal(await mkdir("../sibling", { recursive: true }), undefined);
          assert.equal(fs.existsSync(path.join(physical, "sibling")), false);
          const firstJunctionCreated = path.join("..", "junction-created");
          const junctionCreated = await mkdir(path.join(firstJunctionCreated, "nested"), { recursive: true });
          assert.equal(typeof junctionCreated, "string");
          const junctionStat = fs.statSync(junctionCreated, { bigint: true });
          const expectedJunctionStat = fs.statSync(path.join(logical, "junction-created"), { bigint: true });
          assert.deepEqual([junctionStat.dev, junctionStat.ino], [expectedJunctionStat.dev, expectedJunctionStat.ino]);
          assert.equal(fs.statSync(path.join(logical, "junction-created", "nested")).isDirectory(), true);
          assert.equal(fs.existsSync(path.join(physical, "junction-created")), false);
          assert.equal(fs.readFileSync(path.join(logical, "file"), "utf8"), "unchanged");
          console.log("ok");
        `,
      ],
      env: { ...bunEnv, MKDIR_ROOT: String(dir), MKDIR_VARIANT: method },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "ok\n", stderr: "", exitCode: 0 });
  });
});

// https://github.com/oven-sh/bun/issues/34413
describe.skipIf(!isWindows)("fs.mkdir - recursive with ReadOnly attribute (Windows)", () => {
  let tmpdir: string;
  let readonlyDir: string;

  beforeEach(() => {
    tmpdir = getTmpDir();
    readonlyDir = path.join(tmpdir, nextdir());
    fs.mkdirSync(readonlyDir);
    execSync(`attrib +R "${readonlyDir}"`);
  });

  afterEach(() => {
    try {
      execSync(`attrib -R "${readonlyDir}"`);
      fs.rmSync(tmpdir, { recursive: true, force: true });
    } catch (err) {
      // Ignore cleanup errors
    }
  });

  it("mkdirSync does not throw when the directory exists and is ReadOnly", () => {
    expect(fs.mkdirSync(readonlyDir, { recursive: true })).toBeUndefined();
    expect(fs.statSync(readonlyDir).isDirectory()).toBe(true);
  });

  it("promises.mkdir does not throw when the directory exists and is ReadOnly", async () => {
    expect(await fs.promises.mkdir(readonlyDir, { recursive: true })).toBeUndefined();
    expect(fs.statSync(readonlyDir).isDirectory()).toBe(true);
  });

  it("creates nested directories under a ReadOnly ancestor", () => {
    const pathname = path.join(readonlyDir, nextdir(), nextdir());

    fs.mkdirSync(pathname, { recursive: true });
    expect(fs.statSync(pathname).isDirectory()).toBe(true);
  });
});

describe("fs.promises.mkdir", () => {
  let tmpdir: string;

  beforeEach(() => {
    tmpdir = getTmpDir();
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpdir, { recursive: true, force: true });
    } catch (err) {
      // Ignore cleanup errors
    }
  });

  it("returns first folder created with recursive when all folders are new", async () => {
    const dir1 = nextdir();
    const dir2 = nextdir();
    const firstPathCreated = path.join(tmpdir, dir1);
    const pathname = path.join(tmpdir, dir1, dir2);

    const result = await fs.promises.mkdir(pathname, { recursive: true });
    expect(fs.existsSync(pathname)).toBe(true);
    expect(fs.statSync(pathname).isDirectory()).toBe(true);
    expect(result).toBe(path.toNamespacedPath(firstPathCreated));
  });

  it("returns last folder created with recursive when only last folder is new", async () => {
    const dir1 = nextdir();
    const dir2 = nextdir();
    const pathname = path.join(tmpdir, dir1, dir2);

    // Create the parent directory
    fs.mkdirSync(path.join(tmpdir, dir1));

    const result = await fs.promises.mkdir(pathname, { recursive: true });
    expect(fs.existsSync(pathname)).toBe(true);
    expect(fs.statSync(pathname).isDirectory()).toBe(true);
    expect(result).toBe(path.toNamespacedPath(pathname));
  });

  it("returns undefined with recursive when no new folders are created", async () => {
    const dir1 = nextdir();
    const dir2 = nextdir();
    const pathname = path.join(tmpdir, dir1, dir2);

    // Create the directories first
    fs.mkdirSync(pathname, { recursive: true });

    const result = await fs.promises.mkdir(pathname, { recursive: true });
    expect(fs.existsSync(pathname)).toBe(true);
    expect(fs.statSync(pathname).isDirectory()).toBe(true);
    expect(result).toBeUndefined();
  });
});
