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

  // WTF::String::fromUTF8 converts into a buffer of one UTF-16 code unit for each byte. It sized that buffer with a
  // Vector constructor, which aborts the process when the allocation fails or is past 2**30 - 1 code units:
  // `panic(main thread): abort() called`, exit code 134. WTF::URL::fileSystemPath() decodes the path through it. The
  // conversion now fails instead, so the path does not decode, like a path that is not UTF-8.
  describe("a path too long to decode", () => {
    // A URL with a host is a UNC path on Windows. A path that did not decode must not give the UNC root there.
    const roots = isWindows ? ["file:///C:/", "file://server/share/"] : ["file:///"];
    // fileURLToPath wants an absolute path on Windows, and a path that did not decode is not one.
    const doesNotDecode = isWindows ? "ERR_INVALID_FILE_URL_PATH" : '""';

    async function fileURLToPathInChild(urlRoots, pathLength, env = {}) {
      const script = `
        import { fileURLToPath } from "node:url";
        // U+4E00 keeps the decoded path from being all ASCII, which converts with no UTF-16 buffer.
        // repeat() makes a rope, so the child holds the long path once.
        const path = "%E4%B8%80" + "q".repeat(${pathLength});
        for (const root of ${JSON.stringify(urlRoots)}) {
          try {
            console.log(JSON.stringify(fileURLToPath(root + path)));
          } catch (e) {
            console.log(e.code);
          }
        }
      `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", script],
        env: { ...bunEnv, ...env },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout: stdout.trim().split("\n"), stderr, exitCode };
    }

    // `BUN_JSC_maxSingleAllocationSize` exists in a debug WTF only. A fallible allocation above it fails and an
    // infallible one asserts. The decoded path is 2.5 MiB, so its UTF-16 buffer is 5 MiB, and every other allocation
    // stays below the 4 MiB cap.
    it.skipIf(!isDebug)("because the UTF-16 buffer cannot be allocated", async () => {
      const result = await fileURLToPathInChild(roots, 2.5 * 1024 ** 2, {
        BUN_JSC_maxSingleAllocationSize: String(4 * 1024 ** 2),
      });
      expect(result).toEqual({ stdout: roots.map(() => doesNotDecode), stderr: "", exitCode: 0 });
    });

    // A debug build takes minutes to parse a URL of this size. The child peaks at 3 GiB.
    it.skipIf(isDebug || isASAN || totalmem() < 6 * 1024 ** 3)(
      "because the UTF-16 buffer is past the Vector limit",
      async () => {
        const result = await fileURLToPathInChild(roots.slice(0, 1), 2 ** 30);
        expect(result).toEqual({ stdout: [doesNotDecode], stderr: "", exitCode: 0 });
      },
      30_000,
    );
  });
});
