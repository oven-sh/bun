import { spawn, spawnSync } from "bun";
import { beforeEach, describe, expect, it } from "bun:test";
import { exists, stat } from "fs/promises";
import { bunExe, bunEnv as env, tmpdirSync } from "harness";
import { join } from "path";

let x_dir: string;

let testNumber = 0;
beforeEach(async () => {
  x_dir = tmpdirSync(`cr8-${testNumber++}`);
});

describe("should not crash", async () => {
  const args = [
    [bunExe(), "create"],
    [bunExe(), "create", ""],
    [bunExe(), "create", "--"],
    [bunExe(), "create", "--", ""],
    [bunExe(), "create", "--help"],
  ];
  for (let cmd of args) {
    it(JSON.stringify(cmd.slice(1)), () => {
      const { exitCode } = spawnSync({
        cmd,
        cwd: x_dir,
        stdout: "ignore",
        stdin: "inherit",
        stderr: "inherit",
        env,
      });
      expect(exitCode).toBe(cmd.length === 2 ? 1 : 0);
    });
  }
});

it("should create selected template with @ prefix", async () => {
  const { stderr, exited } = spawn({
    cmd: [bunExe(), "create", "@quick-start/some-template"],
    cwd: x_dir,
    stdout: "inherit",
    stdin: "inherit",
    stderr: "pipe",
    env,
  });

  await exited;

  const err = await stderr.text();
  expect(err.split(/\r?\n/)).toContain(
    `error: GET https://registry.npmjs.org/@quick-start%2fcreate-some-template - 404`,
  );
});

it("should create selected template with @ prefix implicit `/create`", async () => {
  const { stderr, exited } = spawn({
    cmd: [bunExe(), "create", "@second-quick-start"],
    cwd: x_dir,
    stdout: "inherit",
    stdin: "inherit",
    stderr: "pipe",
    env,
  });

  const err = await stderr.text();
  expect(err.split(/\r?\n/)).toContain(`error: GET https://registry.npmjs.org/@second-quick-start%2fcreate - 404`);
  await exited;
});

it("should create selected template with @ prefix implicit `/create` with version", async () => {
  const { stderr, exited } = spawn({
    cmd: [bunExe(), "create", "@second-quick-start"],
    cwd: x_dir,
    stdout: "inherit",
    stdin: "inherit",
    stderr: "pipe",
    env,
  });

  const err = await stderr.text();
  expect(err.split(/\r?\n/)).toContain(`error: GET https://registry.npmjs.org/@second-quick-start%2fcreate - 404`);

  await exited;
});

it("should create template from local folder", async () => {
  const bunCreateDir = join(x_dir, "bun-create");
  const testTemplate = "test-template";

  await Bun.write(join(bunCreateDir, testTemplate, "index.js"), "hi");
  await Bun.write(join(bunCreateDir, testTemplate, "foo", "bar.js"), "hi");

  const { exited } = spawn({
    cmd: [bunExe(), "create", testTemplate],
    cwd: x_dir,
    stdout: "inherit",
    stdin: "inherit",
    stderr: "inherit",
    env: { ...env, BUN_CREATE_DIR: bunCreateDir },
  });

  expect(await exited).toBe(0);

  const dirStat = await stat(join(x_dir, testTemplate));
  expect(dirStat.isDirectory()).toBe(true);
  expect(await Bun.file(join(x_dir, testTemplate, "index.js")).text()).toBe("hi");
  expect(await Bun.file(join(x_dir, testTemplate, "foo", "bar.js")).text()).toBe("hi");
});

it("should not mention cd prompt when created in current directory", async () => {
  const { stdout, exited } = spawn({
    cmd: [bunExe(), "create", "https://github.com/dylan-conway/create-test", "."],
    cwd: x_dir,
    stdout: "pipe",
    stdin: "inherit",
    stderr: "inherit",
    env,
  });

  await exited;

  const out = await stdout.text();

  expect(out).toContain("bun dev");
  expect(out).not.toContain("\n\n  cd \n  bun dev\n\n");
}, 20_000);

for (const repo of ["https://github.com/dylan-conway/create-test", "github.com/dylan-conway/create-test"]) {
  it(`should create and install github template from ${repo}`, async () => {
    const { stderr, stdout, exited } = spawn({
      cmd: [bunExe(), "create", repo],
      cwd: x_dir,
      stdout: "pipe",
      stderr: "pipe",
      env,
    });

    const err = await stderr.text();
    expect(err).not.toContain("error:");
    const out = await stdout.text();
    expect(out).toContain("Success! dylan-conway/create-test loaded into create-test");
    expect(await exists(join(x_dir, "create-test", "node_modules", "jquery"))).toBe(true);

    expect(await exited).toBe(0);
  }, 20_000);
}

it("should not crash with --no-install and bun-create.postinstall starting with 'bun '", async () => {
  const bunCreateDir = join(x_dir, "bun-create");
  const testTemplate = "postinstall-test";

  await Bun.write(
    join(bunCreateDir, testTemplate, "package.json"),
    JSON.stringify({
      name: "test",
      "bun-create": {
        postinstall: "bun install",
      },
    }),
  );

  const { exited, stderr, stdout } = spawn({
    cmd: [bunExe(), "create", testTemplate, join(x_dir, "dest"), "--no-install"],
    cwd: x_dir,
    stdout: "pipe",
    stdin: "ignore",
    stderr: "pipe",
    env: { ...env, BUN_CREATE_DIR: bunCreateDir },
  });

  const [err, _out, exitCode] = await Promise.all([stderr.text(), stdout.text(), exited]);
  expect(err).not.toContain("error:");
  expect(exitCode).toBe(0);
});
