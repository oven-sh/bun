import { spawn, spawnSync } from "bun";
import { upgrade_test_helpers } from "bun:internal-for-testing";
import { beforeAll, beforeEach, expect, it, setDefaultTimeout } from "bun:test";
import { bunEnv, bunExe, tls, tmpdirSync } from "harness";
import { copyFileSync } from "node:fs";
import { basename, join } from "path";
const { openTempDirWithoutSharingDelete, closeTempDirHandle } = upgrade_test_helpers;

let cwd: string;
let execPath: string;

beforeAll(() => {
  setDefaultTimeout(1000 * 60 * 5);
});

beforeEach(async () => {
  cwd = tmpdirSync();
  execPath = join(cwd, basename(bunExe()));
  copyFileSync(bunExe(), execPath);
});

// just a useless one to see that it bypassed the `bun upgrade <...>` -> `bun update <...>` check
using server = Bun.serve({
  tls: tls,
  port: 0,
  async fetch() {
    return Response.json({});
  },
});

const env = {
  ...bunEnv,
  NODE_TLS_REJECT_UNAUTHORIZED: "0",
  GITHUB_API_DOMAIN: `${server.hostname}:${server.port}`,
};

const invalid_tests = [
  [["upgrade", "bun-types", "--dev"], "bun update bun-types --dev"],
  [["upgrade", "bun-types"], "bun update bun-types"],
  [["upgrade", "--dev", "bun-types"], "bun update --dev bun-types"],
  [["upgrade", "--dev", "upgrade", "bun-types", "--stable"], "bun update bun-types --stable"],
  [["upgrade", "upgrade"], "bun update upgrade"],
  [["upgrade", "--latest"], "bun update --latest"],
];
for (const [args, expected] of invalid_tests) {
  it("two invalid arguments, should display error message and suggest command", async () => {
    const { stderr } = spawn({
      cmd: [execPath, ...args],
      cwd,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    const err = await new Response(stderr).text();
    expect(err.split(/\r?\n/)).toContain("error: This command updates Bun itself, and does not take package names.");
    expect(err.split(/\r?\n/)).toContain(`note: Use ${expected} instead.`);
  });
}

it("one flag with BUN_OPTIONS, should succeed", async () => {
  const { stderr } = spawn({
    cmd: [execPath, "upgrade"],
    cwd,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env: {
      ...env,
      BUN_OPTIONS: "--bun",
    },
  });

  const err = await new Response(stderr).text();
  // Should not contain error message
  expect(err.split(/\r?\n/)).not.toContain("error: This command updates Bun itself, and does not take package names.");
  expect(err.split(/\r?\n/)).not.toContain("note: Use `bun update` instead.");
});

it("one valid flag, should succeed", async () => {
  const { stderr } = spawn({
    cmd: [execPath, "upgrade", "--help"],
    cwd,
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
    cmd: [execPath, "upgrade", "--stable", "--profile"],
    cwd,
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
  const tagName = bunExe().includes("-debug") ? "canary" : `bun-v${Bun.version}`;
  using server = Bun.serve({
    tls: tls,
    port: 0,
    async fetch() {
      return new Response(
        JSON.stringify({
          "tag_name": tagName,
          "assets": [
            {
              "url": "foo",
              "content_type": "application/zip",
              "name": "bun-windows-x64.zip",
              "browser_download_url": `https://pub-5e11e972747a44bf9aaf9394f185a982.r2.dev/releases/${tagName}/bun-windows-x64.zip`,
            },
            {
              "url": "foo",
              "content_type": "application/zip",
              "name": "bun-windows-x64-baseline.zip",
              "browser_download_url": `https://pub-5e11e972747a44bf9aaf9394f185a982.r2.dev/releases/${tagName}/bun-windows-x64-baseline.zip`,
            },
            {
              "url": "foo",
              "content_type": "application/zip",
              "name": "bun-linux-x64.zip",
              "browser_download_url": `https://pub-5e11e972747a44bf9aaf9394f185a982.r2.dev/releases/${tagName}/bun-linux-x64.zip`,
            },
            {
              "url": "foo",
              "content_type": "application/zip",
              "name": "bun-linux-x64-baseline.zip",
              "browser_download_url": `https://pub-5e11e972747a44bf9aaf9394f185a982.r2.dev/releases/${tagName}/bun-linux-x64-baseline.zip`,
            },
            {
              "url": "foo",
              "content_type": "application/zip",
              "name": "bun-darwin-x64.zip",
              "browser_download_url": `https://pub-5e11e972747a44bf9aaf9394f185a982.r2.dev/releases/${tagName}/bun-darwin-x64.zip`,
            },
            {
              "url": "foo",
              "content_type": "application/zip",
              "name": "bun-darwin-x64-baseline.zip",
              "browser_download_url": `https://pub-5e11e972747a44bf9aaf9394f185a982.r2.dev/releases/${tagName}/bun-darwin-x64-baseline.zip`,
            },
            {
              "url": "foo",
              "content_type": "application/zip",
              "name": "bun-darwin-aarch64.zip",
              "browser_download_url": `https://pub-5e11e972747a44bf9aaf9394f185a982.r2.dev/releases/${tagName}/bun-darwin-aarch64.zip`,
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
    cmd: [execPath, "upgrade"],
    cwd,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env: {
      ...env,
      NODE_TLS_REJECT_UNAUTHORIZED: "0",
      GITHUB_API_DOMAIN: `${server.hostname}:${server.port}`,
    },
  });

  closeTempDirHandle();

  // Should not contain error message
  expect(stderr.toString()).not.toContain("error:");
});
