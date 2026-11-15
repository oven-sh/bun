import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// A macro of Bun.Transpiler.transform() loads its module on another thread, in a VM of its own.
test.concurrent.each([
  ["a module is mocked", `import { mock, test } from "bun:test";\nmock.module("./mocked.ts", () => ({}));\n`],
  ["nothing is mocked", `import { test } from "bun:test";\n`],
])("macros of transpilers load their modules while a test runs and %s", async (_, begin) => {
  const loads = 200;
  const modules = Array.from({ length: loads }, (_, i) => [`m${i}.ts`, `export default ${i};`]);
  using dir = tempDir("macros-beside-tests", {
    ...Object.fromEntries(modules),
    "mocked.ts": "",
    "macro.ts": `export function macro() { return "from the macro"; }`,
    "runs.test.ts": `${begin}
      test("runs", async () => {
        const transpiler = new Bun.Transpiler({ loader: "ts" });
        const text = 'import { macro } from "./macro.ts" with { type: "macro" };\\nexport default macro();';
        let right = 0;
        for (let i = 0; i < ${loads}; i += 4) {
          await Promise.all([0, 1, 2, 3].map(j => import("./m" + (i + j) + ".ts")));
          const texts = await Promise.all([0, 1, 2, 3].map(() => transpiler.transform(text)));
          right += texts.filter(it => it.includes("from the macro")).length;
        }
        console.log(right);
      });`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "./runs.test.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout.replace(/^bun test v.*$/m, "").trim()).toBe(String(loads));
  expect(stderr).toContain("(pass) runs");
  expect(exitCode).toBe(0);
});

test.concurrent.each([
  ["Bun.build()", `(await Bun.build({ entrypoints: ["./calls-macro.ts"] })).outputs[0].text()`],
  ["Bun.Transpiler", `new Bun.Transpiler({ loader: "ts" }).transform(await Bun.file("./calls-macro.ts").text())`],
])("in a macro of %s, expect() works like outside of bun test, and test() and hooks throw", async (_, transpile) => {
  using dir = tempDir("macros-without-runner", {
    "macro.ts": `
      import { afterAll, describe, expect, onTestFinished, setDefaultTimeout, test } from "bun:test";
      export function macro() {
        return Object.entries({
          "expect": () => expect(1).toBe(1),
          "currentTestName": () => expect.getState().currentTestName,
          "assertions": () => expect.assertions(1),
          "toMatchSnapshot": () => expect(1).toMatchSnapshot(),
          "setDefaultTimeout": () => setDefaultTimeout(1),
          "test": () => test("in a macro", () => {}),
          "describe": () => describe("in a macro", () => {}),
          "afterAll": () => afterAll(() => {}),
          "onTestFinished": () => onTestFinished(() => {}),
        }).map(([name, fn]) => {
          try {
            return name + ": " + fn();
          } catch (error) {
            return name + " throws: " + Bun.stripANSI(error.message).trim().split("\\n").at(-1);
          }
        });
      }`,
    "calls-macro.ts": `
      import { macro } from "./macro.ts" with { type: "macro" };
      console.log("result", JSON.stringify(macro()));`,
    "runs.test.ts": `
      import { expect, onTestFinished, test } from "bun:test";
      test("runs", async () => {
        expect.assertions(0);
        (0, eval)(await ${transpile});
        // Outlasts the timeout that the macro asked for.
        onTestFinished(() => Bun.sleep(20));
      });`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "./runs.test.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(JSON.parse(stdout.match(/^result (.*)$/m)?.[1] ?? "null")).toEqual([
    "expect: undefined",
    "currentTestName: undefined",
    "assertions throws: expect.assertions() must be called within a test",
    "toMatchSnapshot throws: Matcher error: Snapshot matchers cannot be used outside of a test",
    "setDefaultTimeout: undefined",
    "test throws: Cannot use test in a macro.",
    "describe throws: Cannot use describe in a macro.",
    "afterAll throws: Cannot use afterAll() in a macro.",
    "onTestFinished throws: Cannot use onTestFinished() in a macro.",
  ]);
  expect(stderr).toContain("(pass) runs");
  expect(exitCode).toBe(0);
});
