import { fileURLToPath, pathToFileURL } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows } from "harness";
import { totalmem } from "node:os";

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

  // WTF::String::fromUTF8 converts into a Vector<char16_t> of one code unit for each byte, and WTF::URL::fileSystemPath()
  // decodes the path through it. WebKit 310668@main halved the capacity of every Vector whose element is wider than a
  // byte, so a decoded path of 2**30 bytes aborted the process: `panic(main thread): abort() called`, exit code 134.
  // Bun 1.3.12 returns the path. A debug build takes minutes to parse a URL of this size, and the child peaks at 7 GiB.
  it.skipIf(isDebug || isASAN || totalmem() < 12 * 1024 ** 3)(
    "decodes a path of 2**30 bytes",
    async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
            import { fileURLToPath } from "node:url";
            // U+4E00 keeps the decoded path from being all ASCII, which converts with no UTF-16 buffer.
            // repeat() makes a rope, so the child holds the long URL once.
            const path = fileURLToPath(${JSON.stringify(isWindows ? "file:///C:/" : "file:///")} + "%E4%B8%80" + "q".repeat(2 ** 30));
            console.log(JSON.stringify({ length: path.length, head: path.slice(0, 5), tail: path.slice(-2) }));
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const root = isWindows ? "C:\\" : "/";
      expect({ stdout: JSON.parse(stdout || "null"), stderr, exitCode }).toEqual({
        stdout: { length: root.length + 1 + 2 ** 30, head: (root + "\u4e00qqq").slice(0, 5), tail: "qq" },
        stderr: "",
        exitCode: 0,
      });
    },
    60_000,
  );
});
