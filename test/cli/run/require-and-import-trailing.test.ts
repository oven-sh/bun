import { expect, test } from "bun:test";
import { tempDirWithFiles } from "harness";

test("require() with comments and trailing commas", () => {
  const requireDir = tempDirWithFiles("require-trailing", {
    "package.json": `
    {
      // Comments!
      "name": "require-and-import-trailing",
      "version": "1.0.0",
    }`,
  });

  expect(require(requireDir + "/package.json").name).toBe("require-and-import-trailing");
});

test("import() with comments and trailing commas", async () => {
  const importDir = tempDirWithFiles("import-trailing", {
    "package.json": `
    {
      // Comments!
      "name": "require-and-import-trailing",
      "version": "1.0.0",
    }`,
  });

  expect((await import(importDir + "/package.json")).default.name).toBe("require-and-import-trailing");
});
