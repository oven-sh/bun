import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// Without --isolate and without --parallel the test files of a run share a global object, in the order of the files.
// Each program above the layers runs in a process of its own, so such test files are one program however many they are.
// Only a word brings layers to such a run. It cut the test files into programs of sixteen, and what one file left was gone at every border.
const count = 40;
const files: Record<string, string> = { "package.json": `{ "name": "shared-global-object", "type": "module" }` };
for (let index = 0; index < count; index++) {
  const name = `f${String(index).padStart(2, "0")}`;
  files[`${name}.test.js`] = `import { test } from "bun:test";
test("${name}", () => {
  console.log("SEEN ${name}", globalThis.filesBefore ?? "none", [].leftOnThePrototype ?? "none", Bun.s3.filesBefore ?? "none");
  globalThis.filesBefore = (globalThis.filesBefore ?? 0) + 1;
  Array.prototype.leftOnThePrototype = "${name}";
  Bun.s3.filesBefore = (Bun.s3.filesBefore ?? 0) + 1;
});
`;
}

async function runTests(directory: string, words: string | undefined, ...flags: string[]) {
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], directory, env);
  if (exitCode !== 0) console.error(stderr);
  const form = stderr.split("\n").find(line => line.startsWith("AOT test run | "));
  return { seen: { stdout: stdout.split("\n").filter(line => line.startsWith("SEEN")), exitCode }, form };
}

test("what a test file leaves in the realm is there for every later one", async () => {
  using dir = tempDir("aot-test-files-share-a-global-object", files);
  const plain = await runTests(String(dir), undefined);
  expect(plain.seen.exitCode).toBe(0);
  expect(plain.seen.stdout.length).toBe(count);
  expect(plain.seen.stdout.at(-1)).toBe(`SEEN f39 39 f38 39`);
  expect((await runTests(String(dir), undefined, "--aot")).seen).toEqual(plain.seen);
  for (const layers of [1, 2]) {
    const compiled = await runTests(String(dir), `TestRunLayers:${layers}`, "--aot");
    expect(compiled.seen).toEqual(plain.seen);
    // Where this Bun loads one program a realm there are no layers.
    if (compiled.form?.includes("| layers "))
      expect(compiled.form).toContain(`| test files ${count} | to a program ${count}`);
  }
}, 300_000);

test("with --isolate every file starts anew, in programs of sixteen too", async () => {
  using dir = tempDir("aot-test-files-apart", files);
  const plain = await runTests(String(dir), undefined, "--isolate");
  expect(plain.seen.stdout.at(-1)).toStartWith(`SEEN f39 none none`);
  const compiled = await runTests(String(dir), "TestRunLayers:2", "--aot", "--isolate");
  const withoutWhatOutlivesARealm = (lines: string[]) => lines.map(line => line.split(" ").slice(0, 4).join(" "));
  expect(withoutWhatOutlivesARealm(compiled.seen.stdout)).toEqual(withoutWhatOutlivesARealm(plain.seen.stdout));
  if (compiled.form?.includes("| layers ")) expect(compiled.form).toContain(`| test files ${count} | to a program 16`);
}, 300_000);
