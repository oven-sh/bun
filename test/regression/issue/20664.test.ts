import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("issue #20664 - decorated uninitialized properties should not be removed", async () => {
  using dir = tempDir("issue-20664", {
    "package.json": JSON.stringify({
      name: "issue-20664-test",
      dependencies: {
        "class-transformer": "^0.5.1",
        "reflect-metadata": "^0.2.0",
      },
    }),
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        baseUrl: ".",
        emitDecoratorMetadata: true,
        esModuleInterop: true,
        experimentalDecorators: true,
        module: "ESNext",
        moduleResolution: "Bundler",
        target: "ESNext",
      },
    }),
    "test.ts": `
import 'reflect-metadata';
import { Expose } from 'class-transformer';

export class Schema {
  @Expose()
  id: string;

  @Expose()
  name: string;

  @Expose()
  date: Date;
}

const instance = new Schema();
const keys = Object.keys(instance);

console.log(JSON.stringify(keys));
`,
  });

  // Install dependencies
  await using installProc = Bun.spawn({
    cmd: [bunExe(), "install"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [installStdout, installStderr, installExitCode] = await Promise.all([
    installProc.stdout.text(),
    installProc.stderr.text(),
    installProc.exited,
  ]);

  if (installExitCode !== 0) {
    console.error("Install stdout:", installStdout);
    console.error("Install stderr:", installStderr);
    throw new Error(`bun install failed with exit code ${installExitCode}`);
  }

  // Run the test file
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);

  // The output should contain the keys array with all three properties
  const keys = JSON.parse(stdout.trim());
  expect(keys).toEqual(["id", "name", "date"]);
});
