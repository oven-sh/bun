import { describe, expect, test } from "bun:test";

describe("Bun.serve app.bundlerOptions validation", () => {
  test("throws when bundlerOptions is not an object", () => {
    expect(() => Bun.serve({ app: { bundlerOptions: 5 as any } } as any)).toThrow(
      "'app.bundlerOptions' must be an object",
    );
    expect(() => Bun.serve({ app: { bundlerOptions: "hello" as any } } as any)).toThrow(
      "'app.bundlerOptions' must be an object",
    );
    expect(() => Bun.serve({ app: { bundlerOptions: true as any } } as any)).toThrow(
      "'app.bundlerOptions' must be an object",
    );
  });

  test("does not crash with self-referencing bundlerOptions and non-object sub-options", () => {
    const v2: any = {};
    v2.client = 2;
    v2.bundlerOptions = v2;
    expect(() => Bun.serve({ app: v2 } as any)).toThrow("'app.bundlerOptions.client' must be an object");
  });

  describe.each(["server", "client", "ssr"] as const)("bundlerOptions.%s", key => {
    test("throws when value is not an object", () => {
      expect(() => Bun.serve({ app: { bundlerOptions: { [key]: 2 } as any } } as any)).toThrow(
        `'app.bundlerOptions.${key}' must be an object`,
      );
      expect(() => Bun.serve({ app: { bundlerOptions: { [key]: "x" } as any } } as any)).toThrow(
        `'app.bundlerOptions.${key}' must be an object`,
      );
      expect(() => Bun.serve({ app: { bundlerOptions: { [key]: true } as any } } as any)).toThrow(
        `'app.bundlerOptions.${key}' must be an object`,
      );
    });

    test("throws when minify is not a boolean or an object", () => {
      expect(() => Bun.serve({ app: { bundlerOptions: { [key]: { minify: 5 } } as any } } as any)).toThrow(
        `'app.bundlerOptions.${key}.minify' must be a boolean or an object`,
      );
      expect(() => Bun.serve({ app: { bundlerOptions: { [key]: { minify: "yes" } } as any } } as any)).toThrow(
        `'app.bundlerOptions.${key}.minify' must be a boolean or an object`,
      );
    });

    test("accepts boolean minify without crashing", () => {
      expect(() => Bun.serve({ app: { bundlerOptions: { [key]: { minify: false } } as any } } as any)).toThrow(
        "'app' is missing 'framework'",
      );
      expect(() => Bun.serve({ app: { bundlerOptions: { [key]: { minify: true } } as any } } as any)).toThrow(
        "'app' is missing 'framework'",
      );
    });
  });
});
