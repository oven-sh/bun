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

// `bun create <github-url>` hits https://api.github.com/repos/{owner}/{repo}/tarball.
// Unauthenticated GitHub API is limited to 60 req/hr per IP; CI agents running many
// parallel builds exhaust that quickly. When we detect the rate-limit error, skip the
// test rather than fail — we are testing `bun create`, not GitHub's availability.
function isGithubRateLimited(stderr: string): boolean {
  if (stderr.includes("GitHub returned 403")) {
    console.warn("Skipping: GitHub API rate limit reached (403). Set GITHUB_TOKEN to avoid this.");
    return true;
  }
  return false;
}

it("should not mention cd prompt when created in current directory", async () => {
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "create", "https://github.com/dylan-conway/create-test", "."],
    cwd: x_dir,
    stdout: "pipe",
    stdin: "inherit",
    stderr: "pipe",
    env,
  });

  const [out, err] = await Promise.all([stdout.text(), stderr.text(), exited]);
  if (isGithubRateLimited(err)) return;

  expect(err).not.toContain("error:");
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

    const [out, err, exitCode] = await Promise.all([stdout.text(), stderr.text(), exited]);
    if (isGithubRateLimited(err)) return;
    expect(err).not.toContain("error:");
    expect(out).toContain("Success! dylan-conway/create-test loaded into create-test");
    expect(await exists(join(x_dir, "create-test", "node_modules", "jquery"))).toBe(true);

    expect(exitCode).toBe(0);
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

// https://github.com/oven-sh/bun/issues/31149
// Scanner configured in the global bunfig must not block `bun create` —
// a scaffolded project has no way to list the scanner as a dependency,
// and the pre-fix child `bun install` would die with
// `SecurityScannerNotInDependencies`.
it("should not fail when install.security.scanner is set in global bunfig", async () => {
  const fakeHome = join(x_dir, "fake-home");
  const bunCreateDir = join(x_dir, "bun-create");
  const testTemplate = "scanner-test";

  await Bun.write(
    join(fakeHome, ".bunfig.toml"),
    `[install.security]\nscanner = "@socketsecurity/bun-security-scanner"\n`,
  );

  // Template with a trivial dependency so `bun install` is actually invoked
  // by `bun create` (skipped when there are no deps at all).
  await Bun.write(
    join(bunCreateDir, testTemplate, "package.json"),
    JSON.stringify({
      name: "scanner-template",
      version: "0.0.1",
      dependencies: { "is-number": "7.0.0" },
    }),
  );

  const destination = join(x_dir, "dest-scanner");
  const { exited, stderr, stdout } = spawn({
    cmd: [bunExe(), "create", testTemplate, destination, "--no-git"],
    cwd: x_dir,
    stdout: "pipe",
    stdin: "ignore",
    stderr: "pipe",
    // `env -i`-style isolation so the host's real `~/.bunfig.toml` can't
    // interfere. `HOME` is what bunfig loading looks at.
    env: {
      ...env,
      HOME: fakeHome,
      XDG_CONFIG_HOME: fakeHome,
      BUN_CREATE_DIR: bunCreateDir,
    },
  });

  const [err, out, exitCode] = await Promise.all([stderr.text(), stdout.text(), exited]);

  // The bug: pre-fix, `bun install` spawned by `bun create` errored with
  // `SecurityScannerNotInDependencies` before scaffolding completed. Post-fix
  // that specific error must not appear — the scanner is skipped for the
  // child install. Network/registry errors fetching `is-number` are fine;
  // we only care that the scanner did not trip.
  expect(out + err).not.toContain("SecurityScannerNotInDependencies");
  expect(out + err).not.toContain("is configured in bunfig.toml but is not installed");
  // Scaffolding should complete regardless of whether the dep resolved.
  expect(out).toContain(`Created ${testTemplate} project successfully`);
  expect(exitCode).toBe(0);
}, 20_000);
