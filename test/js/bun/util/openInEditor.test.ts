import { describe, expect, test } from "bun:test";

describe("Bun.openInEditor", () => {
  test.each([536870888, "str", true, 1n, Symbol()])(
    "throws TypeError when options is a non-object primitive: %p",
    value => {
      expect(() => Bun.openInEditor("", value as any)).toThrow(
        expect.objectContaining({
          name: "TypeError",
          code: "ERR_INVALID_ARG_TYPE",
        }),
      );
    },
  );

  test.each([undefined, null])("does not throw options-type error when options is %p", value => {
    let err: any;
    try {
      // empty path ensures we throw "No file path specified" (or "Failed to auto-detect editor")
      // before ever spawning a real editor process
      Bun.openInEditor("", value as any);
    } catch (e: any) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(err.code).not.toBe("ERR_INVALID_ARG_TYPE");
  });
});
