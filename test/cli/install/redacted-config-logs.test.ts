import { write } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tmpdirSync } from "harness";
import { join } from "path";

describe.concurrent("redact", async () => {
  const tests = [
    {
      title: "url password",
      bunfig: `install.registry = "https://user:pass@registry.org`,
      expected: `"https://user:****@registry.org`,
    },
    {
      title: "empty url password",
      bunfig: `install.registry = "https://user:@registry.org`,
      expected: `"https://user:@registry.org`,
    },
    {
      title: "small string",
      bunfig: `l;token = "1"`,
      expected: `"*"`,
    },
    {
      title: "random UUID",
      bunfig: 'unre;lated = "f1b0b6b4-4b1b-4b1b-8b1b-4b1b4b1b4b1b"',
      expected: '"************************************"',
    },
    {
      title: "random npm_ secret",
      bunfig: 'the;secret = "npm_1234567890abcdefghijklmnopqrstuvwxyz"',
      expected: '"****************************************"',
    },
    {
      title: "random npms_ secret",
      bunfig: 'the;secret = "npms_1234567890abcdefghijklmnopqrstuvwxyz"',
      expected: "*****************************************",
    },
    {
      title: "zero length unterminated string",
      bunfig: '_authToken = "',
      expected: "*",
    },
    {
      title: "invalid _auth",
      npmrc: "//registry.npmjs.org/:_auth = does-not-decode",
      expected: "****************",
    },
    {
      title: "unexpected _auth",
      npmrc: "//registry.npmjs.org/:_auth=:secret",
      expected: "*******",
    },
    {
      title: "_auth zero length",
      npmrc: "//registry.npmjs.org/:_auth=",
      expected: "received an empty string",
    },
    {
      title: "_auth one length",
      npmrc: "//registry.npmjs.org/:_auth=1",
      expected: "*",
    },
  ];

  for (const { title, bunfig, npmrc, expected } of tests) {
    test(title + (bunfig ? " (bunfig)" : " (npmrc)"), async () => {
      const testDir = tmpdirSync();
      await Promise.all([
        write(join(testDir, bunfig ? "bunfig.toml" : ".npmrc"), (bunfig || npmrc)!),
        write(join(testDir, "package.json"), "{}"),
      ]);

      // once without color
      await using proc1 = Bun.spawn({
        cmd: [bunExe(), "install"],
        cwd: testDir,
        env: { ...bunEnv, NO_COLOR: "1" },
        stdout: "pipe",
        stderr: "pipe",
      });

      const [out1, err1, exitCode1] = await Promise.all([proc1.stdout.text(), proc1.stderr.text(), proc1.exited]);

      expect(exitCode1).toBe(+!!bunfig);
      expect(err1).toContain(expected || "*");

      // once with color
      await using proc2 = Bun.spawn({
        cmd: [bunExe(), "install"],
        cwd: testDir,
        env: { ...bunEnv, NO_COLOR: undefined, FORCE_COLOR: "1" },
        stdout: "pipe",
        stderr: "pipe",
      });

      const [out2, err2, exitCode2] = await Promise.all([proc2.stdout.text(), proc2.stderr.text(), proc2.exited]);

      expect(exitCode2).toBe(+!!bunfig);
      expect(err2).toContain(expected || "*");
    });
  }
});
