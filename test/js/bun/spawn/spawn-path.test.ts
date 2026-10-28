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

// execvp and libuv substitute the default PATH only when the child env has no
// PATH entry at all. An empty PATH searches the cwd only, and an empty segment
// (":/bin", "/bin:") is the cwd. See #44948.
describe.skipIf(isWindows)("spawn with an empty PATH", () => {
  function makeDir() {
    const dir = tempDir("spawn-empty-path", {
      "hello": "#!/bin/sh\necho HELLO_FROM_CWD\n",
      "bin/hello": "#!/bin/sh\necho HELLO_FROM_BIN\n",
      "sub/hello": "#!/bin/sh\necho HELLO_FROM_SUB\n",
      "probe.js": `console.log(process.env.PATH.endsWith(":"));
        try { console.log(Bun.spawnSync({ cmd: ["hello"], stdout: "pipe" }).stdout.toString().trim()); }
        catch (e) { console.log(e.code); }`,
    });
    chmodSync(path.join(String(dir), "hello"), 0o755);
    chmodSync(path.join(String(dir), "bin", "hello"), 0o755);
    chmodSync(path.join(String(dir), "sub", "hello"), 0o755);
    return dir;
  }

  function spawnSyncResult(cmd: string[], env: Record<string, string>, cwd?: string) {
    try {
      const r = Bun.spawnSync({ cmd, env, cwd, stdout: "pipe", stderr: "pipe" });
      return { ran: true, stdout: r.stdout.toString().trim(), exitCode: r.exitCode };
    } catch (e: any) {
      return { ran: false, code: e.code };
    }
  }

  test.concurrent("env PATH='' does not find a binary that is not in the cwd", () => {
    using dir = makeDir();
    expect(spawnSyncResult(["uname"], { PATH: "" }, String(dir))).toEqual({ ran: false, code: "ENOENT" });
  });

  test.concurrent("env without a PATH entry keeps the default PATH", () => {
    using dir = makeDir();
    expect(spawnSyncResult(["uname"], {}, String(dir)).ran).toBe(true);
  });

  test.concurrent("env PATH='' finds a binary in the cwd", () => {
    using dir = makeDir();
    expect(spawnSyncResult(["hello"], { PATH: "" }, String(dir))).toEqual({
      ran: true,
      stdout: "HELLO_FROM_CWD",
      exitCode: 0,
    });
  });

  test.concurrent("an empty PATH segment is the cwd", () => {
    using dir = makeDir();
    for (const PATH of [":/nonexistent", "/nonexistent:", "/nonexistent::/nonexistent"]) {
      expect(spawnSyncResult(["hello"], { PATH }, String(dir))).toEqual({
        ran: true,
        stdout: "HELLO_FROM_CWD",
        exitCode: 0,
      });
    }
    expect(spawnSyncResult(["hello"], { PATH: "/nonexistent" }, String(dir))).toEqual({
      ran: false,
      code: "ENOENT",
    });
  });

  test.concurrent("the first PATH segment wins, whether it is empty or a directory", () => {
    using dir = makeDir();
    const bin = path.join(String(dir), "bin");
    expect(spawnSyncResult(["hello"], { PATH: bin + ":" }, String(dir)).stdout).toBe("HELLO_FROM_BIN");
    expect(spawnSyncResult(["hello"], { PATH: ":" + bin }, String(dir)).stdout).toBe("HELLO_FROM_CWD");
  });

  test.concurrent("a relative cwd option is the directory the cwd segment names", async () => {
    using dir = makeDir();
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const r = (env, cwd) => {
           try { return Bun.spawnSync({ cmd: ["hello"], env, cwd, stdout: "pipe" }).stdout.toString().trim(); }
           catch (e) { return e.code; }
         };
         console.log(r({ PATH: "" }, "sub"), r({ PATH: ":/nonexistent" }, "./sub"), r({ PATH: "." }, "sub"), r({ PATH: "bin:" }, "sub"));`,
      ],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("HELLO_FROM_SUB HELLO_FROM_SUB HELLO_FROM_SUB HELLO_FROM_SUB\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("Bun.which keeps skipping an empty PATH segment", () => {
    using dir = makeDir();
    expect(Bun.which("hello", { PATH: "", cwd: String(dir) })).toBeNull();
    expect(Bun.which("hello", { PATH: ":/nonexistent", cwd: String(dir) })).toBeNull();
  });

  test.concurrent("bun run with no PATH in its environ does not add a trailing empty segment", async () => {
    using dir = makeDir();
    const { PATH, ...envWithoutPath } = bunEnv;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "probe.js"],
      env: envWithoutPath,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const [pathEndsWithDelimiter, spawnResult] = stdout.trim().split("\n");
    expect(pathEndsWithDelimiter).toBe("false");
    expect(spawnResult).toBe("ENOENT");
    expect(exitCode).toBe(0);
  });

  test.concurrent("child_process.spawnSync with process.env.PATH = '' reports ENOENT", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { spawnSync } = require("node:child_process");
         process.env.PATH = "";
         const r = spawnSync("uname", []);
         console.log(r.error ? r.error.code : "ran");
         delete process.env.PATH;
         const r2 = spawnSync("uname", []);
         console.log(r2.error ? r2.error.code : "ran");
         const r3 = spawnSync("env", []);
         console.log(r3.stdout.toString().split("\\n").some(l => l.startsWith("PATH=")) ? "PATH present" : "PATH absent");`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("ENOENT\nran\nPATH absent\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("PATH='' in the parent environ is an empty PATH for the child", async () => {
    using dir = makeDir();
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const r = (cmd) => { try { Bun.spawnSync({ cmd, stdout: "pipe" }); return "ran"; } catch (e) { return e.code; } };
         console.log(r(["uname"]), r(["hello"]));`,
      ],
      env: { ...bunEnv, PATH: "" },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("ENOENT ran\n");
    expect(exitCode).toBe(0);
  });
});
