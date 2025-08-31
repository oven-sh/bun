import { spawn, spawnSync } from "child_process";
import { bunExe, isLinux, isMacOS } from "harness";

describe.if(isMacOS || isLinux)("uid/gid", () => {
  test("cannot spawn root process", async () => {
    expect(() => spawn("echo", ["test"], { uid: 0 })).toThrow(
      expect.objectContaining({
        code: "EPERM",
      }),
    );
  });

  test("cannot spawn root process (spawnSync)", async () => {
    const result = spawnSync("echo", ["test"], { uid: 0 });
    expect(result.error).toEqual(
      expect.objectContaining({
        code: "EPERM",
      }),
    );
  });

  test("can spawn user process with uid/gid", async () => {
    const child3 = Bun.spawn({
      cmd: [bunExe(), "-p", `JSON.stringify({uid: process.getuid?.(), gid: process.getgid?.()})`],
      uid: process.getuid?.(),
      gid: process.getgid?.(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    await child3.exited;
    const output = await child3.stdout.json();
    const stderr = await child3.stderr.text();
    expect(output).toEqual({
      uid: process.getuid?.(),
      gid: process.getgid?.(),
    });
    expect(stderr).toBe("");
    expect(child3.exitCode).toBe(0);
  });
});
