import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test";
import { isLinux, isPosix, isWindows, tmpdirSync } from "harness";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const isRoot = process.getuid?.() === 0;

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

// Each target below is `<refusing dir>/missing/b`: mkdir of the target itself fails with
// ENOENT, so the recursive walk moves up to `missing`, and that is the mkdir the refusing
// directory rejects. The error must still name the requested target, as node's mkdirSync and
// every other failure of the walk do; it used to name `<refusing dir>/missing`.
describe("fs.mkdir - recursive error names the requested path", () => {
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

  function describeError(err: any) {
    return err === undefined
      ? undefined
      : { code: err.code, syscall: err.syscall, path: err.path, message: err.message };
  }

  async function recursiveMkdirErrors(target: string) {
    let sync: unknown;
    try {
      fs.mkdirSync(target, { recursive: true });
    } catch (err) {
      sync = err;
    }

    const { promise: callbackDone, resolve } = Promise.withResolvers<unknown>();
    fs.mkdir(target, { recursive: true }, err => resolve(err ?? undefined));
    const callback = await callbackDone;

    const promises = await fs.promises.mkdir(target, { recursive: true }).then(
      () => undefined,
      err => err,
    );

    return { sync: describeError(sync), callback: describeError(callback), promises: describeError(promises) };
  }

  it.skipIf(!isPosix || isRoot)("when a parent cannot be created in an unwritable directory", async () => {
    const unwritable = path.join(tmpdir, nextdir());
    fs.mkdirSync(unwritable);
    fs.chmodSync(unwritable, 0o555);
    try {
      const target = path.join(unwritable, "missing", "b");
      const expected = {
        code: "EACCES",
        syscall: "mkdir",
        path: target,
        message: `EACCES: permission denied, mkdir '${target}'`,
      };

      expect(await recursiveMkdirErrors(target)).toEqual({ sync: expected, callback: expected, promises: expected });
    } finally {
      fs.chmodSync(unwritable, 0o755);
    }
  });

  // sysfs refuses every mkdir, root's included (EROFS when it is mounted read-only, as in
  // containers; otherwise EPERM for root and EACCES for anyone else), so unlike the chmod
  // fixture above this one also exercises the walk when the tests run as root.
  function sysMountIsSysfs() {
    const SYSFS_MAGIC = 0x62656572;
    try {
      return isLinux && fs.statfsSync("/sys").type === SYSFS_MAGIC;
    } catch {
      return false;
    }
  }
  it.skipIf(!sysMountIsSysfs())("when a parent cannot be created on sysfs", async () => {
    const target = "/sys/bun-fs-mkdir-test-missing/b";

    const errors = await recursiveMkdirErrors(target);
    const code = errors.sync?.code;
    expect(["EROFS", "EPERM", "EACCES"]).toContain(code);
    const expected = {
      code,
      syscall: "mkdir",
      path: target,
      message: expect.stringContaining(`, mkdir '${target}'`),
    };
    expect(errors).toEqual({ sync: expected, callback: expected, promises: expected });
  });

  // Windows: a directory whose ACL denies Everyone (S-1-1-0) "add subdirectory" and "add
  // file". A token with the backup/restore privileges enabled (some elevated agents) is not
  // bound by that, so enforcement is probed up front and the test skips visibly in that case.
  let deniedRoot = "";
  let denied = "";
  if (isWindows) {
    try {
      deniedRoot = getTmpDir();
      const dir = path.join(deniedRoot, "denied");
      fs.mkdirSync(dir);
      execSync(`icacls "${dir}" /deny "*S-1-1-0:(AD,WD)"`);
      try {
        fs.mkdirSync(path.join(dir, "probe"));
      } catch {
        denied = dir;
      }
    } catch {}
  }
  afterAll(() => {
    if (!deniedRoot) return;
    try {
      execSync(`icacls "${path.join(deniedRoot, "denied")}" /remove:d "*S-1-1-0"`);
    } catch {}
    try {
      fs.rmSync(deniedRoot, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it.skipIf(!denied)("when a parent cannot be created in a directory whose ACL denies it", async () => {
    const target = path.join(denied, "missing", "b");
    const expected = {
      code: "EPERM",
      syscall: "mkdir",
      path: target,
      message: `EPERM: operation not permitted, mkdir '${target}'`,
    };

    expect(await recursiveMkdirErrors(target)).toEqual({ sync: expected, callback: expected, promises: expected });
  });
});
