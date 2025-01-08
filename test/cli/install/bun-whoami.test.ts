import { test, expect, beforeAll, beforeEach, afterAll } from "bun:test";
import { join } from "path";
import { bunExe, bunEnv as env, VerdaccioRegistry } from "harness";
import { spawn, write } from "bun";

var verdaccio: VerdaccioRegistry;
var packageDir: string;
var packageJson: string;

beforeAll(async () => {
  verdaccio = new VerdaccioRegistry();
  await verdaccio.start();
});

afterAll(() => {
  verdaccio.stop();
});

beforeEach(async () => {
  ({ packageDir, packageJson } = await verdaccio.createTestDir());
  env.BUN_INSTALL_CACHE_DIR = join(packageDir, ".bun-cache");
  env.BUN_TMPDIR = env.TMPDIR = env.TEMP = join(packageDir, ".bun-tmp");
});

test("can get username", async () => {
  const bunfig = await verdaccio.authBunfig("whoami");
  await Promise.all([
    write(
      packageJson,
      JSON.stringify({
        name: "whoami-pkg",
        version: "1.1.1",
      }),
    ),
    write(join(packageDir, "bunfig.toml"), bunfig),
  ]);

  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "pm", "whoami"],
    cwd: packageDir,
    stdout: "pipe",
    stderr: "pipe",
    env,
  });

  const out = await Bun.readableStreamToText(stdout);
  expect(out).toBe("whoami\n");
  const err = await Bun.readableStreamToText(stderr);
  expect(err).not.toContain("error:");
  expect(await exited).toBe(0);
});
test("username from .npmrc", async () => {
  // It should report the username from npmrc, even without an account
  const bunfig = `
    [install]
    cache = false
    registry = "http://localhost:${verdaccio.port}/"`;
  const npmrc = `
    //localhost:${verdaccio.port}/:username=whoami-npmrc
    //localhost:${verdaccio.port}/:_password=123456
    `;
  await Promise.all([
    write(packageJson, JSON.stringify({ name: "whoami-pkg", version: "1.1.1" })),
    write(join(packageDir, "bunfig.toml"), bunfig),
    write(join(packageDir, ".npmrc"), npmrc),
  ]);

  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "pm", "whoami"],
    cwd: packageDir,
    stdout: "pipe",
    stderr: "pipe",
    env,
  });

  const out = await Bun.readableStreamToText(stdout);
  expect(out).toBe("whoami-npmrc\n");
  const err = await Bun.readableStreamToText(stderr);
  expect(err).not.toContain("error:");
  expect(await exited).toBe(0);
});
test("only .npmrc", async () => {
  const token = await verdaccio.generateUser("whoami-npmrc", "whoami-npmrc");
  const npmrc = `
    //localhost:${verdaccio.port}/:_authToken=${token}
    registry=http://localhost:${verdaccio.port}/`;
  await Promise.all([
    write(packageJson, JSON.stringify({ name: "whoami-pkg", version: "1.1.1" })),
    write(join(packageDir, ".npmrc"), npmrc),
  ]);
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "pm", "whoami"],
    cwd: packageDir,
    stdout: "pipe",
    stderr: "pipe",
    env,
  });
  const out = await Bun.readableStreamToText(stdout);
  expect(out).toBe("whoami-npmrc\n");
  const err = await Bun.readableStreamToText(stderr);
  expect(err).not.toContain("error:");
  expect(await exited).toBe(0);
});
test("two .npmrc", async () => {
  const token = await verdaccio.generateUser("whoami-two-npmrc", "whoami-two-npmrc");
  const packageNpmrc = `registry=http://localhost:${verdaccio.port}/`;
  const homeNpmrc = `//localhost:${verdaccio.port}/:_authToken=${token}`;
  const homeDir = `${packageDir}/home_dir`;
  await Bun.$`mkdir -p ${homeDir}`;
  await Promise.all([
    write(packageJson, JSON.stringify({ name: "whoami-pkg", version: "1.1.1" })),
    write(join(packageDir, ".npmrc"), packageNpmrc),
    write(join(homeDir, ".npmrc"), homeNpmrc),
  ]);
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "pm", "whoami"],
    cwd: packageDir,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...env,
      XDG_CONFIG_HOME: `${homeDir}`,
    },
  });
  const out = await Bun.readableStreamToText(stdout);
  expect(out).toBe("whoami-two-npmrc\n");
  const err = await Bun.readableStreamToText(stderr);
  expect(err).not.toContain("error:");
  expect(await exited).toBe(0);
});
test("not logged in", async () => {
  await write(packageJson, JSON.stringify({ name: "whoami-pkg", version: "1.1.1" }));
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "pm", "whoami"],
    cwd: packageDir,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await Bun.readableStreamToText(stdout);
  expect(out).toBeEmpty();
  const err = await Bun.readableStreamToText(stderr);
  expect(err).toBe("error: missing authentication (run `bunx npm login`)\n");
  expect(await exited).toBe(1);
});
test("invalid token", async () => {
  // create the user and provide an invalid token
  const token = await verdaccio.generateUser("invalid-token", "invalid-token");
  const bunfig = `
    [install]
    cache = false
    registry = { url = "http://localhost:${verdaccio.port}/", token = "1234567" }`;
  await Promise.all([
    write(packageJson, JSON.stringify({ name: "whoami-pkg", version: "1.1.1" })),
    write(join(packageDir, "bunfig.toml"), bunfig),
  ]);
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "pm", "whoami"],
    cwd: packageDir,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await Bun.readableStreamToText(stdout);
  expect(out).toBeEmpty();
  const err = await Bun.readableStreamToText(stderr);
  expect(err).toBe(`error: failed to authenticate with registry 'http://localhost:${verdaccio.port}/'\n`);
  expect(await exited).toBe(1);
});
