import { describe, expect, test } from "bun:test";
import { execFile, spawn as cpSpawn, spawnSync as cpSpawnSync } from "child_process";
import { chmodSync, symlinkSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir, tempDirWithFiles } from "harness";
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

// What a Windows environment has. bunEnv spells it `PATH`.
test.skipIf(!isWindows)("spawn uses the PATH that env spells `Path`", async () => {
  using dir = tempDir("spawn-path-spelling", { "only-here.cmd": "@echo found\r\n" });
  const { PATH, ...rest } = bunEnv;
  const env = { ...rest, Path: `${String(dir)};${PATH}` };
  const run = async (cmd: string[]) => {
    await using proc = Bun.spawn({ cmd, env, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: stdout.trim(), stderr, exitCode };
  };
  const [lookup, child] = await Promise.all([run(["only-here"]), run([bunExe(), "-p", "process.env.PATH"])]);
  expect({ lookup, child }).toEqual({
    lookup: { stdout: "found", stderr: "", exitCode: 0 },
    child: { stdout: env.Path, stderr: "", exitCode: 0 },
  });
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

// POSIX execute permission bits and directory candidates do not apply on Windows.
describe.skipIf(isWindows)("spawn retains permission errors from PATH", () => {
  test.concurrent.each([
    ["tool", "ENOENT"],
    ["sub/tool", "EACCES"],
  ])("probes the child's relative cwd when %s is denied", async (deniedFile, expectedCode) => {
    using dir = tempDir("spawn-path-relative-error", { "sub/.keep": "", [deniedFile]: "not executable" });
    chmodSync(path.join(String(dir), deniedFile), 0o600);
    await using child = Bun.spawn(
      [
        bunExe(),
        "-e",
        `let code;
        try { Bun.spawnSync(["tool"], { cwd: "sub", env: { ...process.env, PATH: "." } }); }
        catch (error) { code = error.code; }
        process.stdout.write(code ?? "unexpected success");`,
      ],
      { cwd: String(dir), env: bunEnv, stderr: "pipe" },
    );
    const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: expectedCode, stderr: "", exitCode: 0 });
  });

  test.concurrent("preserves executable selection with a relative cwd", async () => {
    using dir = tempDir("spawn-path-relative-cwd", { "sub/.keep": "" });
    symlinkSync(bunExe(), path.join(String(dir), "tool"));
    symlinkSync(bunExe(), path.join(String(dir), "sub/tool"));
    await using child = Bun.spawn(
      [
        bunExe(),
        "-e",
        `const result = Bun.spawnSync(["tool", "-e", 'process.stdout.write("OK")'], {
          cwd: "sub", env: { ...process.env, PATH: "." }
        });
        process.stdout.write(result.stdout);
        process.stderr.write(result.stderr);
        process.exit(result.exitCode);`,
      ],
      { cwd: String(dir), env: bunEnv, stderr: "pipe" },
    );
    const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "OK", stderr: "", exitCode: 0 });
  });

  test.concurrent.each([
    ["denied", false],
    ["denied", true],
    ["directory", false],
    ["directory", true],
  ] as const)("candidate=%s, relative=%s", async (candidate, relative) => {
    using dir = tempDir("spawn-path-permission", {
      "denied/tool": "not executable",
      "directory/tool/.keep": "",
      "allowed/.keep": "",
    });
    chmodSync(path.join(String(dir), "denied/tool"), 0o600);
    symlinkSync(bunExe(), path.join(String(dir), "allowed/tool"));
    const entry = (name: string) => (relative ? name : path.join(String(dir), name));
    const options = {
      cwd: String(dir),
      env: { ...bunEnv, PATH: [entry(candidate), entry("missing")].join(path.delimiter) },
    };
    const expectedError = { code: "EACCES", path: "tool" };

    expect(() => Bun.spawn(["tool"], options)).toThrow(expect.objectContaining(expectedError));
    expect(() => Bun.spawnSync(["tool"], options)).toThrow(expect.objectContaining(expectedError));
    expect(cpSpawnSync("tool", [], options).error).toMatchObject(expectedError);

    const { promise, resolve, reject } = Promise.withResolvers<Error>();
    const child = cpSpawn("tool", [], { ...options, stdio: "ignore" });
    child.once("error", resolve);
    child.once("close", () => reject(new Error("Expected spawn error")));
    expect(await promise).toMatchObject(expectedError);

    const error = await new Promise<Error | null>(resolve => execFile("tool", [], options, resolve));
    expect(error).toMatchObject(expectedError);
    expect(cpSpawnSync("absent-tool", [], options).error).toMatchObject({ code: "ENOENT" });
    expect(Bun.which("tool", { cwd: options.cwd, path: options.env.PATH })).toBeNull();

    const success = await new Promise(resolve =>
      execFile(
        "tool",
        ["-e", 'process.stdout.write("OK")'],
        {
          ...options,
          env: { ...options.env, PATH: [entry(candidate), entry("missing"), entry("allowed")].join(path.delimiter) },
        },
        (error, stdout, stderr) => resolve({ error, stdout, stderr }),
      ),
    );
    expect(success).toEqual({ error: null, stdout: "OK", stderr: "" });
  });
});
