import { describe, expect, test } from "bun:test";

describe("Bun.serve app.bundlerOptions validation", () => {
  test("non-object bundlerOptions throws instead of crashing", () => {
    for (const value of [42, "string", true, 123n, Symbol("x")]) {
      expect(() => {
        Bun.serve({
          // @ts-expect-error
          app: { bundlerOptions: value },
        });
      }).toThrow("'app.bundlerOptions' must be an object");
    }
  });

  test("non-object server/client/ssr throws instead of crashing", () => {
    for (const key of ["server", "client", "ssr"] as const) {
      for (const value of [42, "string", true, 123n, Symbol("x")]) {
        expect(() => {
          Bun.serve({
            // @ts-expect-error
            app: { bundlerOptions: { [key]: value } },
          });
        }).toThrow(`'app.bundlerOptions.${key}' must be an object`);
      }
    }
  });

  test("non-boolean, non-object minify throws instead of crashing", () => {
    for (const value of [42, "string", 123n, Symbol("x")]) {
      expect(() => {
        Bun.serve({
          // @ts-expect-error
          app: { bundlerOptions: { server: { minify: value } } },
        });
      }).toThrow("'app.bundlerOptions.server.minify' must be a boolean or an object");
    }
  });

  test("boolean minify does not crash", () => {
    for (const value of [true, false]) {
      expect(() => {
        Bun.serve({
          // @ts-expect-error
          app: { bundlerOptions: { server: { minify: value } } },
        });
      }).toThrow("'app' is missing 'framework'");
    }
  });
});
