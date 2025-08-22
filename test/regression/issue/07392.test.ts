import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDirWithFiles } from "harness";

test("issue #7392", async () => {
  const dir = tempDirWithFiles("issue-7392", {
    files: {
      tests: {
        "a.test.js": /*js*/ `
          import { test } from "#testing";

          test("A: test case", () => {});
          test("A: another test case", () => {});
          test("A: final test case", () => {});
        `,
        "b.test.js": /*js*/ `
          import { test } from "#testing";

          test("B: test case", () => {});
          test("B: another test case", () => {});
          test("B: final test case", () => {});
        `,
        "c.test.js": /*js*/ `
          import { test } from "#testing";

          test("C: test case", () => {});
          test("C: another test case", () => {});
          test("C: final test case", () => {});
        `,
      },
      "framework.bun.ts": /*ts*/ `
        import { describe, it, expect, test, jest } from "bun:test";

        const spy = jest.fn;

        export { describe, it, expect, test, spy };
      `,
      "package.json": JSON.stringify({
        name: "bun-repro",
        imports: {
          "#testing": {
            bun: "./framework.bun.ts",
            default: "./framework.default.js",
          },
        },
      }),
    },
  });

  const { stdout, stderr, exited } = Bun.spawn({
    cmd: [bunExe(), "test"],
    cwd: dir,
    stdio: ["inherit", "pipe", "pipe"],
    env: bunEnv,
  });

  const code = await exited;
  expect({
    code,
    stdout: normalizeBunSnapshot(await stdout.text()),
    stderr: (await stderr.text())
      .split(/\n{2,}/)
      .map(l => l.trim())
      .sort()
      .map(line => normalizeBunSnapshot(line)),
  }).toMatchInlineSnapshot(`
    {
      "code": 0,
      "stderr": [
        
    "9 pass
     0 fail
    Ran 9 tests across 3 files."
    ,
        
    "files/tests/a.test.js:
    (pass) A: test case
    (pass) A: another test case
    (pass) A: final test case"
    ,
        
    "files/tests/b.test.js:
    (pass) B: test case
    (pass) B: another test case
    (pass) B: final test case"
    ,
        
    "files/tests/c.test.js:
    (pass) C: test case
    (pass) C: another test case
    (pass) C: final test case"
    ,
      ],
      "stdout": "bun test <version> (<revision>)",
    }
  `);
});
