import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux } from "harness";
import { spawn, spawnSync } from "node:child_process";

// uid/gid is only supported on Linux
const describeLinux = isLinux ? describe : describe.skip;

describeLinux("Bun.spawn with uid/gid", () => {
  test("should spawn with uid option on Linux", async () => {
    const currentUid = process.getuid!();

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", "console.log(process.getuid())"],
      env: bunEnv,
      stdout: "pipe",
      uid: currentUid,
    });

    const stdout = await proc.stdout.text();
    const exitCode = await proc.exited;

    expect(stdout.trim()).toBe(currentUid.toString());
    expect(exitCode).toBe(0);
  });

  test("should spawn with gid option on Linux", async () => {
    const currentGid = process.getgid!();

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", "console.log(process.getgid())"],
      env: bunEnv,
      stdout: "pipe",
      gid: currentGid,
    });

    const stdout = await proc.stdout.text();
    const exitCode = await proc.exited;

    expect(stdout.trim()).toBe(currentGid.toString());
    expect(exitCode).toBe(0);
  });

  test("should spawn with both uid and gid options on Linux", async () => {
    const currentUid = process.getuid!();
    const currentGid = process.getgid!();

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", "console.log(process.getuid(), process.getgid())"],
      env: bunEnv,
      stdout: "pipe",
      uid: currentUid,
      gid: currentGid,
    });

    const stdout = await proc.stdout.text();
    const exitCode = await proc.exited;

    expect(stdout.trim()).toBe(`${currentUid} ${currentGid}`);
    expect(exitCode).toBe(0);
  });

  test("spawnSync with uid option on Linux", () => {
    const currentUid = process.getuid!();

    const { exitCode, stdout } = Bun.spawnSync({
      cmd: [bunExe(), "-e", "console.log(process.getuid())"],
      env: bunEnv,
      stdout: "pipe",
      uid: currentUid,
    });

    expect(stdout.toString().trim()).toBe(currentUid.toString());
    expect(exitCode).toBe(0);
  });

  test("spawnSync with gid option on Linux", () => {
    const currentGid = process.getgid!();

    const { exitCode, stdout } = Bun.spawnSync({
      cmd: [bunExe(), "-e", "console.log(process.getgid())"],
      env: bunEnv,
      stdout: "pipe",
      gid: currentGid,
    });

    expect(stdout.toString().trim()).toBe(currentGid.toString());
    expect(exitCode).toBe(0);
  });
});

describeLinux("child_process.spawn with uid/gid", () => {
  test("should spawn with uid option", done => {
    const currentUid = process.getuid!();

    const child = spawn(bunExe(), ["-e", "console.log(process.getuid())"], {
      env: bunEnv,
      uid: currentUid,
    });

    let stdout = "";
    child.stdout.on("data", data => {
      stdout += data.toString();
    });

    child.on("close", code => {
      expect(stdout.trim()).toBe(currentUid.toString());
      expect(code).toBe(0);
      done();
    });
  });

  test("should spawn with gid option", done => {
    const currentGid = process.getgid!();

    const child = spawn(bunExe(), ["-e", "console.log(process.getgid())"], {
      env: bunEnv,
      gid: currentGid,
    });

    let stdout = "";
    child.stdout.on("data", data => {
      stdout += data.toString();
    });

    child.on("close", code => {
      expect(stdout.trim()).toBe(currentGid.toString());
      expect(code).toBe(0);
      done();
    });
  });

  test("should spawn with both uid and gid options", done => {
    const currentUid = process.getuid!();
    const currentGid = process.getgid!();

    const child = spawn(bunExe(), ["-e", "console.log(process.getuid(), process.getgid())"], {
      env: bunEnv,
      uid: currentUid,
      gid: currentGid,
    });

    let stdout = "";
    child.stdout.on("data", data => {
      stdout += data.toString();
    });

    child.on("close", code => {
      expect(stdout.trim()).toBe(`${currentUid} ${currentGid}`);
      expect(code).toBe(0);
      done();
    });
  });

  test("spawnSync with uid option", () => {
    const currentUid = process.getuid!();

    const { status, stdout } = spawnSync(bunExe(), ["-e", "console.log(process.getuid())"], {
      env: bunEnv,
      uid: currentUid,
    });

    expect(stdout.toString().trim()).toBe(currentUid.toString());
    expect(status).toBe(0);
  });

  test("spawnSync with gid option", () => {
    const currentGid = process.getgid!();

    const { status, stdout } = spawnSync(bunExe(), ["-e", "console.log(process.getgid())"], {
      env: bunEnv,
      gid: currentGid,
    });

    expect(stdout.toString().trim()).toBe(currentGid.toString());
    expect(status).toBe(0);
  });

  test("spawnSync with both uid and gid options", () => {
    const currentUid = process.getuid!();
    const currentGid = process.getgid!();

    const { status, stdout } = spawnSync(bunExe(), ["-e", "console.log(process.getuid(), process.getgid())"], {
      env: bunEnv,
      uid: currentUid,
      gid: currentGid,
    });

    expect(stdout.toString().trim()).toBe(`${currentUid} ${currentGid}`);
    expect(status).toBe(0);
  });
});

describe("uid/gid error handling", () => {
  const itOnlyWindows = process.platform === "win32" ? test : test.skip;

  itOnlyWindows("should throw error on Windows for uid", () => {
    expect(() => {
      Bun.spawn({
        cmd: [bunExe(), "-e", "console.log('test')"],
        uid: 1000,
      });
    }).toThrow();
  });

  itOnlyWindows("should throw error on Windows for gid", () => {
    expect(() => {
      Bun.spawn({
        cmd: [bunExe(), "-e", "console.log('test')"],
        gid: 1000,
      });
    }).toThrow();
  });
});
