// A command that edits package.json writes the edit into the text of the file. What the edit does not touch
// stays as it is, byte for byte: https://github.com/oven-sh/bun/issues/11536
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { stat } from "fs/promises";
import { bunExe, tempDir } from "harness";
import { join } from "path";
import { installEnv, TestRegistry } from "registry";

const registry = new TestRegistry();
beforeAll(() => registry.start());
afterAll(() => registry.stop());

// What a reprint of the whole file loses: comments in six places, CRLF line endings, a blank line, the spelling of
// `1.50`, of an escape and of a single-quoted string, an object on one line, trailing commas, text after the root.
const PACKAGE_JSON = [
  `// before the root`,
  `{`,
  `  // above a member`,
  `  "name": "app", /* beside a member */`,
  ``,
  `  "version": '1.0.0',`,
  `  "config": { "retries": 1.50, "caf\\u00e9": true },`,
  `  "files": ["a", "b"],`,
  `  "dependencies": {`,
  `    "a-dep": "1.0.1",`,
  `    // why this pin: see the incident of March`,
  `    "no-deps": "^1.0.0", /* do not bump */`,
  `  },`,
  `  /* before the closing brace */`,
  `}`,
  `// after the root`,
  ``,
].join("\r\n");

async function project(packageJson: string = PACKAGE_JSON) {
  const { packageDir } = await registry.createTestDir({
    files: {
      "package.json": packageJson,
      "local/package.json": JSON.stringify({ name: "local", version: "1.0.0" }),
    },
  });
  return packageDir;
}

