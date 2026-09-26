import { spawn } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

test("spawn env", async () => {
  const env = {};
  Object.defineProperty(env, "LOL", {
    get() {
      throw new Error("Bad!!");
    },
    configurable: false,
    enumerable: true,
  });

  // This was the minimum to reliably cause a crash in Bun < v1.1.42
  for (let i = 0; i < 1024 * 10; i++) {
    try {
      const result = spawn({
        env,
        cmd: [bunExe(), "-e", "console.log(process.env.LOL)"],
      });
    } catch (e) {}
  }
});

// A Symbol key is not an environment variable name. It used to reach the
// child as a variable named by the symbol description.
test("spawn env skips Symbol keys", async () => {
  await using proc = spawn({
    cmd: [bunExe(), "-e", "console.log(JSON.stringify([process.env.SYMKEY ?? null, process.env.PLAIN]))"],
    env: { ...bunEnv, PLAIN: "1", [Symbol("SYMKEY")]: "leaked" },
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout).toBe('[null,"1"]\n');
  expect(exitCode).toBe(0);
});

// On Windows the child still gets the variables the system cannot do without
// (spawn copies them from this process) and the ones `cmd.exe` makes up.
test("spawn with an empty env passes nothing else on", async () => {
  const allowed = isWindows
    ? [
        ...["HOMEDRIVE", "HOMEPATH", "LOGONSERVER", "PATH", "SYSTEMDRIVE", "SYSTEMROOT"],
        ...["TEMP", "USERDOMAIN", "USERNAME", "USERPROFILE", "WINDIR"],
        ...["COMSPEC", "PATHEXT", "PROMPT"],
        // Windows on ARM64 adds this one.
        "PROCESSOR_ARCHITECTURE",
      ]
    : [];
  await using proc = spawn({
    cmd: isWindows ? [process.env.COMSPEC ?? "cmd.exe", "/d", "/c", "set"] : [Bun.which("env")!],
    env: {},
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  const names = stdout
    .split(/\r?\n/)
    .filter(line => line.includes("="))
    .map(line => line.slice(0, line.indexOf("=", 1)).toUpperCase());
  expect(names.filter(name => !allowed.includes(name))).toEqual([]);
  if (isWindows) expect(names).toContain("SYSTEMROOT");
  expect(exitCode).toBe(0);
});
