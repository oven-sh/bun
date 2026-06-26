import { describe, expect, it } from "bun:test";
import { isPosix, isWindows } from "harness";
import fs from "node:fs";

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
