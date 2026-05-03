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
// joins the dirfd's resolved path with the relative input path into a pooled
// [32767]u16 buffer. A relative path that fits in a WPathBuffer on its own but
// overflows once the cwd is prepended must return ENAMETOOLONG rather than
// writing past the buffer.
describe.if(isWindows)("path length validation when joining cwd + relative path on Windows", () => {
  // 32765 ASCII chars → 32765 u16 after UTF-8→UTF-16 conversion (fits in the
  // 32767-u16 conversion buffer). Even a minimal cwd like "C:\" (3 chars)
  // brings the joined length to 3 + 1 + 32765 = 32769 > 32767.
  const longRelative = "./" + Buffer.alloc(32763, "a").toString();

  it("rejects overly long relative paths in readdirSync", () => {
    expect(() => fs.readdirSync(longRelative)).toThrow("ENAMETOOLONG");
  });

  it("rejects overly long relative paths in writeFileSync", () => {
    expect(() => fs.writeFileSync(longRelative, "")).toThrow("ENAMETOOLONG");
  });

  // A relative path containing no '\\', '/', or '.' takes the early-return
  // branch in normalizePathWindows that copies the path directly into `buf`
  // and appends a NUL. When path.len == buf.len the NUL write lands one past
  // the end of the buffer; this must be rejected with ENAMETOOLONG instead.
  it("rejects a PATH_MAX_WIDE-length separator-free relative path in readdirSync", () => {
    const noSep = Buffer.alloc(32767, "a").toString();
    expect(() => fs.readdirSync(noSep)).toThrow("ENAMETOOLONG");
  });
});
