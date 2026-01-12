import { spawn } from "bun";
import { upgrade_test_helpers } from "bun:internal-for-testing";
import { beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { bunExe, bunEnv as env, tls, tmpdirSync } from "harness";
import { copyFile } from "node:fs/promises";
import { basename, join } from "path";
const { openTempDirWithoutSharingDelete, closeTempDirHandle } = upgrade_test_helpers;

beforeAll(() => {
  setDefaultTimeout(1000 * 60 * 5);
});

describe.concurrent(() => {
  it("two invalid arguments, should display error message and suggest command", async () => {
    const cwd = tmpdirSync();
    const execPath = join(cwd, basename(bunExe()));
    await copyFile(bunExe(), execPath);
    const { stderr } = spawn({
      cmd: [execPath, "upgrade", "bun-types", "--dev"],
      cwd,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    const err = await stderr.text();
    expect(err.split(/\r?\n/)).toContain("error: This command updates Bun itself, and does not take package names.");
    expect(err.split(/\r?\n/)).toContain("note: Use `bun update bun-types --dev` instead.");
  });

  it("two invalid arguments flipped, should display error message and suggest command", async () => {
    const cwd = tmpdirSync();
    const execPath = join(cwd, basename(bunExe()));
    await copyFile(bunExe(), execPath);
    const { stderr } = spawn({
      cmd: [execPath, "upgrade", "--dev", "bun-types"],
      cwd,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    const err = await stderr.text();
    expect(err.split(/\r?\n/)).toContain("error: This command updates Bun itself, and does not take package names.");
    expect(err.split(/\r?\n/)).toContain("note: Use `bun update --dev bun-types` instead.");
  });

  it("one invalid argument, should display error message and suggest command", async () => {
    const cwd = tmpdirSync();
    const execPath = join(cwd, basename(bunExe()));
    await copyFile(bunExe(), execPath);
    const { stderr } = spawn({
      cmd: [execPath, "upgrade", "bun-types"],
      cwd,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    const err = await stderr.text();
    expect(err.split(/\r?\n/)).toContain("error: This command updates Bun itself, and does not take package names.");
    expect(err.split(/\r?\n/)).toContain("note: Use `bun update bun-types` instead.");
  });

  it("one valid argument, should succeed", async () => {
    const cwd = tmpdirSync();
    const execPath = join(cwd, basename(bunExe()));
    await copyFile(bunExe(), execPath);
    const { stderr } = spawn({
      cmd: [execPath, "upgrade", "--help"],
      cwd,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    const err = await stderr.text();
    // Should not contain error message
    expect(err.split(/\r?\n/)).not.toContain(
      "error: This command updates bun itself, and does not take package names.",
    );
    expect(err.split(/\r?\n/)).not.toContain("note: Use `bun update --help` instead.");
  });

  it("two valid argument, should succeed", async () => {
    const cwd = tmpdirSync();
    const execPath = join(cwd, basename(bunExe()));
    await copyFile(bunExe(), execPath);
    const { stderr } = spawn({
      cmd: [execPath, "upgrade", "--stable", "--profile"],
      cwd,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    const err = await stderr.text();
    // Should not contain error message
    expect(err.split(/\r?\n/)).not.toContain(
      "error: This command updates Bun itself, and does not take package names.",
    );
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
    const cwd = tmpdirSync();
    const execPath = join(cwd, basename(bunExe()));
    await copyFile(bunExe(), execPath);

    const { stderr } = Bun.spawn({
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
    expect(await stderr.text()).not.toContain("error:");
  });
});
