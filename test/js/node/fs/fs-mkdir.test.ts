import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { tmpdirSync } from "harness";
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
