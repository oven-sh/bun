import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

const tsconfig = JSON.stringify({ compilerOptions: { strict: true, noEmit: true, types: [] }, include: ["*.ts"] });

async function check(source: string) {
  using dir = tempDir("check-delete-of-a-name", { "tsconfig.json": tsconfig, "a.ts": source });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "check", "--no-pretty"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text()]);
  return { errors: (stdout + stderr).match(/\(\d+,\d+\): error TS\d+|panic/g) ?? [], exitCode: await proc.exited };
}

// Whether the error keeps a program from running is asked of the tables of what runs, which `bun check` does not make.
test.each([
  ["a variable", "var size = 1;\ndelete size;\nexport {};\n", 2, 8],
  [
    "a variable that a namespace exports",
    "namespace Box {\n  export var size = 1;\n  delete size;\n}\nexport {};\n",
    3,
    10,
  ],
  ["a member of an enum", "enum Side {\n  Left,\n  Right = +delete Left,\n}\nexport {};\n", 3, 19],
])("delete of %s", async (_, source, line, column) => {
  expect(await check(source)).toEqual({
    errors: [`(${line},${column}): error TS1102`, `(${line},${column}): error TS2703`],
    exitCode: 1,
  });
});
