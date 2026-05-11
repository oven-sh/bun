import { describe, expect, test } from "bun:test";

describe("Bun.serve app.bundlerOptions validation", () => {
  test.each([42, "str", true, Symbol(), 1n])("throws when bundlerOptions is %p", value => {
    expect(() =>
      Bun.serve({
        // @ts-expect-error
        app: { bundlerOptions: value },
      }),
    ).toThrow("'app.bundlerOptions' must be an object");
  });

  describe.each(["server", "client", "ssr"] as const)("bundlerOptions.%s", key => {
    test.each([42, "str", true, Symbol(), 1n])("throws when value is %p", value => {
      expect(() =>
        Bun.serve({
          // @ts-expect-error
          app: { bundlerOptions: { [key]: value } },
        }),
      ).toThrow(`'app.bundlerOptions.${key}' must be an object`);
    });

    test.each([42, "str", Symbol(), 1n])("throws when minify is %p", value => {
      expect(() =>
        Bun.serve({
          // @ts-expect-error
          app: { bundlerOptions: { [key]: { minify: value } } },
        }),
      ).toThrow(`'app.bundlerOptions.${key}.minify' must be a boolean or an object`);
    });

    test.each([true, false])("does not crash when minify is %p", value => {
      expect(() =>
        Bun.serve({
          // @ts-expect-error
          app: { bundlerOptions: { [key]: { minify: value } } },
        }),
      ).toThrow("'app' is missing 'framework'");
    });
  });
});
