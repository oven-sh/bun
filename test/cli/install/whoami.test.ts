import { spawn, write } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rm } from "fs/promises";
import { VerdaccioRegistry, bunExe, bunEnv as env } from "harness";
import { join } from "path";

let registry = new VerdaccioRegistry();

beforeAll(async () => {
  await registry.start();
});

afterAll(() => {
  registry.stop();
});

describe("whoami", async () => {
  test("can get username", async () => {
    const { packageJson, packageDir } = await registry.createTestDir();
    const bunfig = await registry.authBunfig("whoami");
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
    const { packageJson, packageDir } = await registry.createTestDir();
    // It should report the username from npmrc, even without an account
    const bunfig = `
    [install]
    cache = false
    registry = "http://localhost:${registry.port}/"`;
    const npmrc = `
    //localhost:${registry.port}/:username=whoami-npmrc
    //localhost:${registry.port}/:_password=123456
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
    const { packageJson, packageDir } = await registry.createTestDir();
    const token = await registry.generateUser("whoami-npmrc", "whoami-npmrc");
    const npmrc = `
    //localhost:${registry.port}/:_authToken=${token}
    registry=http://localhost:${registry.port}/`;
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
    const { packageJson, packageDir } = await registry.createTestDir();
    const token = await registry.generateUser("whoami-two-npmrc", "whoami-two-npmrc");
    const packageNpmrc = `registry=http://localhost:${registry.port}/`;
    const homeNpmrc = `//localhost:${registry.port}/:_authToken=${token}`;
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
    const { packageJson, packageDir } = await registry.createTestDir();
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
    const { packageJson, packageDir } = await registry.createTestDir();
    // create the user and provide an invalid token
    const token = await registry.generateUser("invalid-token", "invalid-token");
    const bunfig = `
    [install]
    cache = false
    registry = { url = "http://localhost:${registry.port}/", token = "1234567" }`;
    await rm(join(packageDir, "bunfig.toml"));
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
    expect(err).toBe(`error: failed to authenticate with registry 'http://localhost:${registry.port}/'\n`);
    expect(await exited).toBe(1);
  });
});
