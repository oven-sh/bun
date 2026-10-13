import { expect, test } from "bun:test";
import { symlink } from "fs/promises";
import { tempDir } from "harness";
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
  const missing = expect.objectContaining({
    name: "TypeError",
    code: "ERR_MISSING_ARGS",
    message: "Not enough arguments",
  });
  const glob = new Bun.Glob("*");
  expect(() => new (Bun.Glob as any)()).toThrow(missing);
  expect(() => new Bun.Glob(5 as any)).toThrow(invalid("pattern must be a string"));
  expect(() => (glob.match as any)()).toThrow(missing);
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

  // An array is an object with none of the options.
  expect(scan("package.json", [])).toEqual(scan("package.json", {}));
  expect(scan("*", Object.assign([], { cwd, dot: true }))).toEqual([".dot", "a.txt"]);
});
