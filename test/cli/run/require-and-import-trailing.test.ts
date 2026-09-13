import { expect, test } from "bun:test";
import { tempDir } from "harness";

test("require() with trailing slash", () => {
  using requireDir = tempDir("require-trailing", {
    "package.json": `
    {
      // Comments!
      "name": "require-and-import-trailing",
      "version": "1.0.0",
    },`,
  });

  expect(require(requireDir + "/package.json").name).toBe("require-and-import-trailing");
});

test("import() with trailing slash", async () => {
  await using importDir = tempDir("import-trailing", {
    "package.json": `
    {
      // Comments!
      "name": "require-and-import-trailing",
      "version": "1.0.0",
    },`,
  });

  expect((await import(importDir + "/package.json")).default.name).toBe("require-and-import-trailing");
});
