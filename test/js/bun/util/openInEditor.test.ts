import { describe, expect, test } from "bun:test";

describe("Bun.openInEditor", () => {
  test.each([536870888, "str", true, 1n, Symbol()])(
    "throws TypeError when options is a non-object primitive: %p",
    value => {
      expect(() => Bun.openInEditor("foo.js", value as any)).toThrow(
        expect.objectContaining({
          name: "TypeError",
          code: "ERR_INVALID_ARG_TYPE",
        }),
      );
    },
  );

  test.each([undefined, null])("does not throw options-type error when options is %p", value => {
    try {
      Bun.openInEditor("foo.js", value as any);
    } catch (e: any) {
      expect(e.code).not.toBe("ERR_INVALID_ARG_TYPE");
    }
  });
});
