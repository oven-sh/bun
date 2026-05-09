import { describe, expect, test } from "bun:test";

describe("Bun.serve app.bundlerOptions validation", () => {
  test("non-object bundlerOptions throws", () => {
    expect(() =>
      Bun.serve({
        // @ts-expect-error
        app: { bundlerOptions: 1225 },
      }),
    ).toThrow("'bundlerOptions' must be an object");
  });

  for (const key of ["server", "client", "ssr"] as const) {
    test(`non-object bundlerOptions.${key} throws`, () => {
      expect(() =>
        Bun.serve({
          // @ts-expect-error
          app: { bundlerOptions: { [key]: 1225 } },
        }),
      ).toThrow(`'bundlerOptions.${key}' must be an object`);
    });

    test(`non-object non-boolean bundlerOptions.${key}.minify throws`, () => {
      expect(() =>
        Bun.serve({
          // @ts-expect-error
          app: { bundlerOptions: { [key]: { minify: 1225 } } },
        }),
      ).toThrow(`'bundlerOptions.${key}.minify' must be a boolean or an object`);
    });

    for (const minify of [true, false, { whitespace: true }]) {
      test(`bundlerOptions.${key}.minify = ${JSON.stringify(minify)} is accepted`, () => {
        expect(() =>
          Bun.serve({
            // @ts-expect-error
            app: { bundlerOptions: { [key]: { minify } } },
          }),
        ).not.toThrow(/must be/);
      });
    }
  }
});
