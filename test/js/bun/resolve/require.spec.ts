import path from "node:path";

const fixture = (...segs: string[]): string => path.join(import.meta.dirname, "fixtures", "require", ...segs);

describe("require() on non js/ts files", () => {
  it.each(["obj.toml", "obj.json", "obj.jsonc"])("require('%s') synchronously produces an object", file => {
    const result = require(fixture(file));
    expect(result).toEqual({
      foo: {
        bar: "baz",
      },
    });
  });

  // note: toml does not support top-level arrays
  it.each(["arr.json", "arr.jsonc"])("require('%s') synchronously produces an array", file => {
    const result = require(fixture(file));
    expect(result).toEqual(["foo", "bar", "baz"]);
  });

  // FIXME: require() on .txt should not have a .default property
  it("require('*.txt') synchronously produces a string", () => {
    const result = require(fixture("foo.txt"));
    // this should probably be expected behavior, but that's not how it works rn
    // expect(result).toMatch(/^According to all known laws of aviation, there is no way a bee should be able to fly\./);
    expect(result).toBeObject();
    expect(result.default).toBeString();
    expect(result.default).toMatch(
      /^According to all known laws of aviation, there is no way a bee should be able to fly\./,
    );
  });

  it.todo("require('*.html') synchronously produces a string");
  it.todo("require('*.wasm') produces a WebAssembly.Module");
  it.todo("require('*.db') wraps a sqlite file in a Database object and exports it");
});
