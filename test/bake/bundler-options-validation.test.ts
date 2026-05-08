import { describe, expect, test } from "bun:test";

describe("Bun.serve app.bundlerOptions validation", () => {
  test("throws when bundlerOptions is not an object", () => {
    expect(() =>
      // @ts-expect-error
      Bun.serve({ app: { bundlerOptions: 123 } }),
    ).toThrow("'app.bundlerOptions' must be an object");
  });

  describe.each(["server", "client", "ssr"])("bundlerOptions.%s", key => {
    test("throws when not an object", () => {
      expect(() =>
        // @ts-expect-error
        Bun.serve({ app: { bundlerOptions: { [key]: 699 } } }),
      ).toThrow(`'app.bundlerOptions.${key}' must be an object`);
    });

    test("throws when minify is not a boolean or object", () => {
      expect(() =>
        // @ts-expect-error
        Bun.serve({ app: { bundlerOptions: { [key]: { minify: 5 } } } }),
      ).toThrow(`'app.bundlerOptions.${key}.minify' must be a boolean or an object`);
    });

    test.each([true, false])("does not crash when minify is %p", minify => {
      expect(() =>
        // @ts-expect-error
        Bun.serve({ app: { bundlerOptions: { [key]: { minify } } } }),
      ).toThrow("'app' is missing 'framework'");
    });
  });
});
