import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test.each([
  { statement: 'import type { Missing } from "./dependency.mts";', loadsModule: false },
  { statement: 'import { type Missing } from "./dependency.mts";', loadsModule: true },
  { statement: 'export type { Missing } from "./dependency.mts";', loadsModule: false },
  { statement: 'export { type Missing } from "./dependency.mts";', loadsModule: true },
])("preserves the runtime dependency edge for $statement", async ({ statement, loadsModule }) => {
  using dir = tempDir("type-only-module-loading", {
    "entry.mts": `${statement}\nconsole.log("entry executed");\n`,
    "dependency.mts": 'throw new Error("dependency evaluated");\nexport type Missing = never;\n',
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.mts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  if (loadsModule) {
    expect(exitCode).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain("dependency evaluated");
  } else {
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "entry executed\n",
      stderr: "",
      exitCode: 0,
    });
  }
});
