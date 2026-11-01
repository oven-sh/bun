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
});
