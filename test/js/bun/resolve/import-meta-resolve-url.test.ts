import { describe, expect, test } from "bun:test";
import path from "node:path";

describe("import.meta.resolve with URL instance parent (#41318)", () => {
  test("resolves relative specifier with URL parent identical to string parent", () => {
    const parentUrl = new URL("./sub/dir/mod.mjs", import.meta.url);
    const resolvedFromUrl = import.meta.resolve("./sibling.mjs", parentUrl);
    const resolvedFromString = import.meta.resolve("./sibling.mjs", parentUrl.href);

    expect(resolvedFromUrl).toBe(resolvedFromString);
    expect(resolvedFromUrl).toBe(new URL("./sub/dir/sibling.mjs", import.meta.url).href);
  });

  test("resolves parent directory specifier (..) with URL parent", () => {
    const parentUrl = new URL("./sub/dir/mod.mjs", import.meta.url);
    const resolvedFromUrl = import.meta.resolve("../parent-sibling.mjs", parentUrl);
    const resolvedFromString = import.meta.resolve("../parent-sibling.mjs", parentUrl.href);

    expect(resolvedFromUrl).toBe(resolvedFromString);
    expect(resolvedFromUrl).toBe(new URL("./sub/parent-sibling.mjs", import.meta.url).href);
  });

  test("undefined parent falls back to caller base URL", () => {
    const resolvedDefault = import.meta.resolve("./sibling.mjs");
    const resolvedUndefined = import.meta.resolve("./sibling.mjs", undefined);

    expect(resolvedUndefined).toBe(resolvedDefault);
    expect(resolvedUndefined).toBe(new URL("./sibling.mjs", import.meta.url).href);
  });

  test("import.meta.resolveSync accepts URL instance as parent", () => {
    const parentUrl = new URL("./src/index.ts", import.meta.url);
    try {
      import.meta.resolveSync("./does-not-exist.ts", parentUrl);
    } catch (err: any) {
      expect(err.message).toContain("file:///");
      expect(err.message).toContain("src/index.ts");
    }
  });

  describe("parentURL argument validation", () => {
    test("rejects invalid parent types with TypeError [ERR_INVALID_ARG_TYPE]", () => {
      const invalidParents = [
        ["number", 42],
        ["null", null],
        ["boolean", true],
        ["boolean false", false],
        ["empty object", {}],
        ["symbol", Symbol("parent")],
        ["bigint", 100n],
      ];

      for (const [label, invalidValue] of invalidParents) {
        expect(() => {
          // @ts-ignore
          import.meta.resolve("./sibling.mjs", invalidValue);
        }).toThrow(
          expect.objectContaining({
            name: "TypeError",
            code: "ERR_INVALID_ARG_TYPE",
          }),
        );
      }
    });

    test("supports object with paths array", () => {
      const testFile = path.join(import.meta.dir, "sub", "mod.mjs");
      const resolved = import.meta.resolve("./sibling.mjs", { paths: [testFile] });
      expect(resolved).toBe(new URL("./sub/sibling.mjs", import.meta.url).href);
    });
  });
});
