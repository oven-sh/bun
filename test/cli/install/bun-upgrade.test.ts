import { spawn, spawnSync } from "bun";
import { upgrade_test_helpers } from "bun:internal-for-testing";
import { beforeAll, beforeEach, expect, it, setDefaultTimeout } from "bun:test";
import { bunExe, bunEnv as env, tls, tmpdirSync } from "harness";
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

it("two or more arguments, should display error message and suggest command", async () => {
  const { stderr } = spawn({
    cmd: [execPath, "upgrade", "foo", "bar"],
    cwd,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });

  const err = await new Response(stderr).text();
  expect(err.split(/\r?\n/)).toContain("error: Invalid number of arguments.");
  expect(err.split(/\r?\n/)).toContain(
    "note: Run `bun upgrade` with `<version>`, `stable`,  `canary`, or no argument for latest version.",
  );
});

it("zero arguments and one invalid option, should display error message", async () => {
  const { stderr } = spawn({
    cmd: [execPath, "upgrade", "--foo"],
    cwd,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });

  const err = await new Response(stderr).text();
  expect(err.split(/\r?\n/)).toContain("error: `bun upgrade` only accepts `--profile` as an option.");
});

it("one valid argument and one invalid option, should display error message", async () => {
  const { stderr } = spawn({
    cmd: [execPath, "upgrade", "stable", "--foo"],
    cwd,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });

  const err = await new Response(stderr).text();
  expect(err.split(/\r?\n/)).toContain("error: `bun upgrade` only accepts `--profile` as an option.");
});

it("one valid options, should succeed", async () => {
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
