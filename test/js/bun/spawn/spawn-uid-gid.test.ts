import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMacOS } from "harness";

// uid/gid support is Linux-only due to macOS security restrictions
describe.if(isLinux)("Bun.spawn with uid and gid (Linux only)", () => {
  // This test can only run as root, as only root can change user/group
  test.if(process.getuid() === 0)("should spawn process with different uid and gid", async () => {
    // 'nobody' user usually has a high UID, a safe non-root user.
    // On macOS it's often -2 (65534), on Linux 65534.
    const nobodyUser = await Bun.spawn({ cmd: ["id", "-u", "nobody"] });
    const nobodyUid = parseInt(await new Response(nobodyUser.stdout).text());

    const nobodyGroup = await Bun.spawn({ cmd: ["id", "-g", "nobody"] });
    const nobodyGid = parseInt(await new Response(nobodyGroup.stdout).text());

    // Test with spawn (async)
    const procUid = Bun.spawn({
      cmd: [bunExe(), "-e", "console.write(String(process.getuid()))"],
      env: bunEnv,
      uid: nobodyUid,
    });
    const uidOutput = await new Response(procUid.stdout).text();
    expect(parseInt(uidOutput)).toBe(nobodyUid);
    expect(await procUid.exited).toBe(0);

    const procGid = Bun.spawn({
      cmd: [bunExe(), "-e", "console.write(String(process.getgid()))"],
      env: bunEnv,
      gid: nobodyGid,
    });
    const gidOutput = await new Response(procGid.stdout).text();
    expect(parseInt(gidOutput)).toBe(nobodyGid);
    expect(await procGid.exited).toBe(0);

    // Test with spawnSync
    const { stdout: syncUidOut } = Bun.spawnSync({
      cmd: [bunExe(), "-e", "console.write(String(process.getuid()))"],
      env: bunEnv,
      uid: nobodyUid,
    });
    expect(parseInt(syncUidOut.toString())).toBe(nobodyUid);
  });

  test("should fail with EPERM when not running as root", async () => {
    // Skip if running as root, as this test would pass.
    if (process.getuid() === 0) {
      return;
    }

    const targetUid = process.getuid() + 1; // Any other UID

    // Bun.spawn throws a system error on failure
    expect(() => {
      Bun.spawnSync({
        cmd: ["echo", "hello"],
        uid: targetUid,
      });
    }).toThrow("operation not permitted");
  });

  test("should throw for invalid uid/gid arguments", () => {
    expect(() => {
      Bun.spawnSync({ cmd: ["echo", "hello"], uid: "not-a-number" });
    }).toThrow('Invalid value for option "uid"');

    expect(() => {
      Bun.spawnSync({ cmd: ["echo", "hello"], gid: -1 });
    }).toThrow('Invalid value for option "gid"');
  });
});

// Test that uid/gid is silently ignored on macOS
describe.if(isMacOS)("Bun.spawn with uid and gid (macOS)", () => {
  test("should silently ignore uid/gid on macOS", async () => {
    const currentUid = process.getuid();
    const currentGid = process.getgid();

    // Test with spawn (async) - should ignore uid/gid and run as current user
    const procUid = Bun.spawn({
      cmd: [bunExe(), "-e", "console.write(String(process.getuid()))"],
      env: bunEnv,
      uid: 9999, // Some arbitrary uid that would fail if actually used
    });
    const uidOutput = await new Response(procUid.stdout).text();
    expect(parseInt(uidOutput)).toBe(currentUid);
    expect(await procUid.exited).toBe(0);

    // Test with spawnSync - should ignore gid and run as current group
    const { stdout: gidOut } = Bun.spawnSync({
      cmd: [bunExe(), "-e", "console.write(String(process.getgid()))"],
      env: bunEnv,
      gid: 9999, // Some arbitrary gid that would fail if actually used
    });
    expect(parseInt(gidOut.toString())).toBe(currentGid);
  });
});
