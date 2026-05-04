import { expect, test } from "bun:test";

test.each([42, "foo", true])(
  "Bun.serve app.bundlerOptions throws on non-object value %p instead of crashing",
  value => {
    expect(() => Bun.serve({ port: 0, app: { bundlerOptions: value } } as any)).toThrow(
      "'app.bundlerOptions' must be an object",
    );
  },
);

test.each(
  ["server", "client", "ssr"].flatMap(key => [42, "foo", true, 1n, Symbol("x")].map(value => [key, value] as const)),
)("Bun.serve app.bundlerOptions.%s throws on non-object value %p instead of crashing", (key, value) => {
  expect(() => Bun.serve({ port: 0, app: { bundlerOptions: { [key]: value } } } as any)).toThrow(
    `'app.bundlerOptions.${key}' must be an object`,
  );
});

test.each([42, "foo", 1n])(
  "Bun.serve app.bundlerOptions.server.minify throws on non-boolean non-object value %p instead of crashing",
  value => {
    expect(() => Bun.serve({ port: 0, app: { bundlerOptions: { server: { minify: value } } } } as any)).toThrow(
      "'app.bundlerOptions.server.minify' must be a boolean or an object",
    );
  },
);
