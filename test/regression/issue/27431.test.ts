import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";

test.if(isWindows)("standalone worker does not crash when autoloadDotenv is disabled and .env exists", async () => {
  const target = process.arch === "arm64" ? "bun-windows-aarch64" : "bun-windows-x64";

  using dir = tempDir("issue-27431", {
    ".env": "TEST_VAR=from_dotenv\n",
    "entry.ts": 'console.log(process.env.TEST_VAR || "not found")\nnew Worker("./worker.ts")\n',
    "worker.ts": "",
    "build.ts": `
      await Bun.build({
        entrypoints: ["./entry.ts", "./worker.ts"],
        compile: {
          autoloadDotenv: false,
          target: "${target}",
          outfile: "./app.exe",
        },
      });
    `,
  });

  await using build = Bun.spawn({
    cmd: [bunExe(), join(String(dir), "build.ts")],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [, buildStderr, buildExitCode] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);

  expect(buildExitCode).toBe(0);
  expect(buildStderr).toBe("");

  await using proc = Bun.spawn({
    cmd: [join(String(dir), "app.exe")],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("not found");
  expect(exitCode).toBe(0);
  expect(stderr).toBe("");
});
