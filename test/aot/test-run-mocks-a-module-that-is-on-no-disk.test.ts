import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { afterAll, raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { beforeAll, test } from "./supported";

raiseDefaultTimeout(120_000);

// An extension imports a module that only its host has, and its tests mock it. Where the run is built as several programs, the file
// that imports the name lies in another program than the test file that mocks it, and that program's build has to hear of the mock.
let dir: ReturnType<typeof tempDir> | undefined;
let plain: Awaited<ReturnType<typeof report>>;
async function report(words: string, ...flags: string[]) {
  const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words };
  const { stdout, stderr, exitCode } = await run(
    [bunExe(), "test", "--isolate", "--parallel=2", ...flags],
    String(dir),
    env,
  );
  const lines = (stdout + "\n" + stderr).split("\n").filter(line => line.startsWith("| "));
  return { lines: lines.sort(), ran: stderr.match(/^Ran \d+ tests? across \d+ files?/m)?.[0], exitCode };
}

beforeAll(async () => {
  const mocked = (tag: string) =>
    `mock.module("only-in-the-host", () => ({ window: { title: "mocked ${tag}" }, version: "${tag}", default: { name: "default ${tag}" } }));`;
  const head = (tag: string) => `import { beforeAll, mock, test } from "bun:test";\n${mocked(tag)}\n`;
  dir = tempDir("aot-test-run-mock-on-no-disk", {
    "package.json": `{ "name": "p", "type": "module" }`,
    "tsconfig.json": "{}",
    "src/namespace.ts": `// @ts-ignore\nimport * as host from "only-in-the-host";\nexport function title(): string { return host.window.title; }\n`,
    "src/names.ts": `// @ts-ignore\nimport { window, version } from "only-in-the-host";\nexport function both(): string { return window.title + "@" + version; }\n`,
    "src/default.ts": `// @ts-ignore\nimport host from "only-in-the-host";\nexport function viaDefault(): string { return host.name; }\n`,
    "src/lazy.ts": `export function required(): string { return require("only-in-the-host").window.title; }\nexport async function imported(): Promise<string> { // @ts-ignore\n  return (await import("only-in-the-host")).version; }\n`,
    "src/over.ts": `import { title } from "./namespace";\nexport function shout(): string { return title().toUpperCase(); }\n`,
    "a.test.ts":
      head("a") +
      `const { title } = await import("./src/namespace");\ntest("a", () => { console.log("|", "a", title()); });\n`,
    "b.test.ts":
      head("b") +
      `const { both } = await import("./src/names");\ntest("b", () => { console.log("|", "b", both()); });\n`,
    "c.test.ts":
      head("c") +
      `const { viaDefault } = await import("./src/default");\ntest("c", () => { console.log("|", "c", viaDefault()); });\n`,
    "d.test.ts":
      head("d") +
      `const { shout } = await import("./src/over");\ntest("d", () => { console.log("|", "d", shout()); });\n`,
    "e.test.ts":
      head("e") +
      `test("e", async () => { const { title } = await import("./src/namespace"); console.log("|", "e", title()); });\n`,
    "f.test.ts": `import { beforeAll, mock, test } from "bun:test";\nbeforeAll(() => { ${mocked("f")} });\ntest("f", async () => { const { title } = await import("./src/namespace"); console.log("|", "f", title()); });\n`,
    "g.test.ts":
      head("g") +
      `test("g", async () => { const host = await import("only-in-the-host"); console.log("|", "g", host.version, require("only-in-the-host").window.title); });\n`,
    "i.test.ts":
      `import { required, imported } from "./src/lazy";\n` +
      head("i") +
      `test("i", async () => { console.log("|", "i", required(), await imported()); });\n`,
    "h.test.ts": `import { test } from "bun:test";\ntest("h", async () => { if (process.argv.length > 90) await import("./src/namespace"); console.log("|", "h", "no mock, and the import never runs"); });\n`,
  });
  plain = await report("");
});
afterAll(() => dir?.[Symbol.dispose]());

test("under plain Bun a mock of a module that is on no disk reaches the files of the project that import it", () => {
  expect(plain).toEqual({
    lines: [
      "| a mocked a",
      "| b mocked b@b",
      "| c default c",
      "| d MOCKED D",
      "| e mocked e",
      "| f mocked f",
      "| g g mocked g",
      "| h no mock, and the import never runs",
      "| i mocked i i",
    ],
    ran: "Ran 9 tests across 9 files",
    exitCode: 0,
  });
});

test.each(["TestRunLayers:0", "TestRunLayers:1", "TestRunLayers:2", "TestRunLayers:2,TestRunPartFiles:1"])(
  "a mock of a module that is on no disk reaches the files of the project that import it: %s",
  async words => {
    expect({ words, ...(await report(words, "--aot")) }).toEqual({ words, ...plain });
  },
);
