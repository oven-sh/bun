import { describe, expect, test } from "bun:test";
import { spawn as cpSpawn } from "child_process";
import { chmodSync } from "fs";
import { bunEnv, isWindows, tempDir, tempDirWithFiles } from "harness";
import path from "path";

test.skipIf(isWindows)("spawn uses PATH from env if present", async () => {
  const tmpDir = await tempDirWithFiles("spawn-path", {
    "test-script": `#!/usr/bin/env bash
echo "hello from script"`,
  });

  chmodSync(path.join(tmpDir, "test-script"), 0o777);

  const proc = Bun.spawn(["test-script"], {
    env: {
      ...bunEnv,
      PATH: tmpDir + ":" + bunEnv.PATH,
    },
  });

  const output = await proc.stdout.text();
  expect(output.trim()).toBe("hello from script");

  const status = await proc.exited;
  expect(status).toBe(0);
});

// Node's execvp walks PATH after the child's chdir, so a relative PATH entry
// like `.` or `node_modules/.bin` refers to the child's cwd, not the parent's.
describe.skipIf(isWindows)("spawn resolves relative PATH entries against the cwd option", () => {
  function makeDir() {
    const dir = tempDir("spawn-relpath", {
      "sub/tool.sh": "#!/bin/sh\necho RAN\n",
      "project/node_modules/.bin/mytool": "#!/bin/sh\necho FROM_BIN\n",
    });
    chmodSync(path.join(String(dir), "sub", "tool.sh"), 0o755);
    chmodSync(path.join(String(dir), "project", "node_modules", ".bin", "mytool"), 0o755);
    return dir;
  }

  test.concurrent("Bun.spawn with PATH='.'", async () => {
    using dir = makeDir();
    await using proc = Bun.spawn({
      cmd: ["tool.sh"],
      cwd: path.join(String(dir), "sub"),
      env: { ...bunEnv, PATH: ".:" + bunEnv.PATH },
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("RAN");
    expect(exitCode).toBe(0);
  });

  test.concurrent("Bun.spawn with PATH='node_modules/.bin'", async () => {
    using dir = makeDir();
    await using proc = Bun.spawn({
      cmd: ["mytool"],
      cwd: path.join(String(dir), "project"),
      env: { ...bunEnv, PATH: "node_modules/.bin:" + bunEnv.PATH },
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("FROM_BIN");
    expect(exitCode).toBe(0);
  });

  test.concurrent("child_process.spawn with PATH='.'", async () => {
    using dir = makeDir();
    const { promise, resolve, reject } = Promise.withResolvers<{
      stdout: string;
      stderr: string;
      code: number | null;
    }>();
    const c = cpSpawn("tool.sh", [], {
      cwd: path.join(String(dir), "sub"),
      env: { ...bunEnv, PATH: ".:" + bunEnv.PATH },
    });
    let stdout = "";
    let stderr = "";
    c.stdout.on("data", d => (stdout += d));
    c.stderr.on("data", d => (stderr += d));
    c.on("error", reject);
    c.on("close", code => resolve({ stdout, stderr, code }));
    const result = await promise;
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe("RAN");
    expect(result.code).toBe(0);
  });
});
