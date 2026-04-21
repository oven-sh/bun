import { describe, expect, it } from "bun:test";
import { isPosix } from "harness";
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
