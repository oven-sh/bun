import { describe, expect, it } from "bun:test";
import { isLinux, isMacOS, isPosix, isWindows, tempDir } from "harness";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

// On POSIX systems, MAX_PATH_BYTES is 4096.
// Path validation must account for the actual UTF-8 byte length of strings,
// not just the number of characters (UTF-16 code units), since multi-byte
// characters expand when encoded as UTF-8.
describe.if(isPosix)("path length validation with multi-byte characters", () => {
  // U+4E00 (一) is a CJK character that is 3 bytes in UTF-8 (0xE4 0xB8 0x80).
  // 2000 such characters = 2000 UTF-16 code units but 6000 UTF-8 bytes,
  // which exceeds the 4096-byte PathBuffer.
  const cjkPath = "\u4e00".repeat(2000);

  it("rejects overly long multi-byte paths in openSync", () => {
    expect(() => fs.openSync(cjkPath, "r")).toThrow("ENAMETOOLONG");
  });

  it("rejects overly long multi-byte paths in readFileSync", () => {
    expect(() => fs.readFileSync(cjkPath)).toThrow("ENAMETOOLONG");
  });

  it("rejects overly long multi-byte paths in statSync", () => {
    expect(() => fs.statSync(cjkPath)).toThrow("ENAMETOOLONG");
  });

  it("rejects overly long multi-byte paths in realpathSync", () => {
    expect(() => fs.realpathSync(cjkPath)).toThrow("ENAMETOOLONG");
  });

  it("rejects overly long multi-byte paths in async readFile", async () => {
    expect(async () => await fs.promises.readFile(cjkPath)).toThrow("ENAMETOOLONG");
  });

  it("rejects overly long multi-byte paths in async stat", async () => {
    expect(async () => await fs.promises.stat(cjkPath)).toThrow("ENAMETOOLONG");
  });

  // 2-byte UTF-8 characters (U+0080 to U+07FF range)
  it("rejects overly long 2-byte UTF-8 paths", () => {
    // U+00E9 (é) is 2 bytes in UTF-8. 3000 chars = 6000 bytes > 4096
    const accentPath = "\u00e9".repeat(3000);
    expect(() => fs.statSync(accentPath)).toThrow("ENAMETOOLONG");
  });

  // PATH_MAX (Linux 4096, macOS 1024) includes the NUL terminator, so the
  // longest usable path string is PATH_MAX-1 bytes. A path of exactly
  // PATH_MAX bytes used to pass the `0..=MAX_PATH_BYTES` length guard, then
  // `slice_z_with_force_copy` had no room for the NUL and returned "" — the
  // syscall ran on the empty path and came back ENOENT instead of
  // ENAMETOOLONG. PATH_MAX-1 (kernel rejects) and PATH_MAX+1 (guard rejects)
  // were already correct; only this one length was wrong.
  describe.each([
    ["Linux", isLinux, 4096],
    ["macOS", isMacOS, 1024],
  ])("PATH_MAX boundary on %s", (_, isHost, PATH_MAX) => {
    const mk = (n: number) => "/tmp/" + Buffer.alloc(n - 5, "A").toString();
    it.if(isHost).each([PATH_MAX - 1, PATH_MAX, PATH_MAX + 1])(
      "returns ENAMETOOLONG for a %i-byte path (sync/promises/Buffer)",
      async n => {
        const p = mk(n);
        expect(() => fs.statSync(p)).toThrow(expect.objectContaining({ code: "ENAMETOOLONG" }));
        expect(() => fs.openSync(p, "r")).toThrow(expect.objectContaining({ code: "ENAMETOOLONG" }));
        expect(() => fs.mkdirSync(p)).toThrow(expect.objectContaining({ code: "ENAMETOOLONG" }));
        expect(() => fs.statSync(Buffer.from(p))).toThrow(expect.objectContaining({ code: "ENAMETOOLONG" }));
        await expect(fs.promises.stat(p)).rejects.toMatchObject({ code: "ENAMETOOLONG" });
      },
    );
  });

  // Verify that the process does not crash - the key property is that these
  // throw a proper JS error rather than segfaulting.
  it("does not crash with 4-byte UTF-8 characters exceeding buffer", () => {
    // U+1F600 (😀) is 4 bytes in UTF-8, 2 UTF-16 code units (surrogate pair).
    // 1500 emoji = 3000 UTF-16 code units but 6000 UTF-8 bytes > 4096
    const emojiPath = "\u{1F600}".repeat(1500);
    expect(() => fs.statSync(emojiPath)).toThrow("ENAMETOOLONG");
  });
});

