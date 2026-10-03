import { expect, test } from "bun:test";
import { tempDir } from "harness";

test("require() with trailing slash", () => {
  using requireDir = tempDir("require-trailing", {
    "package.json": `
    {
      // Comments!
      "name": "require-and-import-trailing",
      "version": "1.0.0",
    }`,
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
    }`,
  });

  expect((await import(importDir + "/package.json")).default.name).toBe("require-and-import-trailing");
});

const commentsAfterRoot = `{ "name": "comments-after-root", }\n// line comment\n/* block comment */\n\n`;

test("require() accepts comments and whitespace after the root object", () => {
  using dir = tempDir("require-comments-after-root", { "package.json": commentsAfterRoot });

  expect(require(dir + "/package.json").name).toBe("comments-after-root");
});

test("import() accepts comments and whitespace after the root object", async () => {
  await using dir = tempDir("import-comments-after-root", { "package.json": commentsAfterRoot });

  expect((await import(dir + "/package.json")).default.name).toBe("comments-after-root");
});

// A comma after the root object is content after the root value, like a second object.
const contentAfterRoot = [
  ["a comma", `{ "name": "first" },`, 'Expected end of file but found ","'],
  ["a second object", `{ "name": "first" }\n{ "name": "second" }\n`, 'Expected end of file but found "{"'],
  ["a word", `{ "name": "first" } garbage\n`, 'Expected end of file but found "garbage"'],
] as const;

test.each(contentAfterRoot)("require() of a package.json followed by %s throws", (_label, contents, message) => {
  using dir = tempDir("require-content-after-root", { "package.json": contents });

  let thrown: unknown;
  try {
    require(dir + "/package.json");
  } catch (e) {
    thrown = e;
  }
  expect(thrown).toBeInstanceOf(BuildMessage);
  expect((thrown as BuildMessage).message).toBe(message);
});

test.each(contentAfterRoot)("import() of a package.json followed by %s rejects", async (_label, contents, message) => {
  await using dir = tempDir("import-content-after-root", { "package.json": contents });

  let thrown: unknown;
  try {
    await import(dir + "/package.json");
  } catch (e) {
    thrown = e;
  }
  expect(thrown).toBeInstanceOf(BuildMessage);
  expect((thrown as BuildMessage).message).toBe(message);
});
