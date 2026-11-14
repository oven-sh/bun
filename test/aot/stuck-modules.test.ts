import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { describe, test } from "./supported";

// A compiled module that another imports by a statement is in no registry of the loader, and a test file that never finishes loading is stuck on such modules too.
async function notesOf(files: Record<string, string>, ...flags: string[]) {
  using directory = tempDir("aot-stuck-modules", files);
  const { stderr, exitCode } = await run([bunExe(), "test", ...flags], String(directory), bunEnv);
  const said = stderr.replaceAll(String(directory), "").replaceAll("\\\\", "/");
  return { notes: said.split("\n").filter(line => /^(error|note): /.test(line)), exitCode };
}

describe.concurrent("a test file that never finishes loading", () => {
  test("names the modules that it imports by statements, five at most", async () => {
    const files: Record<string, string> = { "a.test.ts": "" };
    for (let i = 0; i < 7; i++) {
      files["a.test.ts"] += `import "./dep${i}.ts";\n`;
      files[`dep${i}.ts`] = "await new Promise(() => {});";
    }
    const plain = await notesOf(files);
    expect(plain.notes.slice(2)).toEqual([
      ...[0, 1, 2, 3, 4].map(i => `note: unsettled top-level await in "/dep${i}.ts"`),
      "note: and 2 more",
    ]);
    expect(await notesOf(files, "--aot")).toEqual(plain);
  });

  test("names a module behind one that hands its export on", async () => {
    const files = {
      "a.test.ts": `await import("./importer.ts");`,
      "importer.ts": `export { gate } from "./gated.ts";`,
      "gated.ts": `export const gate = await new Promise(() => {});`,
    };
    const plain = await notesOf(files);
    expect(plain.notes.slice(2)).toEqual([
      'note: unsettled top-level await in "/a.test.ts"',
      'note: unsettled top-level await in "/gated.ts"',
    ]);
    expect(await notesOf(files, "--aot")).toEqual(plain);
  });

  test("names a module whose mock never settles, where another module imports it", async () => {
    const files = {
      "a.test.ts": `import { mock, test, vi } from "bun:test";
vi.doMock("./kept.ts", async () => (vi.doUnmock("./kept.ts"), await new Promise(() => {})));
mock.module("./asked.ts", () => new Promise(() => {}));
void import("./asked.ts");
await import("./user.ts");
test("never runs", () => {});
`,
      "asked.ts": `export const asked = 1;`,
      "kept.ts": `export const kept = 2;`,
      "user.ts": `export * from "./kept.ts";`,
    };
    const plain = await notesOf(files);
    expect(plain.notes.slice(2)).toEqual([
      'note: unsettled top-level await in "/a.test.ts"',
      'note: an onLoad() plugin or a mock.module() factory never settled for "/kept.ts"',
    ]);
    expect(await notesOf(files, "--aot")).toEqual(plain);
  });

  test("names a module that import() asked for before another module did", async () => {
    const files = {
      "a.test.ts": `import { mock, test } from "bun:test";
mock.module("./kept.ts", async () => await new Promise(() => {}));
void import("./kept.ts");
await import("./user.ts");
test("never runs", () => {});
`,
      "kept.ts": `export const kept = 2;`,
      "user.ts": `export * from "./kept.ts";`,
    };
    const plain = await notesOf(files);
    expect(plain.notes.slice(2)).toEqual([
      'note: unsettled top-level await in "/a.test.ts"',
      'note: an onLoad() plugin or a mock.module() factory never settled for "/kept.ts"',
    ]);
    expect(await notesOf(files, "--aot")).toEqual(plain);
  });

  test("names no module whose mock waits for a module that had run before", async () => {
    const files = {
      "a.test.ts": `import { mock, test } from "bun:test";
import { kept } from "./kept.ts";
console.log(kept);
void mock.module("./kept.ts", () => new Promise(() => {}));
await new Promise(() => {});
test("never runs", () => {});
`,
      "kept.ts": `export const kept = 2;`,
    };
    const plain = await notesOf(files);
    expect(plain.notes.slice(2)).toEqual(['note: unsettled top-level await in "/a.test.ts"']);
    expect(await notesOf(files, "--aot")).toEqual(plain);
  });
});

test("a factory that never settles holds the import() that came to it, and no test", async () => {
  const files = {
    "a.test.ts": `import { expect, mock, test } from "bun:test";
mock.module("./late.ts", () => new Promise(() => {}));
void import("./late.ts");
test("runs", () => expect(1).toBe(1));
`,
    "late.ts": `export const late = 1;`,
  };
  const plain = await notesOf(files);
  expect(plain).toEqual({ notes: [], exitCode: 0 });
  expect(await notesOf(files, "--aot")).toEqual(plain);
});
