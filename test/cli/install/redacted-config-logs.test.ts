import { write } from "bun";
import { iniInternals } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir, tmpdirSync } from "harness";
import { join } from "path";

test("registry url password is sent as Basic auth and left out of request error output", async () => {
  const authorizations: (string | null)[] = [];
  await using server = Bun.serve({
    port: 0,
    fetch(req) {
      authorizations.push(req.headers.get("authorization"));
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    },
  });

  using dir = tempDir("redacted-registry-url", {
    "package.json": JSON.stringify({ name: "foo", version: "1.0.0" }),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "pm", "view", "is-number"],
    cwd: String(dir),
    env: {
      ...bunEnv,
      NO_COLOR: "1",
      npm_config_registry: `http://user:secretpass@${server.hostname}:${server.port}/`,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(authorizations).toEqual([`Basic ${Buffer.from("user:secretpass").toString("base64")}`]);
  expect(err).toContain(`401 Unauthorized: http://${server.hostname}:${server.port}/is-number`);
  expect(err).not.toContain("secretpass");
  expect(out).not.toContain("secretpass");
  expect(exitCode).toBe(1);
});

test("url password is masked in the verbose request line", async () => {
  await using server = Bun.serve({
    port: 0,
    fetch() {
      return new Response("ok");
    },
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `await fetch("http://user:secretpass@${server.hostname}:${server.port}/pkg")`],
    env: { ...bunEnv, NO_COLOR: "1", BUN_CONFIG_VERBOSE_FETCH: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(err).toContain(`GET http://user:**********@${server.hostname}:${server.port}/pkg`);
  expect(err).not.toContain("secretpass");
  expect(out).not.toContain("secretpass");
  expect(exitCode).toBe(0);
});

test("registry port is not mistaken for a credential when the package is scoped", async () => {
  await using server = Bun.serve({
    port: 0,
    fetch() {
      return new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    },
  });

  using dir = tempDir("redacted-registry-scoped-port", {
    "package.json": JSON.stringify({ name: "foo", version: "1.0.0" }),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "pm", "view", "@scope/pkg"],
    cwd: String(dir),
    env: {
      ...bunEnv,
      NO_COLOR: "1",
      npm_config_registry: `http://${server.hostname}:${server.port}/`,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(err).toContain(`http://${server.hostname}:${server.port}/`);
  expect(err).not.toContain("*");
  expect(out).not.toContain("*");
  expect(exitCode).toBe(1);
});

test("bunfig password value is masked in config error output", async () => {
  using dir = tempDir("redacted-bunfig-password", {
    "bunfig.toml": `l;password = "supersecretvalue"`,
    "package.json": "{}",
  });

  await using plain = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: String(dir),
    env: { ...bunEnv, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [plainOut, plainErr, plainExit] = await Promise.all([plain.stdout.text(), plain.stderr.text(), plain.exited]);

  expect(plainOut).not.toContain("supersecretvalue");
  expect(plainErr).not.toContain("supersecretvalue");
  expect(plainErr).toContain(`l;password = "****************"`);

  await using colored = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: String(dir),
    env: { ...bunEnv, NO_COLOR: undefined, FORCE_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [coloredOut, coloredErr, coloredExit] = await Promise.all([
    colored.stdout.text(),
    colored.stderr.text(),
    colored.exited,
  ]);

  expect(coloredOut).not.toContain("supersecretvalue");
  expect(coloredErr).not.toContain("supersecretvalue");
  expect(coloredErr).toContain("****************");

  expect(plainExit).toBe(1);
  expect(coloredExit).toBe(1);
});

describe.concurrent("redact", async () => {
  const tests = [
    {
      title: "url password",
      bunfig: `install.registry = "https://user:pass@registry.org`,
      expected: `"https://user:****@registry.org`,
    },
    {
      // A userinfo password that happens to start with a redacted keyword must not
      // arm value redaction for the rest of the line; the quoted-key scan runs only
      // on the fall-through path after the URL/UUID/npm-secret redactors.
      title: "url password starting with a redacted keyword",
      bunfig: `install.scopes.x = { url = "https://user:token123@registry.org/", username = "alice" };bad`,
      expected: `, username = `,
      secret: "token123",
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
      title: "registry password",
      bunfig: `l;password = "hunter2"`,
      expected: `"*******"`,
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
      // The unknown-option warning names the option but never echoes the line, so no
      // value can leak whatever the key's spelling: quoted, misspelt, or without the
      // underscore. These rows pin that the warning prints and the value does not.
      title: "quoted _authToken key",
      npmrc: '"//registry.npmjs.org/:_authtoken"=npm_notarealtokenvalue',
      expected: "is not a known .npmrc option",
      secret: "npm_notarealtokenvalue",
    },
    {
      title: "quoted _auth key",
      npmrc: 'registry=https://registry.example.com/api/\n"//registry.example.com/:_auth_"=does-not-decode',
      expected: "is not a known .npmrc option",
      secret: "does-not-decode",
    },
    {
      title: "quoted password key",
      npmrc: '"//registry.npmjs.org/:password"=SUPERSECRETVALUE',
      expected: "is not a known .npmrc option",
      secret: "SUPERSECRETVALUE",
    },
    {
      title: "misspelt option without the underscore",
      npmrc: "//registry.npmjs.org/:authToken=npm_notarealtokenvalue",
      expected: "is not a known .npmrc option",
      secret: "npm_notarealtokenvalue",
    },
    {
      title: "misspelt _authToken key",
      npmrc: "//registry.npmjs.org/:_authtoken=npm_notarealtokenvalue",
      expected: "is not a known .npmrc option",
      secret: "npm_notarealtokenvalue",
    },
    // Lines that are not `//host/…:option=value` never reach the unknown-option
    // warning, since the word after the last colon could be the value itself.
    {
      title: "credential key without an equals sign",
      npmrc: "//registry.npmjs.org/:_authToken",
      expected: "",
      secret: "_authToken",
    },
    {
      title: "credential key with a colon instead of an equals sign",
      npmrc: "//registry.npmjs.org/:_authToken:npm_notarealtokenvalue",
      expected: "",
      secret: "npm_notarealtokenvalue",
    },
    {
      title: "bare host and port",
      npmrc: "//localhost:4873",
      expected: "",
      secret: "4873",
    },
    {
      title: "bare bracketed IPv6 host",
      npmrc: "//[::1]",
      expected: "",
      secret: "::1",
    },
    {
      // `:` typed for `=`: the parser splits at the base64 padding, so the credential
      // bytes sit where an option name would; the warning must not name them.
      title: "credential key with a colon and a padded base64 value",
      npmrc: "//registry.npmjs.org/:_auth:dXNlcjpwdw==",
      expected: "",
      secret: "dXNlcjpwdw",
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
      // An empty home, so the machine's own `.npmrc` cannot add a warning or an error.
      const home = join(testDir, "home");
      await Promise.all([
        write(join(testDir, bunfig ? "bunfig.toml" : ".npmrc"), (bunfig || npmrc)!),
        write(join(testDir, "package.json"), "{}"),
        write(join(home, ".gitkeep"), ""),
      ]);
      const isolated = { HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: home };

      // once without color
      await using proc1 = Bun.spawn({
        cmd: [bunExe(), "install"],
        cwd: testDir,
        env: { ...bunEnv, NO_COLOR: "1", ...isolated },
        stdout: "pipe",
        stderr: "pipe",
      });

      const [out1, err1, exitCode1] = await Promise.all([proc1.stdout.text(), proc1.stderr.text(), proc1.exited]);

      expect(exitCode1).toBe(+!!bunfig);
      if (expected) expect(err1).toContain(expected);
      else expect(err1).not.toMatch(/\b(error|warn):/);
      if (secret) expect(err1).not.toContain(secret);
      if (forbidden) expect(err1).not.toContain(forbidden);

      // once with color
      await using proc2 = Bun.spawn({
        cmd: [bunExe(), "install"],
        cwd: testDir,
        env: { ...bunEnv, NO_COLOR: undefined, FORCE_COLOR: "1", ...isolated },
        stdout: "pipe",
        stderr: "pipe",
      });

      const [out2, err2, exitCode2] = await Promise.all([proc2.stdout.text(), proc2.stderr.text(), proc2.exited]);

      expect(exitCode2).toBe(+!!bunfig);
      if (expected) expect(err2).toContain(expected);
      else expect(err2).not.toMatch(/\b(error|warn):/);
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
