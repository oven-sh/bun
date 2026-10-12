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

// `a//b` names the same directories as `a/b`, but the parent the recursive walk
// creates on the way must be named `a`, not `a/`: macOS and FreeBSD resolve the
// trailing separator through a symlink at `a` and mkdir creates the link's target
// (Linux fails with EEXIST for either name). The walk used to cut the parent at
// the last separator of a run, so on those systems `dangling//out` created
// `missing` and `missing/out` through the link; node on Linux reports ENOENT for
// both spellings. Skipped on Windows, where the path is normalized (runs
// collapsed) before the walk.
describe.skipIf(isWindows)("fs.mkdir - recursive with doubled separators", () => {
  let tmpdir: string;

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
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpdir, { recursive: true, force: true });
    } catch (err) {
      // Ignore cleanup errors
    }
  });

  describe.each(forms)("%s", form => {
    it("reports ENOENT below a dangling symlink and creates nothing", async () => {
      fs.symlinkSync("missing", path.join(tmpdir, "dangling"));

      const pathname = `${tmpdir}/dangling//out`;
      await expect(mkdirForms[form](pathname)).rejects.toMatchObject({
        code: "ENOENT",
        syscall: "mkdir",
        path: pathname,
      });
      expect(fs.readdirSync(tmpdir)).toEqual(["dangling"]);
    });

    // With more components below the link, the error comes from the walk back down.
    it("reports ENOENT below a dangling symlink with further components and creates nothing", async () => {
      fs.symlinkSync("missing", path.join(tmpdir, "dangling"));

      const pathname = `${tmpdir}/dangling//out//deeper`;
      await expect(mkdirForms[form](pathname)).rejects.toMatchObject({
        code: "ENOENT",
        syscall: "mkdir",
        path: pathname,
      });
      expect(fs.readdirSync(tmpdir)).toEqual(["dangling"]);
    });

    // Node splits the path at its last separator, so the first path it creates
    // for `a//b` (and returns) is spelled `a/`; the returned spelling is kept
    // even though the directory itself is created under the name `a`.
    it("creates the directories and returns the first one spelled as node does", async () => {
      expect(await mkdirForms[form](`${tmpdir}/a//b`)).toBe(`${tmpdir}/a/`);
      expect(fs.statSync(path.join(tmpdir, "a", "b")).isDirectory()).toBe(true);
      expect(fs.readdirSync(tmpdir)).toEqual(["a"]);
      expect(fs.readdirSync(path.join(tmpdir, "a"))).toEqual(["b"]);
    });

    it("creates every component of a path with several separator runs", async () => {
      expect(await mkdirForms[form](`${tmpdir}/c///d//e`)).toBe(`${tmpdir}/c//`);
      expect(fs.statSync(path.join(tmpdir, "c", "d", "e")).isDirectory()).toBe(true);
      expect(fs.readdirSync(tmpdir)).toEqual(["c"]);
      expect(fs.readdirSync(path.join(tmpdir, "c"))).toEqual(["d"]);
      expect(fs.readdirSync(path.join(tmpdir, "c", "d"))).toEqual(["e"]);
    });

    it("creates the missing part below an existing directory spelled with a run", async () => {
      fs.mkdirSync(path.join(tmpdir, "existing"));

      expect(await mkdirForms[form](`${tmpdir}/existing//x//y`)).toBe(`${tmpdir}/existing//x/`);
      expect(fs.statSync(path.join(tmpdir, "existing", "x", "y")).isDirectory()).toBe(true);
      expect(fs.readdirSync(tmpdir)).toEqual(["existing"]);
    });
  });
});
