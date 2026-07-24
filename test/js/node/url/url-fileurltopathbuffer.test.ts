import { describe, expect, test } from "bun:test";
import { fileURLToPathBuffer, pathToFileURL, parse as urlParse } from "node:url";

// Behavior verified against node v26.3.0: fileURLToPathBuffer decodes the URL
// pathname's percent-escapes literally into bytes, so non-UTF-8 sequences
// (e.g. Shift-JIS) survive where fileURLToPath would throw or mangle.
describe("fileURLToPathBuffer", () => {
  test("returns a Buffer for a plain file URL", () => {
    const buf = fileURLToPathBuffer(new URL("file:///tmp/a.txt"), { windows: false });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.toString()).toBe("/tmp/a.txt");
  });

  test("accepts a string URL", () => {
    expect(fileURLToPathBuffer("file:///tmp/b.txt", { windows: false }).toString()).toBe("/tmp/b.txt");
  });

  test("decodes non-UTF-8 percent-encodings into raw bytes", () => {
    // Shift-JIS "あいう" -- invalid as UTF-8, must pass through byte-for-byte.
    const url = new URL("file:///tmp/%82%A0%82%A2%82%A4");
    const buf = fileURLToPathBuffer(url, { windows: false });
    expect([...buf.subarray(5)]).toEqual([0x82, 0xa0, 0x82, 0xa2, 0x82, 0xa4]);
  });

  test("invalid percent escapes pass through literally", () => {
    const buf = fileURLToPathBuffer(new URL("file:///tmp/%ZZx"), { windows: false });
    expect(buf.toString()).toBe("/tmp/%ZZx");
  });

  test("round-trips a path node's way", () => {
    const url = pathToFileURL("/tmp/some dir/file.txt");
    expect(fileURLToPathBuffer(url, { windows: false }).toString()).toBe("/tmp/some dir/file.txt");
  });

  test("rejects non-file schemes", () => {
    expect(() => fileURLToPathBuffer(new URL("https://example.com/x"))).toThrowWithCode(
      TypeError,
      "ERR_INVALID_URL_SCHEME",
    );
  });

  test("accepts a duck-typed URL object, as node's isURL does", () => {
    const fake = { href: "file:///tmp/x.txt", protocol: "file:", pathname: "/tmp/x.txt", hostname: "" };
    // @ts-expect-error intentionally URL-shaped, not a URL instance
    expect(fileURLToPathBuffer(fake, { windows: false }).toString()).toBe("/tmp/x.txt");
  });

  test("rejects legacy url.parse objects (auth/path present)", () => {
    const legacy = urlParse("file:///tmp/x.txt");
    // @ts-expect-error intentionally passing a legacy Url object
    expect(() => fileURLToPathBuffer(legacy)).toThrowWithCode(TypeError, "ERR_INVALID_ARG_TYPE");
  });

  test("rejects non-URL, non-string input", () => {
    // @ts-expect-error intentional bad input
    expect(() => fileURLToPathBuffer(42)).toThrowWithCode(TypeError, "ERR_INVALID_ARG_TYPE");
  });

  test("rejects a host on posix", () => {
    expect(() => fileURLToPathBuffer(new URL("file://host/x"), { windows: false })).toThrowWithCode(
      TypeError,
      "ERR_INVALID_FILE_URL_HOST",
    );
  });

  test("windows: drive letters and separators", () => {
    expect(fileURLToPathBuffer(new URL("file:///C:/dir/x.txt"), { windows: true }).toString()).toBe("C:\\dir\\x.txt");
    expect(() => fileURLToPathBuffer(new URL("file:///dir/x.txt"), { windows: true })).toThrowWithCode(
      TypeError,
      "ERR_INVALID_FILE_URL_PATH",
    );
  });

  test("windows: UNC host", () => {
    const buf = fileURLToPathBuffer(new URL("file://server/share/x"), { windows: true });
    expect(buf.toString()).toBe("\\\\server\\share\\x");
  });
});
