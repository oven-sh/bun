import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

// Native code has the library make `process.stderr` once for the realm, and it asks the lowest program for that. The program of a test file held a copy of the same code, took the
// stream for what its copy makes, and called its own `write` on the closure of the other program: the worker died.
// No file prints by `console`: that alone used to hide the fault.
const forms: Record<string, string> = {
  "stderr-write": `expect(process.stderr.write("")).toBe(true);`,
  "stdout-write": `expect(process.stdout.write("")).toBe(true);`,
  "stdout-on": `const f = () => {}; process.stdout.on("drain", f); expect(process.stdout.listenerCount("drain")).toBe(1); process.stdout.off("drain", f);`,
  "stdout-once": `const f = () => {}; process.stdout.once("x", f); expect(process.stdout.listenerCount("x")).toBe(1); process.stdout.removeListener("x", f);`,
  "stdout-cork": `process.stdout.cork(); process.stdout.uncork();`,
  "stdin-on": `const f = () => {}; process.stdin.on("data", f); process.stdin.off("data", f); process.stdin.pause();`,
  "stderr-members": `expect(typeof process.stderr.end).toBe("function"); expect(process.stderr.writable).toBe(true);`,
};

test("a test file uses the standard streams that the lowest program made", async () => {
  const files: Record<string, string> = { "package.json": `{ "name": "p", "type": "module" }`, "tsconfig.json": "{}" };
  for (const [name, body] of Object.entries(forms))
    files[`${name}.test.js`] =
      `import { expect, test } from "bun:test";\ntest(${JSON.stringify(name)}, () => { ${body} });\n`;
  using dir = tempDir("what-native-code-keeps", files);
  const seen = async (env: Record<string, string | undefined>, ...flags: string[]) => {
    const { stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], String(dir), env);
    if (exitCode !== 0) console.error(stderr);
    // The parts of a run end in any order.
    return {
      exitCode,
      tests: [...stderr.matchAll(/^\((pass|fail)\) (\S+)/gm)].map(match => `${match[2]} ${match[1]}`).sort(),
    };
  };
  const plain = await seen(bunEnv);
  expect(plain).toEqual({
    exitCode: 0,
    tests: Object.keys(forms)
      .map(name => `${name} pass`)
      .sort(),
  });
  // Each test file is a program of its own over two others: beside other files the compiler knows less, and the fault does not show.
  expect(await seen({ ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2,TestRunPartFiles:1" }, "--aot")).toEqual(
    plain,
  );
  expect(await seen({ ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2" }, "--aot")).toEqual(plain);
});
