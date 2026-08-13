import { fileURLToPath, pathToFileURL } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { pathToFileURL as nodePathToFileURL } from "node:url";

describe("pathToFileURL", () => {
  it("should convert a path to a file url", () => {
    expect(pathToFileURL("/path/to/file.js").href).toBe("file:///path/to/file.js");
  });

  it("should handle relative paths longer than PATH_MAX", () => {
    const long = Buffer.alloc(6000, "a").toString();
    const url = pathToFileURL(long);
    expect(url.href.endsWith("/" + long)).toBe(true);
  });

  it("should normalize long relative paths with .. segments", () => {
    const input = Buffer.alloc(14000, "abcdef/").toString() + Buffer.alloc(6000, "../").toString() + "final";
    const url = pathToFileURL(input);
    expect(url.href).toBe(`${pathToFileURL(process.cwd())}/final`);
  });

  // On POSIX a backslash is an ordinary filename character, so it must be
  // percent-encoded, never treated as a separator. On Windows it is a separator.
  it.skipIf(isWindows)("should percent-encode backslashes in relative paths on POSIX", () => {
    const cwd = pathToFileURL(process.cwd()).href;
    expect({
      relative: pathToFileURL("a\\b").href,
      relativeWithDotDot: pathToFileURL("x\\..\\y").href,
      dotSlash: pathToFileURL("./q\\r").href,
      nonAscii: pathToFileURL("日本\\語").href,
      absolute: pathToFileURL("/abs\\b").href,
    }).toEqual({
      relative: `${cwd}/a%5Cb`,
      relativeWithDotDot: `${cwd}/x%5C..%5Cy`,
      dotSlash: `${cwd}/q%5Cr`,
      nonAscii: `${cwd}/%E6%97%A5%E6%9C%AC%5C%E8%AA%9E`,
      absolute: "file:///abs%5Cb",
    });
  });

  it("should resolve . and .. and repeated separators in absolute paths like path.resolve", () => {
    const cwdPath = process.cwd();
    const cwd = pathToFileURL(cwdPath).href;
    expect({
      trailingDotDot: pathToFileURL(`${cwdPath}/child/..`).href,
      trailingDot: pathToFileURL(`${cwdPath}/child/.`).href,
      doubleSlash: pathToFileURL(`${cwdPath}//child`).href,
    }).toEqual({
      trailingDotDot: cwd,
      trailingDot: `${cwd}/child`,
      doubleSlash: `${cwd}/child`,
    });
  });

  it.skipIf(isWindows)("should keep the root and a trailing slash on POSIX", () => {
    const cwd = pathToFileURL(process.cwd()).href;
    expect({
      root: pathToFileURL("/").href,
      rootDotDot: pathToFileURL("/..").href,
      leadingDoubleSlash: pathToFileURL("//dir/file").href,
      relativeTrailingSlash: pathToFileURL("dir/").href,
      absoluteTrailingSlash: pathToFileURL("/dir/").href,
      dotDotTrailingSlash: pathToFileURL("dir/sub/../").href,
      dotSlash: pathToFileURL("./").href,
    }).toEqual({
      root: "file:///",
      rootDotDot: "file:///",
      leadingDoubleSlash: "file:///dir/file",
      relativeTrailingSlash: `${cwd}/dir/`,
      absoluteTrailingSlash: "file:///dir/",
      dotDotTrailingSlash: `${cwd}/dir/`,
      dotSlash: `${cwd}/`,
    });
  });

  it("should match node:url's pathToFileURL", () => {
    const inputs = [
      "",
      ".",
      "..",
      "./",
      "dir",
      "dir/",
      "dir/sub/..",
      "dir/sub/../",
      "dir//sub",
      "a\\b",
      "x\\..\\y",
      "日本\\語",
      "a b#c?d%e[f]^g|h~i",
      process.cwd(),
      `${process.cwd()}/`,
      `${process.cwd()}/child/..`,
      `${process.cwd()}//child/./sub`,
    ];
    expect(inputs.map(input => pathToFileURL(input).href)).toEqual(inputs.map(input => nodePathToFileURL(input).href));
  });

  it("should resolve relative paths against the cwd set by process.chdir()", async () => {
    using dir = tempDir("path-to-file-url-chdir", { "sub": {} });
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `process.chdir("sub");
         const cwd = Bun.pathToFileURL(process.cwd()).href;
         console.log(JSON.stringify([Bun.pathToFileURL("").href === cwd, Bun.pathToFileURL("file.txt").href === cwd + "/file.txt"]));`,
      ],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("[true,true]\n");
    expect(exitCode).toBe(0);
  });
});

describe("fileURLToPath", () => {
  const absoluteErrorMessage = "File URL path must be an absolute";
  it("should convert a file url to a path", () => {
    if (isWindows) {
      expect(() => fileURLToPath("file:///path/to/file.js")).toThrow(absoluteErrorMessage);
    } else {
      expect(fileURLToPath("file:///path/to/file.js")).toBe("/path/to/file.js");
    }
  });

  it("should convert a URL to a path", () => {
    if (isWindows) {
      expect(() => fileURLToPath(new URL("file:///path/to/file.js"))).toThrow(absoluteErrorMessage);
    } else {
      expect(fileURLToPath(new URL("file:///path/to/file.js"))).toBe("/path/to/file.js");
    }
  });

  it("should fail on non-file: URLs", () => {
    expect(() => fileURLToPath(new URL("http:///path/to/file.js"))).toThrow();
  });

  describe("should fail on non URLs", () => {
    const fuzz = [1, true, Symbol("foo"), {}, [], () => {}, null, undefined, NaN, Infinity, -Infinity, new Boolean()];
    fuzz.forEach(value => {
      it(`${String(value)}`, () => {
        expect(() => fileURLToPath(value)).toThrow();
      });
    });
  });

  it("should add absolute part to relative file (#6456)", () => {
    const url = pathToFileURL("foo.txt");
    expect(url.href).toBe(`${pathToFileURL(process.cwd())}/foo.txt`);
  });

  it("should roundtrip", () => {
    const url = pathToFileURL(import.meta.path);
    expect(fileURLToPath(url)).toBe(import.meta.path);
    expect(fileURLToPath(import.meta.url)).toBe(import.meta.path);
  });
});
