import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { isLinux, isWindows, tmpdirSync } from "harness";
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

// When mkdir reports the path as existing, the recursive form stats it to find out
// whether it is a directory. Like node, a failed stat is the error that gets reported:
// ENOENT for a symlink whose target is missing, ELOOP for a symlink loop. Bun used to
// report the mkdir's EEXIST for both. On Windows the existence probe describes the link
// itself instead of following it, so the symlink cases there are a separate fix.
describe.skipIf(isWindows)("fs.mkdir - recursive on a symlink", () => {
  let tmpdir: string;
  let missing: string;
  let dangling: string;
  let loop: string;
  let file: string;
  let fileLink: string;
  let dir: string;
  let dirLink: string;

  const mkdirForms = {
    mkdirSync: (pathname: string) => Promise.resolve().then(() => fs.mkdirSync(pathname, { recursive: true })),
    mkdir: (pathname: string) =>
      new Promise<string | undefined>((resolve, reject) =>
        fs.mkdir(pathname, { recursive: true }, (err, result) => (err ? reject(err) : resolve(result))),
      ),
    "promises.mkdir": (pathname: string) => fs.promises.mkdir(pathname, { recursive: true }),
  };
  const forms = Object.keys(mkdirForms) as (keyof typeof mkdirForms)[];

  beforeEach(() => {
    tmpdir = getTmpDir();
    missing = path.join(tmpdir, "missing");
    dangling = path.join(tmpdir, "dangling");
    fs.symlinkSync("missing", dangling);
    loop = path.join(tmpdir, "loop");
    fs.symlinkSync("loop", loop);
    file = path.join(tmpdir, "file");
    fs.writeFileSync(file, "");
    fileLink = path.join(tmpdir, "file-link");
    fs.symlinkSync("file", fileLink);
    dir = path.join(tmpdir, "dir");
    fs.mkdirSync(dir);
    dirLink = path.join(tmpdir, "dir-link");
    fs.symlinkSync("dir", dirLink);
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpdir, { recursive: true, force: true });
    } catch (err) {
      // Ignore cleanup errors
    }
  });

  describe.each(forms)("%s", form => {
    it("reports ENOENT for a symlink to a missing target and creates nothing", async () => {
      await expect(mkdirForms[form](dangling)).rejects.toMatchObject({
        code: "ENOENT",
        syscall: "mkdir",
        path: dangling,
      });
      expect(fs.existsSync(missing)).toBe(false);
      expect(fs.lstatSync(dangling).isSymbolicLink()).toBe(true);
    });

    it("reports ELOOP for a symlink loop", async () => {
      await expect(mkdirForms[form](loop)).rejects.toMatchObject({
        code: "ELOOP",
        syscall: "mkdir",
        path: loop,
      });
      expect(fs.lstatSync(loop).isSymbolicLink()).toBe(true);
    });

    it("still reports EEXIST for a file and for a symlink to a file", async () => {
      await expect(mkdirForms[form](file)).rejects.toMatchObject({ code: "EEXIST", syscall: "mkdir", path: file });
      await expect(mkdirForms[form](fileLink)).rejects.toMatchObject({
        code: "EEXIST",
        syscall: "mkdir",
        path: fileLink,
      });
    });

    it("still accepts a symlink to a directory", async () => {
      expect(await mkdirForms[form](dirLink)).toBeUndefined();
      expect(await mkdirForms[form](path.join(dirLink, "sub"))).toBe(path.join(dirLink, "sub"));
      expect(fs.statSync(path.join(dir, "sub")).isDirectory()).toBe(true);
    });

    it("reports the error of the component below the symlink unchanged", async () => {
      await expect(mkdirForms[form](path.join(dangling, "sub"))).rejects.toMatchObject({ code: "ENOENT" });
      await expect(mkdirForms[form](path.join(loop, "sub"))).rejects.toMatchObject({ code: "ELOOP" });
      await expect(mkdirForms[form](path.join(fileLink, "sub"))).rejects.toMatchObject({ code: "ENOTDIR" });
      expect(fs.existsSync(missing)).toBe(false);
    });
  });
});