// On Windows, PATH_MAX_WIDE is 32767 u16 code units. normalizePathWindows
// copies the input and/or the joined cwd + input into pooled [32767]u16
// buffers at several points. Each copy site must return ENAMETOOLONG rather
// than writing past the buffer when the input would not fit.
describe.if(isWindows)("path length validation in normalizePathWindows", () => {
  // 32765 ASCII chars → 32765 u16 after UTF-8→UTF-16 conversion (fits in the
  // 32767-u16 conversion buffer). Even a minimal cwd like "C:\" (3 chars)
  // brings the joined length past 32767.
  const longRelative = "./" + Buffer.alloc(32763, "a").toString();

  it("rejects overly long relative paths in readdirSync", () => {
    expect(() => fs.readdirSync(longRelative)).toThrow("ENAMETOOLONG");
  });

  it("rejects overly long relative paths in writeFileSync", () => {
    expect(() => fs.writeFileSync(longRelative, "")).toThrow("ENAMETOOLONG");
  });

  // A relative path containing no '\\', '/', or '.' takes the early-return
  // branch that copies the path directly into `buf` and appends a NUL. When
  // path.len == buf.len the NUL write would land one past the end.
  it("rejects a PATH_MAX_WIDE-length separator-free relative path", () => {
    const noSep = Buffer.alloc(32767, "a").toString();
    expect(() => fs.readdirSync(noSep)).toThrow("ENAMETOOLONG");
  });

  // The UTF-8→UTF-16 conversion at the top of normalizePathWindows forwards
  // only the output pointer to simdutf, which performs no bounds checking.
  // Upstream path validation caps at MAX_PATH_BYTES (~98302 on Windows), not
  // PATH_MAX_WIDE, so inputs in (32767, 98302] bytes reach the conversion.
  it("rejects relative paths longer than the UTF-16 conversion buffer", () => {
    const tooLong = Buffer.alloc(40000, "a").toString();
    expect(() => fs.readdirSync(tooLong)).toThrow("ENAMETOOLONG");
  });

  // Absolute drive-letter paths are normalized into `buf` with an NT object
  // prefix (\??\ or \??\UNC\) and NUL terminator added by
  // normalizeStringGenericTZ, which does not bounds-check. node:fs prepends
  // a \\?\ long-path prefix before reaching normalizePathWindows, so size
  // the input so that prefixed length (+4) still fits the 32767-u16
  // conversion buffer and the headroom guard is what rejects it.
  it("rejects overly long absolute drive-letter paths", () => {
    const absLong = "C:\\" + Buffer.alloc(32757, "a").toString();
    expect(() => fs.readdirSync(absLong)).toThrow("ENAMETOOLONG");
  });

  // Device paths (\\.\...) are copied verbatim into `buf` with a trailing NUL.
  it("rejects overly long device paths", () => {
    const devLong = "\\\\.\\" + Buffer.alloc(32763, "a").toString();
    expect(() => fs.readdirSync(devLong)).toThrow("ENAMETOOLONG");
  });
});

