import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test.concurrent.each([
  [
    "a namespace of the file",
    `namespace local { export type T = number; export const v = 1; }
import T = local.T;
import v = local.v;
const t: T = v;
console.log("ran", t);
`,
  ],
  [
    "an imported namespace object",
    `import * as lib from "./lib";
import T = lib.T;
import v = lib.v;
const t: T = v;
console.log("ran", t);
`,
  ],
  [
    "a global namespace",
    `import Options = Intl.NumberFormatOptions;
import NumberFormat = Intl.NumberFormat;
const options: Options = {};
console.log("ran", new NumberFormat("en-US", options).format(1));
`,
  ],
])("a file with a used and an unused `import a = b.c` runs once: %s", async (_name, entry) => {
  using dir = tempDir("ts-import-alias-runs-once", {
    "lib.ts": `export type T = number;\nexport const v = 1;\n`,
    "entry.ts": entry,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toBe("ran 1\n");
  expect(exitCode).toBe(0);
});
