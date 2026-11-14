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