// On Windows, node:fs converts paths to UTF-16 into fixed-size wide buffers
// (PathLike.osPath: a [32767]u16 WPathBuffer; PathLike.osPathKernel32: the
// 98302-byte PathBuffer viewed as [49151]u16). Path validation only bounds
// the UTF-8 *byte* length (98302), so an ASCII path of 32767..98302 chars
// passed validation and the UTF-8→UTF-16 conversion wrote past the wide
// buffer (simdutf performs no bounds checking), panicking with "range end
// index 49151 out of range for slice of length 49150". Paths that long can't
// exist on NT (PATH_MAX_WIDE caps them), so the conversions now reject them
// up front: exists → false, other ops → ENAMETOOLONG.
describe.if(isWindows)("path length validation against UTF-16 conversion buffers", () => {
  // Used to overflow the 49151-u16 osPathKernel32 view (exists, recursive
  // mkdir, copyFile src).
  const kernel32Long = "C:\\" + Buffer.alloc(49200, "a").toString();
  // Used to overflow the 32767-u16 WPathBuffer (copyFile dest, cp).
  const wideLong = "C:\\" + Buffer.alloc(40000, "a").toString();

  it("existsSync returns false instead of crashing", () => {
    expect(fs.existsSync(kernel32Long)).toBe(false);
  });

  // https://github.com/oven-sh/bun/issues/20258 — drive-letter-less paths of
  // 49151..98302 chars crashed existsSync (49150 and 98303 already worked:
  // the former fit the buffer, the latter exceeded the UTF-8 byte check).
  it.each([49150, 49151, 64503, 98302, 98303])(
    "existsSync handles path length %i across the buffer boundaries (#20258)",
    len => {
      expect(fs.existsSync(Buffer.alloc(len, "A").toString())).toBe(false);
    },
  );

  it("rejects over-long paths in accessSync", () => {
    expect(() => fs.accessSync(kernel32Long)).toThrow("ENAMETOOLONG");
  });

  // slice_z's drive-letter branch adds the \\?\ prefix in the 98302-byte
  // PathBuffer; for byte lengths in (98297, 98302] the prefixed copy used to
  // write past the buffer. It must fall back to the unprefixed form and
  // surface the syscall's error (which one depends on the OS/filesystem).
  it("handles drive-letter paths in the last bytes below MAX_PATH_BYTES", () => {
    const p = "C:\\" + Buffer.alloc(98297, "a").toString();
    expect(() => fs.statSync(p)).toThrow(/ENOENT|ENAMETOOLONG|EINVAL/);
  });

  it("rejects over-long paths in recursive mkdirSync", () => {
    expect(() => fs.mkdirSync(kernel32Long, { recursive: true })).toThrow("ENAMETOOLONG");
  });

  it("rejects over-long src paths in copyFileSync", () => {
    expect(() => fs.copyFileSync(kernel32Long, "copy-file-dest-does-not-matter.txt")).toThrow("ENAMETOOLONG");
  });

  it("rejects over-long dest paths in copyFileSync", () => {
    expect(() => fs.copyFileSync("copy-file-src-does-not-matter.txt", wideLong)).toThrow("ENAMETOOLONG");
  });

  it("rejects over-long paths in cpSync", () => {
    expect(() => fs.cpSync(wideLong, "cp-dest-does-not-matter.txt")).toThrow("ENAMETOOLONG");
  });

  it("rejects over-long paths in async fs.promises.mkdir", async () => {
    expect(async () => await fs.promises.mkdir(kernel32Long, { recursive: true })).toThrow("ENAMETOOLONG");
  });

  it("rejects over-long Buffer paths", () => {
    expect(() => fs.mkdirSync(Buffer.from(kernel32Long), { recursive: true })).toThrow("ENAMETOOLONG");
  });

  it("still accepts multi-byte paths that are long in bytes but within the UTF-16 bound", () => {
    // 150 × 200-char CJK segments: 90152 UTF-8 bytes — past the UTF-16-unit
    // limit in bytes — but only 30152 UTF-16 units, so
    // fits_in_wide_path_buffer must compute the exact length and accept it.
    // Each component stays under NTFS's 255-unit limit so the only possible
    // syscall failure is non-existence: copyFileSync (which checks both
    // paths against the guard and does not swallow errors) must get past
    // the length guard and fail with ENOENT — not ENAMETOOLONG.
    const segment = Buffer.alloc(600, "\u4e00").toString();
    const p = "C:\\" + Array(150).fill(segment).join("\\");
    expect(() => fs.copyFileSync(p, "copy-file-dest-does-not-matter.txt")).toThrow("ENOENT");
  });
});

