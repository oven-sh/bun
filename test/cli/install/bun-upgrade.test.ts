import { spawn, spawnSync } from "bun";
import { beforeEach, expect, it, setDefaultTimeout, beforeAll } from "bun:test";
import { bunExe, bunEnv as env, tls, tmpdirSync } from "harness";
import { join } from "path";
import { copyFileSync } from "js/node/fs/export-star-from";
import { upgrade_test_helpers } from "bun:internal-for-testing";
const { openTempDirWithoutSharingDelete, closeTempDirHandle } = upgrade_test_helpers;

let run_dir: string;
let exe_name: string = "bun-debug" + (process.platform === "win32" ? ".exe" : "");

beforeAll(() => {
  setDefaultTimeout(1000 * 60 * 5);
});

beforeEach(async () => {
  run_dir = tmpdirSync();
  copyFileSync(bunExe(), join(run_dir, exe_name));
});

it("two invalid arguments, should display error message and suggest command", async () => {
  const { stderr } = spawn({
    cmd: [join(run_dir, exe_name), "upgrade", "bun-types", "--dev"],
    cwd: run_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });

  const err = await new Response(stderr).text();
  expect(err.split(/\r?\n/)).toContain("error: This command updates Bun itself, and does not take package names.");
  expect(err.split(/\r?\n/)).toContain("note: Use `bun update bun-types --dev` instead.");
});

it("two invalid arguments flipped, should display error message and suggest command", async () => {
  const { stderr } = spawn({
    cmd: [join(run_dir, exe_name), "upgrade", "--dev", "bun-types"],
    cwd: run_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });

  const err = await new Response(stderr).text();
  expect(err.split(/\r?\n/)).toContain("error: This command updates Bun itself, and does not take package names.");
  expect(err.split(/\r?\n/)).toContain("note: Use `bun update --dev bun-types` instead.");
});

it("one invalid argument, should display error message and suggest command", async () => {
  const { stderr } = spawn({
    cmd: [join(run_dir, exe_name), "upgrade", "bun-types"],
    cwd: run_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });

  const err = await new Response(stderr).text();
  expect(err.split(/\r?\n/)).toContain("error: This command updates Bun itself, and does not take package names.");
  expect(err.split(/\r?\n/)).toContain("note: Use `bun update bun-types` instead.");
});

it("one valid argument, should succeed", async () => {
  const { stderr } = spawn({
    cmd: [join(run_dir, exe_name), "upgrade", "--help"],
    cwd: run_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });

  const err = await new Response(stderr).text();
  // Should not contain error message
  expect(err.split(/\r?\n/)).not.toContain("error: This command updates bun itself, and does not take package names.");
  expect(err.split(/\r?\n/)).not.toContain("note: Use `bun update --help` instead.");
});

it("two valid argument, should succeed", async () => {
  const { stderr } = spawn({
    cmd: [join(run_dir, exe_name), "upgrade", "--stable", "--profile"],
    cwd: run_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });

  const err = await new Response(stderr).text();
  // Should not contain error message
  expect(err.split(/\r?\n/)).not.toContain("error: This command updates Bun itself, and does not take package names.");
  expect(err.split(/\r?\n/)).not.toContain("note: Use `bun update --stable --profile` instead.");
});

it("zero arguments, should succeed", async () => {
  using server = Bun.serve({
    tls: tls,
    port: 0,
    async fetch() {
      return new Response(
        JSON.stringify({
          "tag_name": "bun-v1.1.4",
          "assets": [
            {
              "url": "foo",
              "content_type": "application/zip",
              "name": "bun-windows-x64.zip",
              "browser_download_url": `https://pub-5e11e972747a44bf9aaf9394f185a982.r2.dev/releases/latest/bun-windows-x64.zip`,
            },
            {
              "url": "foo",
              "content_type": "application/zip",
              "name": "bun-windows-x64-baseline.zip",
              "browser_download_url": `https://pub-5e11e972747a44bf9aaf9394f185a982.r2.dev/releases/latest/bun-windows-x64-baseline.zip`,
            },
            {
              "url": "foo",
              "content_type": "application/zip",
              "name": "bun-linux-x64.zip",
              "browser_download_url": `https://pub-5e11e972747a44bf9aaf9394f185a982.r2.dev/releases/latest/bun-linux-x64.zip`,
            },
            {
              "url": "foo",
              "content_type": "application/zip",
              "name": "bun-linux-x64-baseline.zip",
              "browser_download_url": `https://pub-5e11e972747a44bf9aaf9394f185a982.r2.dev/releases/latest/bun-linux-x64-baseline.zip`,
            },
            {
              "url": "foo",
              "content_type": "application/zip",
              "name": "bun-darwin-x64.zip",
              "browser_download_url": `https://pub-5e11e972747a44bf9aaf9394f185a982.r2.dev/releases/latest/bun-darwin-x64.zip`,
            },
            {
              "url": "foo",
              "content_type": "application/zip",
              "name": "bun-darwin-x64-baseline.zip",
              "browser_download_url": `https://pub-5e11e972747a44bf9aaf9394f185a982.r2.dev/releases/latest/bun-darwin-x64-baseline.zip`,
            },
            {
              "url": "foo",
              "content_type": "application/zip",
              "name": "bun-darwin-aarch64.zip",
              "browser_download_url": `https://pub-5e11e972747a44bf9aaf9394f185a982.r2.dev/releases/latest/bun-darwin-aarch64.zip`,
            },
          ],
        }),
      );
    },
  });

  // On windows, open the temporary directory without FILE_SHARE_DELETE before spawning
  // the upgrade process. This is to test for EBUSY errors
  openTempDirWithoutSharingDelete();

  const { stderr } = spawnSync({
    cmd: [join(run_dir, exe_name), "upgrade"],
    cwd: run_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env: {
      ...env,
      NODE_TLS_REJECT_UNAUTHORIZED: "0",
      GITHUB_API_DOMAIN: `localhost:${server.port}`,
    },
  });

  closeTempDirHandle();

  // Should not contain error message
  expect(stderr.toString()).not.toContain("error:");
});
