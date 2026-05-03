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
  // normalizeStringGenericTZ, which does not bounds-check.
  it("rejects overly long absolute drive-letter paths", () => {
    const absLong = "C:\\" + Buffer.alloc(32762, "a").toString();
    expect(() => fs.readdirSync(absLong)).toThrow("ENAMETOOLONG");
  });

  // Device paths (\\.\...) are copied verbatim into `buf` with a trailing NUL.
  it("rejects overly long device paths", () => {
    const devLong = "\\\\.\\" + Buffer.alloc(32763, "a").toString();
    expect(() => fs.readdirSync(devLong)).toThrow("ENAMETOOLONG");
  });
});
