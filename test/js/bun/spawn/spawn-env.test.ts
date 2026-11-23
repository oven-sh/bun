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

describe.concurrent.skipIf(!isWindows)("Windows environment block", () => {
  const files = {
    // process.env folds case and is unordered, so the child prints the raw block.
    "print-env-block.js": `
      const { dlopen, read } = require("bun:ffi");
      let address = dlopen("kernel32.dll", { GetEnvironmentStringsW: { args: [], returns: "ptr" } }).symbols.GetEnvironmentStringsW();
      const entries = [];
      for (let entry = ""; ; address += 2) {
        const codeUnit = read.u16(address, 0);
        if (codeUnit) entry += String.fromCharCode(codeUnit);
        else if (entry) {
          entries.push(entry);
          entry = "";
        } else break;
      }
      console.log(JSON.stringify(entries));
    `,
    "parent.js": `
      const { api, env, setup } = JSON.parse(process.argv[2]);
      eval(setup);
      const options = { env: { ...env, BUN_DEBUG_QUIET_LOGS: "1" }, stdio: ["ignore", "inherit", "inherit"] };
      if (api === "Bun.spawn") Bun.spawn([process.execPath, "print-env-block.js"], options);
      if (api === "Bun.spawnSync") Bun.spawnSync([process.execPath, "print-env-block.js"], options);
      if (api === "child_process") require("child_process").spawn(process.execPath, ["print-env-block.js"], options);
    `,
  };
  const parentEnv = {
    HOMEDRIVE: "Q:",
    HOMEPATH: "\\parent home",
    LOGONSERVER: "\\\\parent-logon",
    USERDOMAIN: "parent-domain",
    USERNAME: "parent-\u00fcser",
    NOT_REQUIRED: "parent",
  };
  async function readEnvBlock(api: string, env: Record<string, string>, setup = ""): Promise<string[]> {
    using dir = tempDir("spawn-env-block", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "parent.js", JSON.stringify({ api, env, setup })],
      env: { ...bunEnv, ...parentEnv },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    return JSON.parse(stdout);
  }
  const findValues = (entries: string[], name: string) =>
    entries.filter(entry => entry.toUpperCase().startsWith(name + "=")).map(entry => entry.slice(name.length + 1));
  const pick = (entries: string[], names: string[]) =>
    Object.fromEntries(names.map(name => [name, findValues(entries, name)]));
  const findBunEnvValues = (name: string) => [Object.entries(bunEnv).find(([key]) => key.toUpperCase() === name)![1]];

  describe.each(["Bun.spawn", "Bun.spawnSync", "child_process"])("%s", api => {
    test("inherits only the required variables from the parent", async () => {
      const inheritedNames = ["PATH", "SYSTEMDRIVE", "TEMP", "USERPROFILE", "WINDIR"];
      const entries = await readEnvBlock(api, { ONLY: "1" });
      expect(pick(entries, [...Object.keys(parentEnv), ...inheritedNames, "ONLY"])).toEqual({
        ...Object.fromEntries(Object.entries(parentEnv).map(([name, value]) => [name, [value]])),
        ...Object.fromEntries(inheritedNames.map(name => [name, findBunEnvValues(name)])),
        NOT_REQUIRED: [],
        ONLY: ["1"],
      });
      expect(findValues(entries, "SYSTEMROOT").map(value => value.toLowerCase())).toEqual([
        findBunEnvValues("SYSTEMROOT")[0]!.toLowerCase(),
      ]);
    });

    test("keeps a required variable set by the caller, even if empty or differently cased", async () => {
      const entries = await readEnvBlock(api, { username: "mine", HomeDrive: "", LOGONSERVER: "a=b" });
      expect(pick(entries, ["USERNAME", "HOMEDRIVE", "LOGONSERVER", "USERDOMAIN"])).toEqual({
        USERNAME: ["mine"],
        HOMEDRIVE: [""],
        LOGONSERVER: ["a=b"],
        USERDOMAIN: ["parent-domain"],
      });
    });

    test("matches required variables by full name, not by prefix or suffix", async () => {
      const entries = await readEnvBlock(api, {
        USERNAM: "1",
        USERNAMES: "2",
        HOME: "3",
        XHOMEDRIVE: "4",
        LOGONSERVER_: "5",
      });
      expect(pick(entries, ["USERNAME", "HOMEDRIVE", "HOMEPATH", "LOGONSERVER", "USERNAM", "USERNAMES"])).toEqual({
        USERNAME: [parentEnv.USERNAME],
        HOMEDRIVE: [parentEnv.HOMEDRIVE],
        HOMEPATH: [parentEnv.HOMEPATH],
        LOGONSERVER: [parentEnv.LOGONSERVER],
        USERNAM: ["1"],
        USERNAMES: ["2"],
      });
    });

    test("is sorted by upper-cased UTF-16 code unit", async () => {
      const sortedNames = ["ZZ", "ZZ0", "zza", "ZZB", "zzz", "ZZ_", "ZZ\u00e9", "ZZ\u{1F600}", "ZZ\uff61"];
      const entries = await readEnvBlock(api, Object.fromEntries(sortedNames.toReversed().map(name => [name, "v"])));
      expect(entries.filter(entry => /^zz/i.test(entry))).toEqual(sortedNames.map(name => name + "=v"));
    });

    test("stays sorted after the required variables are added", async () => {
      const entries = await readEnvBlock(api, { A: "", HOMEE: "", LOGONSERVERS: "", U: "", USERM: "", ZZ: "" });
      const expectedNames = [
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
      expect(
        entries.map(entry => entry.split("=")[0].toUpperCase()).filter(name => expectedNames.includes(name)),
      ).toEqual(expectedNames);
    });

    test("passes values through unchanged", async () => {
      const values = {
        V_EQUALS: "=a=b=",
        V_LINES: "a\r\nb\n",
        V_QUOTES: `"'%PATH%^&`,
        V_SPACES: "  a  ",
        V_TEXT: "\u00e9\u4e16\u{1F600}",
      };
      expect(pick(await readEnvBlock(api, values), Object.keys(values))).toEqual(
        Object.fromEntries(Object.entries(values).map(([name, value]) => [name, [value]])),
      );
    });
  });

  test("omits a required variable that the parent does not have", async () => {
    const entries = await readEnvBlock("Bun.spawn", {}, "delete process.env.LOGONSERVER");
    expect(pick(entries, ["LOGONSERVER", "USERDOMAIN"])).toEqual({ LOGONSERVER: [], USERDOMAIN: ["parent-domain"] });
  });

  test("inherits the value process.env has at spawn time", async () => {
    const entries = await readEnvBlock("Bun.spawn", {}, "process.env.userdomain = 'changed'");
    expect(findValues(entries, "USERDOMAIN")).toEqual(["changed"]);
  });

  test("child_process keeps the lexicographically first of names that differ only in case", async () => {
    const entries = await readEnvBlock("child_process", { dup: "lower", DUP: "upper", Dup: "mixed" });
    expect(entries.filter(entry => /^dup=/i.test(entry))).toEqual(["DUP=upper"]);
  });

  test("passes per-drive cwd entries (=Q:) and sorts them first", async () => {
    const entries = await readEnvBlock("Bun.spawn", { A: "1", "=Q:": "Q:\\somewhere" });
    expect(entries.filter(entry => /^(=Q:|A)=/.test(entry))).toEqual(["=Q:=Q:\\somewhere", "A=1"]);
  });

  test("can be larger than 32767 characters", async () => {
    const entries = await readEnvBlock(
      "Bun.spawn",
      {},
      "for (let i = 0; i < 8; i++) env['BIG' + i] = Buffer.alloc(20000, String(i)).toString()",
    );
    expect(entries.filter(entry => entry.startsWith("BIG")).map(entry => entry.slice(0, 7) + entry.length)).toEqual(
      Array.from({ length: 8 }, (_, i) => `BIG${i}=${i}${i}20005`),
    );
  });
});
