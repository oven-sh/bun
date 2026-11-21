import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

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

describe.concurrent.skipIf(!isWindows)("the environment block of a Windows child", () => {
  const files = {
    // process.env folds case and has no order, so the child prints the block as the system has it.
    "block.js": `
      const { dlopen, read } = require("bun:ffi");
      let at = dlopen("kernel32.dll", { GetEnvironmentStringsW: { args: [], returns: "ptr" } }).symbols.GetEnvironmentStringsW();
      const entries = [];
      for (let entry = ""; ; at += 2) {
        const unit = read.u16(at, 0);
        if (unit) entry += String.fromCharCode(unit);
        else if (entry) entries.push(entry), (entry = "");
        else break;
      }
      console.log(JSON.stringify(entries));
    `,
    "parent.js": `
      const { api, env, before } = JSON.parse(process.argv[2]);
      eval(before);
      const options = { env: { ...env, BUN_DEBUG_QUIET_LOGS: "1" }, stdio: ["ignore", "inherit", "inherit"] };
      if (api === "Bun.spawn") Bun.spawn([process.execPath, "block.js"], options);
      if (api === "Bun.spawnSync") Bun.spawnSync([process.execPath, "block.js"], options);
      if (api === "child_process") require("child_process").spawn(process.execPath, ["block.js"], options);
    `,
  };
  const inParent = {
    HOMEDRIVE: "Q:",
    HOMEPATH: "\\parent home",
    LOGONSERVER: "\\\\parent-logon",
    USERDOMAIN: "parent-domain",
    USERNAME: "parent-\u00fcser",
    NOT_REQUIRED: "parent",
  };
  async function block(api: string, env: Record<string, string>, before = ""): Promise<string[]> {
    using dir = tempDir("spawn-env-block", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "parent.js", JSON.stringify({ api, env, before })],
      env: { ...bunEnv, ...inParent },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    return JSON.parse(stdout);
  }
  const named = (entries: string[], name: string) =>
    entries.filter(entry => entry.toUpperCase().startsWith(name + "=")).map(entry => entry.slice(name.length + 1));
  const pick = (entries: string[], names: string[]) => Object.fromEntries(names.map(n => [n, named(entries, n)]));
  const parentValue = (name: string) => [Object.entries(bunEnv).find(([key]) => key.toUpperCase() === name)![1]];

  describe.each(["Bun.spawn", "Bun.spawnSync", "child_process"])("%s", api => {
    test("gets the variables that Windows needs from the parent, and no others", async () => {
      const inherited = ["PATH", "SYSTEMDRIVE", "TEMP", "USERPROFILE", "WINDIR"];
      const entries = await block(api, { ONLY: "1" });
      expect(pick(entries, [...Object.keys(inParent), ...inherited, "ONLY"])).toEqual({
        ...Object.fromEntries(Object.entries(inParent).map(([name, value]) => [name, [value]])),
        ...Object.fromEntries(inherited.map(name => [name, parentValue(name)])),
        NOT_REQUIRED: [],
        ONLY: ["1"],
      });
      expect(named(entries, "SYSTEMROOT").map(value => value.toLowerCase())).toEqual([
        parentValue("SYSTEMROOT")[0]!.toLowerCase(),
      ]);
    });

    test("keeps the caller's value of such a variable, in any case, empty or not", async () => {
      const entries = await block(api, { username: "mine", HomeDrive: "", LOGONSERVER: "a=b" });
      expect(pick(entries, ["USERNAME", "HOMEDRIVE", "LOGONSERVER", "USERDOMAIN"])).toEqual({
        USERNAME: ["mine"],
        HOMEDRIVE: [""],
        LOGONSERVER: ["a=b"],
        USERDOMAIN: ["parent-domain"],
      });
    });

    test("a name that only starts or ends alike does not stand for one", async () => {
      const entries = await block(api, { USERNAM: "1", USERNAMES: "2", HOME: "3", XHOMEDRIVE: "4", LOGONSERVER_: "5" });
      expect(pick(entries, ["USERNAME", "HOMEDRIVE", "HOMEPATH", "LOGONSERVER", "USERNAM", "USERNAMES"])).toEqual({
        USERNAME: [inParent.USERNAME],
        HOMEDRIVE: [inParent.HOMEDRIVE],
        HOMEPATH: [inParent.HOMEPATH],
        LOGONSERVER: [inParent.LOGONSERVER],
        USERNAM: ["1"],
        USERNAMES: ["2"],
      });
    });

    test("is sorted by upper-cased UTF-16 code unit", async () => {
      const sorted = ["ZZ", "ZZ0", "zza", "ZZB", "zzz", "ZZ_", "ZZ\u00e9", "ZZ\u{1F600}", "ZZ\uff61"];
      const entries = await block(api, Object.fromEntries(sorted.toReversed().map(name => [name, "v"])));
      expect(entries.filter(entry => /^zz/i.test(entry))).toEqual(sorted.map(name => name + "=v"));
    });

    test("is sorted with the added variables in their place", async () => {
      const entries = await block(api, { A: "", HOMEE: "", LOGONSERVERS: "", U: "", USERM: "", ZZ: "" });
      const watched = [
        "A",
        "HOMEDRIVE",
        "HOMEE",
        "HOMEPATH",
        "LOGONSERVER",
        "LOGONSERVERS",
        "U",
        "USERDOMAIN",
        "USERM",
        "USERNAME",
        "ZZ",
      ];
      expect(entries.map(entry => entry.split("=")[0].toUpperCase()).filter(n => watched.includes(n))).toEqual(watched);
    });

    test("carries values unchanged", async () => {
      const values = {
        V_EQUALS: "=a=b=",
        V_LINES: "a\r\nb\n",
        V_QUOTES: `"'%PATH%^&`,
        V_SPACES: "  a  ",
        V_TEXT: "\u00e9\u4e16\u{1F600}",
      };
      expect(pick(await block(api, values), Object.keys(values))).toEqual(
        Object.fromEntries(Object.entries(values).map(([name, value]) => [name, [value]])),
      );
    });
  });

  test("does not make up a variable that the parent lacks too", async () => {
    const entries = await block("Bun.spawn", {}, "delete process.env.LOGONSERVER");
    expect(pick(entries, ["LOGONSERVER", "USERDOMAIN"])).toEqual({ LOGONSERVER: [], USERDOMAIN: ["parent-domain"] });
  });

  test("takes what process.env holds at the time of the call", async () => {
    const entries = await block("Bun.spawn", {}, "process.env.userdomain = 'changed'");
    expect(named(entries, "USERDOMAIN")).toEqual(["changed"]);
  });

  test("child_process keeps the first of the names that differ in case", async () => {
    const entries = await block("child_process", { dup: "lower", DUP: "upper", Dup: "mixed" });
    expect(entries.filter(entry => /^dup=/i.test(entry))).toEqual(["DUP=upper"]);
  });

  test("passes the directory of a drive on, ahead of the other entries", async () => {
    const entries = await block("Bun.spawn", { A: "1", "=Q:": "Q:\\somewhere" });
    expect(entries.filter(entry => /^(=Q:|A)=/.test(entry))).toEqual(["=Q:=Q:\\somewhere", "A=1"]);
  });

  test("can be larger than 32767 characters", async () => {
    const entries = await block(
      "Bun.spawn",
      {},
      "for (let i = 0; i < 8; i++) env['BIG' + i] = Buffer.alloc(20000, String(i)).toString()",
    );
    expect(entries.filter(entry => entry.startsWith("BIG")).map(entry => entry.slice(0, 7) + entry.length)).toEqual(
      Array.from({ length: 8 }, (_, i) => `BIG${i}=${i}${i}20005`),
    );
  });
});
