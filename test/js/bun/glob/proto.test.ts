import { expect, test } from "bun:test";
import { symlink } from "fs/promises";
import { isDebug, tempDir } from "harness";
import path from "path";

test("Object prototype followSymlinks", async () => {
  await using dir = tempDir("glob-follow", {
    "abc/def/file.txt": "file",
    "symed/file2.txt": "file",
  });

  await symlink(path.join(dir, "symed"), path.join(dir, "abc/def/sym"), "dir");
  const glob = new Bun.Glob("**/*.txt");

  const zero = glob.scanSync({
    "cwd": path.join(dir, "abc"),
    onlyFiles: true,
    followSymlinks: true,
  });
  expect([...zero].map(a => a.replaceAll("\\", "/")).sort()).toEqual(["def/file.txt", "def/sym/file2.txt"]);

  const first = glob.scanSync({
    "cwd": path.join(dir, "abc"),
    onlyFiles: true,
  });
  expect([...first].map(a => a.replaceAll("\\", "/"))).toEqual(["def/file.txt"]);

  Object.defineProperty(Object.prototype, "followSymlinks", {
    value: true,
    writable: true,
    configurable: true,
    enumerable: true,
  });
  const second = glob.scanSync({
    "cwd": path.join(dir, "abc"),
    onlyFiles: true,
  });
  expect([...second].map(a => a.replaceAll("\\", "/"))).toEqual(["def/file.txt"]);
  delete (Object.prototype as any).followSymlinks;

  const third = glob.scanSync({
    "cwd": path.join(dir, "abc"),
    onlyFiles: true,
  });
  expect([...third].map(a => a.replaceAll("\\", "/"))).toEqual(["def/file.txt"]);
});

test("arguments of the wrong type throw a TypeError", () => {
  const invalid = (message: string) =>
    expect.objectContaining({ name: "TypeError", code: "ERR_INVALID_ARG_TYPE", message });
  const glob = new Bun.Glob("*");
  expect(() => new (Bun.Glob as any)()).toThrow(invalid("pattern must be a string"));
  expect(() => new Bun.Glob(5 as any)).toThrow(invalid("pattern must be a string"));
  expect(() => (glob.match as any)()).toThrow(invalid("str must be a string"));
  expect(() => glob.match(5 as any)).toThrow(invalid("str must be a string"));
  expect(() => glob.scanSync(5 as any)).toThrow(invalid("GlobScanOptions must be an object"));
  expect(() => glob.scan(5 as any)).toThrow(invalid("GlobScanOptions must be an object"));
  expect(() => glob.scanSync({ cwd: 5 as any })).toThrow(invalid("GlobScanOptions.cwd must be a string"));
  expect(Bun.Glob.length).toBe(1);
});

test("scan options", () => {
  using dir = tempDir("glob-options", { "a.txt": "", ".dot": "", "sub/b.txt": "" });
  const cwd = String(dir);
  const scan = (pattern: string, options: any) => [...new Bun.Glob(pattern).scanSync(options)].sort();

  // Booleans are ToBoolean.
  expect(scan("*", { cwd, dot: 1 })).toEqual([".dot", "a.txt"]);
  expect(scan("*", { cwd, dot: 0 })).toEqual(["a.txt"]);
  expect(scan("*", { cwd, onlyFiles: 1 })).toEqual(["a.txt"]);
  expect(scan("*", { cwd, onlyFiles: "" })).toEqual(["a.txt", "sub"]);
  expect(scan("*", { cwd, onlyFiles: null })).toEqual(["a.txt"]);

  // A String object is a cwd, as the argument and as the option.
  expect(scan("*", new String(path.join(cwd, "sub")))).toEqual(["b.txt"]);
  expect(scan("*", { cwd: new String(path.join(cwd, "sub")) })).toEqual(["b.txt"]);

  // An array is read like any other object.
  expect(scan("*", Object.assign([], { cwd, dot: true }))).toEqual([".dot", "a.txt"]);
});

test("every option is read before a cwd that is too long is reported", () => {
  const read: string[] = [];
  const options = {
    get cwd() {
      read.push("cwd");
      // Over MAX_PATH_BYTES everywhere: Windows has the largest, 98302.
      return Buffer.alloc(100_000, "a").toString();
    },
    get dot() {
      read.push("dot");
      return false;
    },
  };
  expect(() => new Bun.Glob("*").scanSync(options)).toThrow("scanSync: invalid `cwd`, longer than");
  expect(read).toEqual(["cwd", "dot"]);
});

// Debug builds turn on showPrivateScriptsInStackTraces.
test.skipIf(isDebug)("the native half of scan and scanSync is not in a stack trace", async () => {
  const cwd = Buffer.alloc(100_000, "a").toString();
  const glob = new Bun.Glob("*");
  function scanSync() {
    return [...glob.scanSync({ cwd })];
  }
  async function scan() {
    return await Array.fromAsync(glob.scan({ cwd }));
  }
  const frames = (error: Error) => error.stack!.split("\n").filter(line => line.includes("__scan"));
  let thrown: Error | undefined;
  try {
    scanSync();
  } catch (error) {
    thrown = error as Error;
  }
  expect(frames(thrown!)).toEqual([]);
  expect(thrown!.stack).toContain("at scanSync");
  expect(frames(await scan().catch(error => error))).toEqual([]);
});
