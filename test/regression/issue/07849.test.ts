import { test, expect } from "bun:test";
import "harness";
import { tempDirWithFiles } from "harness";
test("07849", async () => {
  const tempdir = tempDirWithFiles("07849", {
    "package.json": JSON.stringify(
      {
        name: "07849",
        version: "0.0.0",
      },
      null,
      2,
    ),
    "index.test.ts": /*ts*/ `
import { test, expect, describe } from "bun:test";

function fn(n: number) {
  return n + 1;
}

describe(fn, () => {
  test("zero", () => {
    process.exit(123);
  });
});
`,
  });
  expect({
    cwd: tempdir,
    cmds: ["test", "index.test.ts"],
    exitCode: 123,
  }).toRun();
});
