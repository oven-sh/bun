import { expect, test } from "bun:test";

test("Bun.serve() app.bundlerOptions must be an object", () => {
  expect(() =>
    // @ts-expect-error
    Bun.serve({ app: { bundlerOptions: "not an object" } }),
  ).toThrow(/"bundlerOptions" argument must be of type object/);
});

test("Bun.serve() app.bundlerOptions.{server,client,ssr} must be objects", () => {
  for (const key of ["server", "client", "ssr"]) {
    expect(() =>
      // @ts-expect-error
      Bun.serve({ app: { bundlerOptions: { [key]: "nope" } } }),
    ).toThrow(new RegExp(`"bundlerOptions\\.${key}" argument must be of type object`));
  }
});

test("Bun.serve() app.bundlerOptions.*.minify must be a boolean or object", () => {
  expect(() =>
    // @ts-expect-error
    Bun.serve({ app: { bundlerOptions: { server: { minify: 123 } } } }),
  ).toThrow(/"bundlerOptions\.server\.minify" argument must be of type boolean or object/);
});

test("Bun.serve() app.bundlerOptions.*.minify accepts boolean", () => {
  for (const minify of [true, false, {}]) {
    // Still throws because `framework` is required, but it must get past
    // the bundlerOptions validation without crashing or rejecting `minify`.
    expect(() =>
      // @ts-expect-error
      Bun.serve({ app: { bundlerOptions: { server: { minify } } } }),
    ).toThrow(/'app' is missing 'framework'/);
  }
});