describe.if(isWindows)("Buffer paths containing malformed byte sequences", () => {
  it("decodes each malformed byte as U+FFFD in the resulting file name", () => {
    using dir = tempDir("fs-buffer-path-malformed", {});
    const base = Buffer.from(String(dir) + "\\");
    fs.mkdirSync(String(dir) + "\\sub");
    fs.writeFileSync(Buffer.concat([base, Buffer.from("sub"), Buffer.from([0xc0, 0xaf]), Buffer.from("file")]), "1");
    fs.writeFileSync(Buffer.concat([base, Buffer.from("a"), Buffer.from([0xc0, 0xae]), Buffer.from("b")]), "2");
    fs.writeFileSync(Buffer.concat([base, Buffer.from("c"), Buffer.from([0xc0, 0x80]), Buffer.from("d")]), "3");
    fs.writeFileSync(Buffer.concat([base, Buffer.from("e"), Buffer.from([0xc2]), Buffer.from("F")]), "4");
    fs.writeFileSync(Buffer.concat([base, Buffer.from("g"), Buffer.from([0xe0, 0x80, 0x80]), Buffer.from("h")]), "5");
    expect(fs.readdirSync(String(dir)).sort()).toEqual([
      "a\uFFFD\uFFFDb",
      "c\uFFFD\uFFFDd",
      "e\uFFFDF",
      "g\uFFFD\uFFFD\uFFFDh",
      "sub",
      "sub\uFFFD\uFFFDfile",
    ]);
    expect(fs.readdirSync(String(dir) + "\\sub")).toEqual([]);
    expect(fs.readFileSync(String(dir) + "\\e\uFFFDF", "utf8")).toBe("4");
  });
});

