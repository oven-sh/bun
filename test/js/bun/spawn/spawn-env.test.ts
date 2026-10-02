import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
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

// Windows ignores case in a variable's name and gives a program the first one that matches, and
// there the variable is spelled `Path`. `cmd.exe` asks Windows; a Bun child would look for itself.
describe.skipIf(!isWindows).each(["spawn", "spawnSync"] as const)("%s: the last spelling of a name wins", api => {
  const cmdExe = process.env.COMSPEC ?? "C:\\Windows\\System32\\cmd.exe";
  async function stdoutOf(command: string, env: Record<string, string | undefined>) {
    const cmd = [cmdExe, "/d", "/c", command];
    if (api === "spawnSync") return Bun.spawnSync({ cmd, env, stderr: "inherit" }).stdout.toString();
    await using proc = spawn({ cmd, env, stdout: "pipe", stderr: "inherit" });
    return await proc.stdout.text();
  }

  test.each([
    [{ Bun_Spelling: "first", BUN_SPELLING: "last" }, "BUN_SPELLING=last"],
    [{ BUN_SPELLING: "first", bun_spelling: "last" }, "bun_spelling=last"],
    [{ bun_spelling: "first", A: "1", Bun_Spelling: "second", Z: "2", BUN_SPELLING: "last" }, "BUN_SPELLING=last"],
    [{ BUN_SPELLING: "first", bun_spelling: "" }, "bun_spelling="],
    [{ BUN_SPELLING: "only" }, "BUN_SPELLING=only"],
  ])("%j", async (env, expected) => {
    const lines = (await stdoutOf("set", env)).split(/\r?\n/);
    expect(lines.filter(line => /^bun_spelling=/i.test(line))).toEqual([expected]);
  });

  test("{ ...env, PATH } replaces Path", async () => {
    const { PATH, Path, ...rest } = bunEnv;
    const env = { ...rest, Path: PATH ?? Path, PATH: "C:\\replaced" };
    expect(await stdoutOf("echo %PATH%", env)).toBe("C:\\replaced\r\n");
  });

  // `set` prints the block in the block's order. Windows keeps it sorted by upper-cased name, where
  // `_` comes after the letters.
  test("the block is sorted the way Windows sorts it", async () => {
    const lines = (await stdoutOf("set", { bun_o_z: "1", BUN_OZ: "2", bun_ob: "3", BUN_OA: "4" })).split(/\r?\n/);
    expect(lines.filter(line => /^bun_o/i.test(line))).toEqual(["BUN_OA=4", "bun_ob=3", "BUN_OZ=2", "bun_o_z=1"]);
  });

  // A drive's current directory is a variable named after it, behind a `=`: each has an empty name.
  test("one hidden drive variable does not replace another", async () => {
    const env = { "=X:": "X:\\one", A: "1", "=Y:": "Y:\\other" };
    expect(await stdoutOf("echo [%=X:%] [%=Y:%] [%A%]", env)).toBe("[X:\\one] [Y:\\other] [1]\r\n");
  });

  test("a required variable is not added next to another spelling of it", async () => {
    const lines = (await stdoutOf("set", { SystemRoot: process.env.SYSTEMROOT })).split(/\r?\n/);
    expect(lines.filter(line => /^systemroot=/i.test(line))).toEqual(["SystemRoot=" + process.env.SYSTEMROOT]);
  });
});
