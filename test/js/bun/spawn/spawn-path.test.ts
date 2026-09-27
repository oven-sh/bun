import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn as cpSpawn } from "child_process";
import { chmodSync, copyFileSync } from "fs";
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

// CreateProcess starts .com and .exe images, so those are what a name is completed with, as cmd.exe
// does it. Every image here is a copy of cmd.exe, which sets %COMSPEC% to its own path when it is
// given none.
describe.skipIf(!isWindows).each(["spawn", "spawnSync"] as const)("%s: the image a name with a directory runs", api => {
  let dir: ReturnType<typeof tempDir>;
  const root = () => String(dir);
  beforeAll(() => {
    dir = tempDir("spawn-image", { "cwd/sub/.keep": "", "cwd/directory.exe/.keep": "" });
    for (const image of ["both.com", "both.exe", "sub/tool.exe", "dotted.name.exe", "exact.image"]) {
      copyFileSync(path.join(process.env.SystemRoot!, "System32", "cmd.exe"), path.join(root(), "cwd", image));
    }
  });
  afterAll(() => dir[Symbol.dispose]());

  async function imageOf(file: string) {
    const options = { cwd: path.join(root(), "cwd"), env: {}, stdout: "pipe", stderr: "inherit" } as const;
    const cmd = [file, "/d", "/c", "echo %COMSPEC%"];
    let stdout: string;
    try {
      if (api === "spawnSync") {
        stdout = Bun.spawnSync(cmd, options).stdout.toString();
      } else {
        await using proc = Bun.spawn(cmd, options);
        stdout = await proc.stdout.text();
      }
    } catch (e: any) {
      return e.code;
    }
    return path.relative(path.join(root(), "cwd"), stdout.trim());
  }
  const absolute = (file: string) => path.join(root(), "cwd", file);

  test.each([
    ["the name itself", () => absolute("both.exe"), "both.exe"],
    [".com before .exe", () => absolute("both"), "both.com"],
    ["relative to the cwd option", () => "./both", "both.com"],
    ["/ in the name", () => "sub/tool", "sub\\tool.exe"],
    ["\\ in the name", () => "sub\\tool", "sub\\tool.exe"],
    ["no second dot after one at the end", () => "./both.", "both.com"],
    ["a name with an extension, as it is", () => "./exact.image", "exact.image"],
    ["a name with an extension that is not there as it is", () => "./dotted.name", "dotted.name.exe"],
    ["no drive: the cwd option's", () => absolute("both.exe").slice(2), "both.exe"],
    ["a drive and no root: the cwd option, on that drive", () => root().slice(0, 2) + "sub\\tool.exe", "sub\\tool.exe"],
    ["a directory is not an image", () => "./directory", "ENOENT"],
    ["nothing by that name", () => "./missing", "ENOENT"],
  ])("%s", async (_, file, expected) => {
    expect(await imageOf(file())).toBe(expected);
  });
});
