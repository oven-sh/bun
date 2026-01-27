import { constants, kMaxLength, kStringMaxLength } from "buffer";
import { expect, test } from "bun:test";

// Issue #2570: JSON.parse silently truncates strings larger than ~2GB
// Root cause: Mismatch between Bun's string allocation limit and WebKit's String::MaxLength
//
// The fix ensures that readFileSync with string encodings (utf8, ascii, etc.)
// checks against WebKit's String::MaxLength (~2GB) instead of the higher
// typed array limit (~4GB). This prevents silent string truncation that
// caused confusing "JSON Parse error: Unexpected EOF" errors.

test("kStringMaxLength matches WebKit's String::MaxLength (2^31 - 1)", () => {
  // WebKit's String::MaxLength is std::numeric_limits<int32_t>::max()
  const maxInt32 = Math.pow(2, 31) - 1;
  expect(kStringMaxLength).toBe(maxInt32);
  expect(constants.MAX_STRING_LENGTH).toBe(maxInt32);
});

test("buffer encoding has higher limit than string encoding", () => {
  // Buffer encoding uses synthetic_allocation_limit (~4.7GB)
  // String encoding uses string_allocation_limit (~2.15GB)

  // kMaxLength is for buffers/typed arrays
  // kStringMaxLength is for strings
  expect(kMaxLength).toBeGreaterThan(kStringMaxLength);

  // kStringMaxLength should be 2^31 - 1 (maxInt32)
  expect(kStringMaxLength).toBe(2147483647);
});