async function run(dir: string, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd: dir,
    env: installEnv(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const read = (dir: string) => Bun.file(join(dir, "package.json")).text();

// The whole file after the command is the file before it with one replacement.
function replaced(from: string | RegExp, to: string) {
  expect(PACKAGE_JSON).toMatch(from);
  return PACKAGE_JSON.replace(from, to);
}

describe.concurrent("the text that an edit does not touch stays as it is", () => {
  test.each([
    ["bun install changes nothing", ["install"], PACKAGE_JSON],
    [
      "bun add puts a new line where the name sorts",
      ["add", "./local"],
      replaced(`    "a-dep": "1.0.1",\r\n`, `    "a-dep": "1.0.1",\r\n    "local": "./local",\r\n`),
    ],
    ["bun add of what is declared changes nothing", ["add", "a-dep@1.0.1"], PACKAGE_JSON],
    [
      "bun add with another version changes the version",
      ["add", "no-deps@2.0.0"],
      replaced(`"no-deps": "^1.0.0"`, `"no-deps": "2.0.0"`),
    ],
    [
      "bun remove takes the line and the comment on it, and leaves the comment above it",
      ["remove", "no-deps"],
      replaced(`    "no-deps": "^1.0.0", /* do not bump */\r\n`, ""),
    ],
    [
      "bun remove of every dependency takes the group",
      ["remove", "a-dep", "no-deps"],
      replaced(/  "dependencies": \{[^}]*\},\r\n/, ""),
    ],
    [
      "bun update changes the version",
      ["update", "no-deps"],
      replaced(`"no-deps": "^1.0.0"`, `"no-deps": "^1.1.0"`),
    ],
    [
      "bun update --latest changes the version",
      ["update", "--latest", "no-deps"],
      replaced(`"no-deps": "^1.0.0"`, `"no-deps": "^2.0.0"`),
    ],
    ["bun pm pkg set changes a value", ["pm", "pkg", "set", "version=2.0.0"], replaced(`'1.0.0'`, `"2.0.0"`)],
    [
      "bun pm pkg set appends a member",
      ["pm", "pkg", "set", "license=MIT"],
      replaced(`  },\r\n  /* before`, `  },\r\n  "license": "MIT",\r\n  /* before`),
    ],
    [
      "bun pm pkg set lays an object out that was on one line, with its own tokens",
      ["pm", "pkg", "set", "config.timeout=5", "--json"],
      replaced(
        `{ "retries": 1.50, "caf\\u00e9": true }`,
        `{\r\n    "retries": 1.50,\r\n    "caf\\u00e9": true,\r\n    "timeout": 5\r\n  }`,
      ),
    ],
    [
      "bun pm pkg set appends to an array on one line",
      ["pm", "pkg", "set", "files[]=c"],
      replaced(`["a", "b"]`, `["a", "b", "c"]`),
    ],
    ["bun pm pkg delete takes the line", ["pm", "pkg", "delete", "files"], replaced(`  "files": ["a", "b"],\r\n`, "")],
    [
      "bun pm version changes the version",
      ["pm", "version", "patch", "--no-git-tag-version"],
      replaced(`'1.0.0'`, `"1.0.1"`),
    ],
  ])("%s", async (_, args, expected) => {
    const dir = await project();
    const { stderr, exitCode } = await run(dir, ...args);
    expect(stderr).not.toContain("error:");
    expect(await read(dir)).toBe(expected);
    expect(exitCode).toBe(0);
  });

  test("a member that sorts to another place takes the comments above it and beside it along", async () => {
    const { packageDir: dir } = await registry.createTestDir({
      files: {
        "package.json": `{\n  "dependencies": {\n    // c is first here\n    "c": "file:./c", // beside c\n    "b": "file:./b" // beside b\n  }\n}\n`,
        "a/package.json": JSON.stringify({ name: "a", version: "1.0.0" }),
        "b/package.json": JSON.stringify({ name: "b", version: "1.0.0" }),
        "c/package.json": JSON.stringify({ name: "c", version: "1.0.0" }),
      },
    });
    const { stderr, exitCode } = await run(dir, "add", "./a");
    expect(stderr).not.toContain("error:");
    expect(await read(dir)).toBe(
      `{\n  "dependencies": {\n    "a": "./a",\n    "b": "file:./b", // beside b\n    // c is first here\n    "c": "file:./c" // beside c\n  }\n}\n`,
    );
    expect(exitCode).toBe(0);
  });

  test("a second run of the same command does not write the file", async () => {
    const dir = await project();
    expect((await run(dir, "add", "./local")).exitCode).toBe(0);
    const [text, { mtimeMs }] = await Promise.all([read(dir), stat(join(dir, "package.json"))]);
    expect((await run(dir, "add", "./local")).exitCode).toBe(0);
    expect(await read(dir)).toBe(text);
    expect((await stat(join(dir, "package.json"))).mtimeMs).toBe(mtimeMs);
  });

  test("bun pm pkg set --dry-run prints the text and leaves the file", async () => {
    const dir = await project();
    const { stdout, exitCode } = await run(dir, "pm", "pkg", "set", "version=2.0.0", "--dry-run");
    expect(stdout).toBe(replaced(`'1.0.0'`, `"2.0.0"`));
    expect(await read(dir)).toBe(PACKAGE_JSON);
    expect(exitCode).toBe(0);
  });
});

describe.concurrent("where an edit puts a member", () => {
  // `bun pm pkg` edits without an install, so these cases need no registry.
  async function edited(packageJson: string, ...args: string[]) {
    using dir = tempDir("package-json-text", { "package.json": packageJson });
    const { stderr, exitCode } = await run(String(dir), "pm", "pkg", ...args);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    return await read(String(dir));
  }

  test("the comma goes after the value before it, not after its comment", async () => {
    expect(
      await edited(`{\n  "name": "app" // the name\n}\n`, "set", "version=1.0.0"),
    ).toBe(`{\n  "name": "app", // the name\n  "version": "1.0.0"\n}\n`);
    expect(
      await edited(`{\n  "name": "app" /* the name */\n}\n`, "set", "version=1.0.0"),
    ).toBe(`{\n  "name": "app", /* the name */\n  "version": "1.0.0"\n}\n`);
  });

  test("a trailing comma stays a trailing comma", async () => {
    expect(await edited(`{\n  "name": "app",\n}\n`, "set", "version=1.0.0")).toBe(
      `{\n  "name": "app",\n  "version": "1.0.0",\n}\n`,
    );
    expect(await edited(`{\n  "name": "app",\n  "version": "1.0.0",\n}\n`, "delete", "version")).toBe(
      `{\n  "name": "app",\n}\n`,
    );
  });

  test("the last member gives its comma up when the one after it goes", async () => {
    expect(await edited(`{\n  "name": "app", // the name\n  "version": "1.0.0"\n}\n`, "delete", "version")).toBe(
      `{\n  "name": "app" // the name\n}\n`,
    );
  });

  test("a removed member leaves the comments on the lines above it", async () => {
    expect(
      await edited(
        `{\n  "name": "app",\n\n  // what it is\n  /* and more */\n  "description": "d", // gone with its line\n  "version": "1.0.0"\n}\n`,
        "delete",
        "description",
      ),
    ).toBe(`{\n  "name": "app",\n\n  // what it is\n  /* and more */\n  "version": "1.0.0"\n}\n`);
    // Nothing is left of a group but its comments.
    expect(await edited(`{\n  "scripts": {\n    // how to build\n    "build": "b"\n  }\n}\n`, "delete", "scripts.build")).toBe(
      `{\n  "scripts": {\n    // how to build\n  }\n}\n`,
    );
    expect(await edited(`{\n  "scripts": {\n    "build": "b"\n  }\n}\n`, "delete", "scripts.build")).toBe(
      `{\n  "scripts": {}\n}\n`,
    );
  });

  test("a new member has the indentation of the members beside it", async () => {
    expect(await edited(`{\n\t"name": "app"\n}\n`, "set", "a.b=1")).toBe(
      `{\n\t"name": "app",\n\t"a": {\n\t\t"b": "1"\n\t}\n}\n`,
    );
    expect(await edited(`{\n    "name": "app",\n    "a": {\n        "b": "1"\n    }\n}`, "set", "a.c=2")).toBe(
      `{\n    "name": "app",\n    "a": {\n        "b": "1",\n        "c": "2"\n    }\n}`,
    );
    // Lines that are indented by no rule stay where they are.
    expect(await edited(`{\n      "name": "app",\n"main": "m"\n  }`, "set", "version=1.0.0")).toBe(
      `{\n      "name": "app",\n"main": "m",\n      "version": "1.0.0"\n  }`,
    );
  });

  test("an empty object or array is filled the way the printer writes one", async () => {
    expect(await edited(`{\n  "a": {},\n  "b": []\n}\n`, "set", "a.x=1", "b[]=y")).toBe(
      `{\n  "a": {\n    "x": "1"\n  },\n  "b": ["y"]\n}\n`,
    );
    expect(await edited(`{\n  "a": {\n  },\n  "b": [\n  ]\n}\n`, "set", "a.x=1", "b[]=y")).toBe(
      `{\n  "a": {\n    "x": "1"\n  },\n  "b": [\n    "y"\n  ]\n}\n`,
    );
  });

  test("an array on lines gets a line", async () => {
    expect(
      await edited(`{\n  "files": [\n    "a", // the first\n    "b"\n  ]\n}\n`, "set", "files[]=c"),
    ).toBe(`{\n  "files": [\n    "a", // the first\n    "b",\n    "c"\n  ]\n}\n`);
  });

  test("a file on one line is laid out, and keeps its comments and tokens", async () => {
    expect(await edited(`{"name":"app",/* why */"config":{"n":1.50,'s':'t'},"files":["a"]}`, "set", "version=1.0.0")).toBe(
      `{\n  "name": "app",\n  /* why */ "config": {\n    "n": 1.50,\n    's': 't'\n  },\n  "files": ["a"],\n  "version": "1.0.0"\n}`,
    );
    // What does not change is not laid out.
    expect(await edited(`{"name":"app"}`, "set", "name=app")).toBe(`{"name":"app"}`);
  });

  test("a value that changes keeps what is around it", async () => {
    expect(await edited(`{ "name" /* a */ : /* b */ "app" /* c */ , "n": 1 }`, "set", "name=lib")).toBe(
      `{\n  "name": /* a */ /* b */ "lib" /* c */,\n  "n": 1\n}`,
    );
    expect(await edited(`{\n  "name" /* a */ : /* b */ "app" /* c */ ,\n  "n": 1\n}`, "set", "name=lib")).toBe(
      `{\n  "name" /* a */ : /* b */ "lib" /* c */ ,\n  "n": 1\n}`,
    );
  });

  test("a key that is there twice keeps both members", async () => {
    expect(await edited(`{\n  "a": 1, // first\n  "a": 2, // second\n  "b": 3\n}\n`, "delete", "b")).toBe(
      `{\n  "a": 1, // first\n  "a": 2 // second\n}\n`,
    );
  });

  test("a key with an escape is the key that it spells", async () => {
    expect(await edited(`{\n  "n\\u0061me": "app", // spelled with an escape\n  "v": "1"\n}\n`, "set", "name=lib")).toBe(
      `{\n  "n\\u0061me": "lib", // spelled with an escape\n  "v": "1"\n}\n`,
    );
  });
});
