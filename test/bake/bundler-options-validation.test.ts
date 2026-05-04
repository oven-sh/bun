import { expect, test } from "bun:test";

test("Bun.serve app.bundlerOptions throws on non-object values instead of crashing", () => {
  expect(() => Bun.serve({ app: { bundlerOptions: 42 } } as any)).toThrow(
    "'app.bundlerOptions' must be an object",
  );
  expect(() => Bun.serve({ app: { bundlerOptions: "foo" } } as any)).toThrow(
    "'app.bundlerOptions' must be an object",
  );
  expect(() => Bun.serve({ app: { bundlerOptions: true } } as any)).toThrow(
    "'app.bundlerOptions' must be an object",
  );
});

test("Bun.serve app.bundlerOptions.{server,client,ssr} throws on non-object values instead of crashing", () => {
  for (const key of ["server", "client", "ssr"]) {
    for (const value of [42, "foo", true, 1n, Symbol("x")]) {
      expect(() => Bun.serve({ app: { bundlerOptions: { [key]: value } } } as any)).toThrow(
        `'app.bundlerOptions.${key}' must be an object`,
      );
    }
  }
});

test("Bun.serve app.bundlerOptions.*.minify throws on non-boolean non-object values instead of crashing", () => {
  for (const value of [42, "foo", 1n]) {
    expect(() => Bun.serve({ app: { bundlerOptions: { server: { minify: value } } } } as any)).toThrow(
      "'app.bundlerOptions.server.minify' must be a boolean or an object",
    );
  }
});
