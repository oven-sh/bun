import { describe, expect, test } from "bun:test";
import { spawn as cpSpawn } from "child_process";
import { chmodSync } from "fs";
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

// The PATH search needs no descriptor, so with none left the command is still found. The spawn then fails when it
// makes the pipes, with EMFILE, as in Node. macOS opened each PATH candidate to test it, found nothing, and
// reported ENOENT: "Executable not found in $PATH".
test.skipIf(isWindows)("spawn finds a command on PATH when the process has no descriptor left", async () => {
  using dir = tempDir("spawn-path-no-descriptor", { "tool": "#!/bin/sh\necho tool ran\n" });
  chmodSync(path.join(String(dir), "tool"), 0o755);

  const fixture = /* js */ `
    const cp = require("node:child_process");
    const fs = require("node:fs");
    const env = { PATH: process.env.TOOL_DIR };
    const code = fn => {
      try {
        fn();
        return "spawned";
      } catch (error) {
        return error.code;
      }
    };
    const spawnEvent = name =>
      new Promise(resolve => {
        const child = cp.spawn(name, [], { env, stdio: "pipe" });
        child.once("error", error => resolve(error.code));
        child.once("close", () => resolve("spawned"));
      });

    // A debug build reads its internal modules from disk on first use, and that needs a descriptor.
    const warmUp = [
      cp.spawnSync("tool", [], { env, stdio: "pipe" }).status,
      Bun.spawnSync({ cmd: ["tool"], env, stdout: "pipe", stderr: "pipe" }).exitCode,
      await spawnEvent("tool"),
      await spawnEvent("missing-tool"),
    ];

    const held = [];
    try {
      for (;;) held.push(fs.openSync("/dev/null", "r"));
    } catch {}
    const noDescriptorLeft = {
      "child_process.spawnSync": cp.spawnSync("tool", [], { env, stdio: "pipe" }).error?.code,
      "child_process.spawn": await spawnEvent("tool"),
      "Bun.spawnSync": code(() => Bun.spawnSync({ cmd: ["tool"], env, stdout: "pipe", stderr: "pipe" })),
      "Bun.spawn": code(() => Bun.spawn({ cmd: ["tool"], env, stdout: "pipe", stderr: "pipe" })),
    };
    for (const fd of held) fs.closeSync(fd);

    const afterClose = cp.spawnSync("tool", [], { env, stdio: "pipe", encoding: "utf8" }).stdout;
    console.log(JSON.stringify({ warmUp, heldSome: held.length > 0, noDescriptorLeft, afterClose }));
  `;

  await using proc = Bun.spawn({
    // `ulimit -n` also sets the hard limit, so the runtime cannot raise it again.
    cmd: ["/bin/sh", "-c", 'ulimit -n 128 && exec "$@"', "sh", bunExe(), "-e", fixture],
    env: { ...bunEnv, TOOL_DIR: String(dir) },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({
    warmUp: [0, 0, "spawned", "ENOENT"],
    heldSome: true,
    noDescriptorLeft: {
      "child_process.spawnSync": "EMFILE",
      "child_process.spawn": "EMFILE",
      "Bun.spawnSync": "EMFILE",
      "Bun.spawn": "EMFILE",
    },
    afterClose: "tool ran\n",
  });
  expect(exitCode).toBe(0);
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
