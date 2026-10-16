import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

function thrownBy(fn: () => unknown) {
  try {
    fn();
  } catch (e) {
    return e;
  }
}

async function rejectionOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (e) {
    return e;
  }
}

// The comma after the root object is content after the document, like a second
// object. The file does not parse, as with JSON.parse, npm, esbuild and tsc.
test("require() with trailing slash", () => {
  using requireDir = tempDir("require-trailing", {
    "package.json": `
    {
      // Comments!
      "name": "require-and-import-trailing",
      "version": "1.0.0",
    },`,
  });

  const thrown = thrownBy(() => require(requireDir + "/package.json"));
  expect(thrown).toBeInstanceOf(BuildMessage);
  expect((thrown as BuildMessage).message).toBe('Expected end of file but found ","');
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

  const thrown = await rejectionOf(import(importDir + "/package.json"));
  expect(thrown).toBeInstanceOf(BuildMessage);
  expect((thrown as BuildMessage).message).toBe('Expected end of file but found ","');
});

const commentsAndTrailingComma = `
    {
      // Comments!
      "name": "require-and-import-trailing",
      "version": "1.0.0",
    }`;

test("require() of a package.json with comments and a trailing comma in the object", () => {
  using dir = tempDir("require-trailing-comma", { "package.json": commentsAndTrailingComma });

  expect(require(dir + "/package.json").name).toBe("require-and-import-trailing");
});

test("import() of a package.json with comments and a trailing comma in the object", async () => {
  await using dir = tempDir("import-trailing-comma", { "package.json": commentsAndTrailingComma });

  expect((await import(dir + "/package.json")).default.name).toBe("require-and-import-trailing");
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

const conflictMarkers = [
  '{"name":"first","scripts":{"s":"echo FIRST_BLOCK_RAN"}}',
  "<<<<<<< HEAD",
  '{"name":"second","scripts":{"s":"echo SECOND_BLOCK_RAN"}}',
  ">>>>>>> feature",
  "",
].join("\n");

const contentAfterRoot = [
  ["a second object", `{ "name": "first" }\n{ "name": "second" }\n`, 'Expected end of file but found "{"'],
  ["a word", `{ "name": "first" } garbage\n`, 'Expected end of file but found "garbage"'],
  ["a closing brace", `{ "name": "first" }}`, 'Expected end of file but found "}"'],
  ["git conflict markers", conflictMarkers, 'Expected end of file but found "<<<<<<<"'],
] as const;

test.each(contentAfterRoot)("require() of a package.json followed by %s throws", (_label, contents, message) => {
  using dir = tempDir("require-content-after-root", { "package.json": contents });

  const thrown = thrownBy(() => require(dir + "/package.json"));
  expect(thrown).toBeInstanceOf(BuildMessage);
  expect((thrown as BuildMessage).message).toBe(message);
});

test.each(contentAfterRoot)("import() of a package.json followed by %s rejects", async (_label, contents, message) => {
  await using dir = tempDir("import-content-after-root", { "package.json": contents });

  const thrown = await rejectionOf(import(dir + "/package.json"));
  expect(thrown).toBeInstanceOf(BuildMessage);
  expect((thrown as BuildMessage).message).toBe(message);
});

// Pins only that no script of the first object runs. The parent package.json
// keeps the script lookup inside the temporary directory.
test("bun run does not run a script of a package.json followed by git conflict markers", async () => {
  using dir = tempDir("run-content-after-root", {
    "package.json": `{ "name": "parent" }`,
    "pkg/package.json": conflictMarkers,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "s"],
    cwd: join(String(dir), "pkg"),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
});
