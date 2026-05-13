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

  for (const key of ["server", "client", "ssr"] as const) {
    for (const value of [1073741824, "foo", true]) {
      test(`throws when bundlerOptions.${key} is ${JSON.stringify(value)}`, () => {
        expect(() =>
          Bun.serve({
            // @ts-expect-error
            app: { bundlerOptions: { [key]: value } },
          }),
        ).toThrow(`'app.bundlerOptions.${key}' must be an object`);
      });
    }
  }
});