// A path of MAX_PATH_BYTES or more never reaches a syscall: the argument parser
// produces the ENAMETOOLONG itself. Node gets that error from the syscall, so
// it arrives through the callback like any other syscall error, and the
// callback APIs (which call the native binding directly, unlike fs.promises'
// async wrappers) must not throw it synchronously. The lengths clear
// MAX_PATH_BYTES on every platform: 4096 Linux, 1024 macOS, 98302 Windows.
describe("callback APIs report a path longer than MAX_PATH_BYTES through the callback", () => {
  const tooLongLength = isWindows ? 100_000 : 5_000;
  const tooLong = (isWindows ? "C:\\" : "/") + Buffer.alloc(tooLongLength, "a").toString();
  // The operand that is not under test. Every operation below fails on
  // `tooLong` before touching the filesystem, so this path is never created.
  const other = "fs-path-length-other-operand";

  type Callback = (err: unknown) => void;
  // [name, call, whether node reports `tooLong` as `err.path` (it is the
  // `dest` of the two-operand calls, and mkdtemp appends its suffix)]
  const calls: [string, (cb: Callback) => void, boolean][] = [
    ["access", cb => fs.access(tooLong, cb), true],
    ["appendFile", cb => fs.appendFile(tooLong, "x", cb), true],
    ["chmod", cb => fs.chmod(tooLong, 0o644, cb), true],
    ["chown", cb => fs.chown(tooLong, 0, 0, cb), true],
    ["copyFile", cb => fs.copyFile(tooLong, other, cb), true],
    ["cp", cb => fs.cp(tooLong, other, cb), true],
    ["lstat", cb => fs.lstat(tooLong, cb), true],
    ["mkdir", cb => fs.mkdir(tooLong, cb), true],
    ["mkdir recursive", cb => fs.mkdir(tooLong, { recursive: true }, cb), true],
    ["mkdtemp", cb => fs.mkdtemp(tooLong, cb), false],
    ["open", cb => fs.open(tooLong, "r", cb), true],
    ["opendir", cb => fs.opendir(tooLong, cb), true],
    ["readdir", cb => fs.readdir(tooLong, cb), true],
    ["readdir recursive", cb => fs.readdir(tooLong, { recursive: true }, cb), true],
    ["readFile", cb => fs.readFile(tooLong, cb), true],
    ["readlink", cb => fs.readlink(tooLong, cb), true],
    ["realpath", cb => fs.realpath(tooLong, cb), true],
    ["realpath.native", cb => fs.realpath.native(tooLong, cb), true],
    ["rename oldPath", cb => fs.rename(tooLong, other, cb), true],
    ["rename newPath", cb => fs.rename(other, tooLong, cb), false],
    ["rm", cb => fs.rm(tooLong, cb), true],
    ["rmdir", cb => fs.rmdir(tooLong, cb), true],
    ["stat", cb => fs.stat(tooLong, cb), true],
    ["stat with a Buffer path", cb => fs.stat(Buffer.from(tooLong), cb), true],
    ["stat with a file: URL path", cb => fs.stat(pathToFileURL(tooLong), cb), true],
    ["statfs", cb => fs.statfs(tooLong, cb), true],
    ["symlink", cb => fs.symlink(other, tooLong, cb), false],
    ["truncate", cb => fs.truncate(tooLong, cb), true],
    ["unlink", cb => fs.unlink(tooLong, cb), true],
    ["utimes", cb => fs.utimes(tooLong, 0, 0, cb), true],
    ["writeFile", cb => fs.writeFile(tooLong, "x", cb), true],
  ];

  it.each(calls)("fs.%s", async (_, call, pathIsReported) => {
    const { promise, resolve } = Promise.withResolvers<unknown>();
    let returned = false;
    let calledBeforeReturning = false;
    call(err => {
      calledBeforeReturning = !returned;
      resolve(err);
    });
    returned = true;
    const err = (await promise) as NodeJS.ErrnoException;
    expect(calledBeforeReturning).toBe(false);
    expect(err.code).toBe("ENAMETOOLONG");
    if (pathIsReported) {
      expect(err.path).toBe(tooLong);
    }
  });

  // https://github.com/oven-sh/bun/issues/25659
  it("a relative path is reported the same way (#25659)", async () => {
    const { promise, resolve } = Promise.withResolvers<unknown>();
    const order: string[] = [];
    fs.readFile(Buffer.alloc(tooLongLength, "a").toString(), err => {
      order.push("callback");
      resolve(err);
    });
    order.push("returned");
    const err = (await promise) as NodeJS.ErrnoException;
    expect(order).toEqual(["returned", "callback"]);
    expect(err.code).toBe("ENAMETOOLONG");
  });

  it("fs.exists answers false", async () => {
    const { promise, resolve } = Promise.withResolvers<boolean>();
    fs.exists(tooLong, resolve);
    expect(await promise).toBe(false);
  });

  // Node validates the other arguments before issuing the syscall, so an
  // invalid option still throws synchronously and wins over the path's errno.
  it("an invalid option still throws synchronously", () => {
    expect(() => fs.readdir(tooLong, { encoding: "bogus" as BufferEncoding }, () => {})).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }),
    );
    expect(() => fs.readFile(tooLong, { encoding: "bogus" as BufferEncoding }, () => {})).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }),
    );
  });

  it("the sync variants throw it, naming the path", () => {
    expect(() => fs.statSync(tooLong)).toThrow(expect.objectContaining({ code: "ENAMETOOLONG", path: tooLong }));
    expect(() => fs.statSync(Buffer.from(tooLong))).toThrow(
      expect.objectContaining({ code: "ENAMETOOLONG", path: tooLong }),
    );
    expect(() => fs.renameSync(other, tooLong)).toThrow(expect.objectContaining({ code: "ENAMETOOLONG" }));
  });
});
