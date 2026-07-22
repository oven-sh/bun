import { write } from "bun";
import { iniInternals } from "bun:internal-for-testing";
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
      // npm forwards these verbatim, so there is no diagnostic to redact: the
      // assertion is that neither an error nor the value reaches stderr.
      title: "invalid _auth",
      npmrc: "//registry.npmjs.org/:_auth = does-not-decode",
      expected: "",
      secret: "does-not-decode",
    },
    {
      title: "unexpected _auth",
      npmrc: "//registry.npmjs.org/:_auth=:secret",
      expected: "",
      secret: ":secret",
    },
    {
      title: "_auth zero length",
      npmrc: "//registry.npmjs.org/:_auth=",
      expected: "supplies no credentials",
    },
    {
      title: "_auth one length",
      npmrc: "//registry.npmjs.org/:_auth=1",
      expected: "",
    },
    {
      // A quoted key is a string literal, not an identifier, so it took a different
      // path through the highlighter and the value came out verbatim under color.
      // The uppercase host is what makes a diagnostic print this line at all.
      title: "quoted _authToken key",
      npmrc: '"//REGISTRY.NPMJS.ORG/:_authToken"=npm_notarealtokenvalue',
      expected: "*",
      secret: "npm_notarealtokenvalue",
    },
    {
      title: "quoted _auth key",
      npmrc: 'registry=https://Registry.Example.COM/api/\n"//Registry.Example.COM/:_auth"=does-not-decode',
      expected: "*",
      secret: "does-not-decode",
    },
    {
      // The most common .npmrc authoring mistake, and the value is always a live secret.
      // npm decodes _password with Buffer.from(v, "base64"), which never throws — it
      // skips invalid bytes — so there is no diagnostic and nothing may reach stderr.
      title: "plaintext _password",
      npmrc: "//registry.npmjs.org/:username=alice\n//registry.npmjs.org/:_password=p@ssw0rd!",
      expected: "",
      secret: "p@ssw0rd!",
      forbidden: "is not valid base64",
    },
  ];

  for (const { title, bunfig, npmrc, expected, secret, forbidden } of tests) {
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
      if (expected) expect(err1).toContain(expected);
      if (secret) expect(err1).not.toContain(secret);
      if (forbidden) expect(err1).not.toContain(forbidden);

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
      if (expected) expect(err2).toContain(expected);
      if (secret) expect(err2).not.toContain(secret);
      if (forbidden) expect(err2).not.toContain(forbidden);
    });
  }
});

// The retention half of the "plaintext _password" case above: Buffer.from(v, "base64")
// parity means an invalid-base64 _password is decoded leniently (invalid bytes skipped),
// not dropped — "aGVsbG8*!" must yield the same credential npm derives: "hello".
test("invalid base64 _password keeps the lenient-decoded credential", () => {
  const result = iniInternals.loadNpmrc(
    "registry=https://registry.npmjs.org/\n" +
      "//registry.npmjs.org/:username=alice\n" +
      "//registry.npmjs.org/:_password=aGVsbG8*!",
  );
  expect(result.default_registry_username).toBe("alice");
  expect(result.default_registry_password).toBe(Buffer.from("aGVsbG8*!", "base64").toString());
  expect(result.default_registry_password).toBe("hello");
});
