import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

// Overriding Array.prototype[Symbol.iterator] must not rewrite child argv or break
// builtin-module loading. Each case runs in a fresh subprocess; builtin loads use
// process.getBuiltinModule so the transpiler cannot hoist them ahead of the pollution.

async function run(code: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", code],
    env: bunEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe.concurrent("node:child_process with Array.prototype[Symbol.iterator] overridden", () => {
  test("spawnSync argv is not rewritten by the polluted iterator", async () => {
    const { stdout, stderr, exitCode } = await run(`
      const { spawnSync } = require("node:child_process");
      Array.prototype[Symbol.iterator] = function* () { yield "REWRITTEN"; };
      const r = spawnSync(process.execPath, ["-e", "process.stdout.write(process.argv[1])", "intended"], {
        encoding: "utf8",
      });
      process.stdout.write(r.stdout + "|" + r.status);
    `);
    expect(stderr).toBe("");
    expect(stdout).toBe("intended|0");
    expect(exitCode).toBe(0);
  });

  test("spawn argv is not rewritten by the polluted iterator", async () => {
    const { stdout, stderr, exitCode } = await run(`
      const { spawn } = require("node:child_process");
      Array.prototype[Symbol.iterator] = function* () { yield "REWRITTEN"; };
      const child = spawn(process.execPath, ["-e", "process.stdout.write(process.argv[1])", "intended"]);
      let out = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", d => out += d);
      child.on("close", code => process.stdout.write(out + "|" + code));
    `);
    expect(stderr).toBe("");
    expect(stdout).toBe("intended|0");
    expect(exitCode).toBe(0);
  });

  test("spawnSync with argv0 still passes the requested argv0", async () => {
    const { stdout, stderr, exitCode } = await run(`
      const { spawnSync } = require("node:child_process");
      Array.prototype[Symbol.iterator] = function* () { yield "REWRITTEN"; };
      const r = spawnSync(process.execPath, ["-e", "process.stdout.write(process.argv0)"], {
        encoding: "utf8",
        argv0: "custom-argv0",
      });
      process.stdout.write(r.stdout + "|" + r.status);
    `);
    expect(stderr).toBe("");
    expect(stdout).toBe("custom-argv0|0");
    expect(exitCode).toBe(0);
  });

  test("execSync works after pollution (lazy node:path/node:fs load)", async () => {
    const cmd = isWindows ? `cmd /c echo intended` : `/bin/echo intended`;
    const { stdout, stderr, exitCode } = await run(`
      const { execSync } = require("node:child_process");
      Array.prototype[Symbol.iterator] = function* () { yield "REWRITTEN"; };
      const out = execSync(${JSON.stringify(cmd)}, { encoding: "utf8" });
      process.stdout.write(out.trim());
    `);
    expect(stderr).toBe("");
    expect(stdout).toBe("intended");
    expect(exitCode).toBe(0);
  });

  test("node:child_process can be loaded after pollution", async () => {
    const { stdout, stderr, exitCode } = await run(`
      Array.prototype[Symbol.iterator] = function* () { yield "x"; };
      const cp = process.getBuiltinModule("node:child_process");
      process.stdout.write(typeof cp.spawnSync);
    `);
    expect(stderr).toBe("");
    expect(stdout).toBe("function");
    expect(exitCode).toBe(0);
  });

  test("node:events can be loaded after pollution", async () => {
    const { stdout, stderr, exitCode } = await run(`
      Array.prototype[Symbol.iterator] = function* () { yield "x"; };
      const EE = process.getBuiltinModule("node:events");
      process.stdout.write(typeof EE);
    `);
    expect(stderr).toBe("");
    expect(stdout).toBe("function");
    expect(exitCode).toBe(0);
  });

  test("node:path can be loaded after pollution", async () => {
    const { stdout, stderr, exitCode } = await run(`
      Array.prototype[Symbol.iterator] = function* () { yield "x"; };
      const path = process.getBuiltinModule("node:path");
      process.stdout.write(path.posix.join("a", "b"));
    `);
    expect(stderr).toBe("");
    expect(stdout).toBe("a/b");
    expect(exitCode).toBe(0);
  });

  test("node:url can be loaded after pollution", async () => {
    const { stdout, stderr, exitCode } = await run(`
      Array.prototype[Symbol.iterator] = function* () { yield "x"; };
      const url = process.getBuiltinModule("node:url");
      process.stdout.write(url.domainToASCII("example.com"));
    `);
    expect(stderr).toBe("");
    expect(stdout).toBe("example.com");
    expect(exitCode).toBe(0);
  });
});

test("ChildProcess#spawn envPairs preserves '=' inside values", async () => {
  const { stdout, stderr, exitCode } = await run(`
    const { ChildProcess } = require("node:child_process");
    const cp = new ChildProcess();
    cp.spawn({
      file: process.execPath,
      args: [process.execPath, "-e", "process.stdout.write(process.env.KEY)"],
      envPairs: ["KEY=a=b=c", "BUN_DEBUG_QUIET_LOGS=1", "PATH=" + (process.env.PATH || "")],
      stdio: ["ignore", "pipe", "ignore"],
    });
    let out = "";
    cp.stdout.on("data", d => out += d);
    cp.on("close", () => process.stdout.write(out));
  `);
  expect(stderr).toBe("");
  expect(stdout).toBe("a=b=c");
  expect(exitCode).toBe(0);
});
