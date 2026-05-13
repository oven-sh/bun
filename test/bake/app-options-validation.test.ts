import { describe, expect, test } from "bun:test";

describe("Bun.serve app.bundlerOptions validation", () => {
  test("throws when bundlerOptions is not an object", () => {
    expect(() =>
      Bun.serve({
        // @ts-expect-error
        app: { bundlerOptions: 42 },
      }),
    ).toThrow("'app.bundlerOptions' must be an object");
  });

  describe.each(["server", "client", "ssr"] as const)("bundlerOptions.%s", key => {
    test.each([1073741824, "foo", true])("throws when value is %p", value => {
      expect(() =>
        Bun.serve({
          // @ts-expect-error
          app: { bundlerOptions: { [key]: value } },
        }),
      ).toThrow(`'app.bundlerOptions.${key}' must be an object`);
    });
  });
});
