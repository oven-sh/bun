import { spawn } from "bun";
import { upgrade_test_helpers } from "bun:internal-for-testing";
import { beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { bunExe, bunEnv as env, tls, tmpdirSync } from "harness";
import { copyFile, writeFile } from "node:fs/promises";
import { basename, join } from "path";
const { openTempDirWithoutSharingDelete, closeTempDirHandle } = upgrade_test_helpers;

// All supported `bun upgrade` asset names for a given tag, mirroring
// what the real GitHub releases API would return.
function allPlatformAssets(tagName: string) {
  const assetNames = [
    "bun-windows-x64.zip",
    "bun-windows-x64-baseline.zip",
    "bun-windows-aarch64.zip",
    "bun-linux-x64.zip",
    "bun-linux-x64-baseline.zip",
    "bun-linux-aarch64.zip",
    "bun-linux-x64-musl.zip",
    "bun-linux-x64-musl-baseline.zip",
    "bun-linux-aarch64-musl.zip",
    "bun-darwin-x64.zip",
    "bun-darwin-x64-baseline.zip",
    "bun-darwin-aarch64.zip",
  ];
  return assetNames.map(name => ({
    url: "foo",
    content_type: "application/zip",
    name,
    browser_download_url: `https://pub-5e11e972747a44bf9aaf9394f185a982.r2.dev/releases/${tagName}/${name}`,
  }));
}

beforeAll(() => {
  setDefaultTimeout(1000 * 60 * 5);
});

describe.concurrent(() => {
  it("two invalid arguments, should display error message and suggest command", async () => {
    const cwd = tmpdirSync();
    const { stderr } = spawn({
      cmd: [bunExe(), "upgrade", "bun-types", "--dev"],
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
    const { stderr } = spawn({
      cmd: [bunExe(), "upgrade", "--dev", "bun-types"],
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
    const { stderr } = spawn({
      cmd: [bunExe(), "upgrade", "bun-types"],
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
    const { stderr } = spawn({
      cmd: [bunExe(), "upgrade", "--help"],
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
                "name": "bun-windows-aarch64.zip",
                "browser_download_url": `https://pub-5e11e972747a44bf9aaf9394f185a982.r2.dev/releases/${tagName}/bun-windows-aarch64.zip`,
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
                "name": "bun-linux-aarch64.zip",
                "browser_download_url": `https://pub-5e11e972747a44bf9aaf9394f185a982.r2.dev/releases/${tagName}/bun-linux-aarch64.zip`,
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

  // When `install.minimumReleaseAge` is set and the latest release was
  // published too recently, `bun upgrade` should fall back to the
  // `/releases` list endpoint and pick the newest release older than the
  // configured window.
  //
  // `--stable` is passed so debug builds (which default to the canary
  // channel and skip `getLatestVersion` entirely) still exercise the
  // stable resolution path where `minimumReleaseAge` applies.
  it("honors install.minimumReleaseAge: falls back to older release when latest is too recent", async () => {
    const now = Date.now();
    // Window is 10 minutes; the "latest" release is 1 minute old (too
    // recent) and the fallback is 1 hour old (eligible).
    const newPublishedAt = new Date(now - 60_000).toISOString();
    const oldPublishedAt = new Date(now - 60 * 60_000).toISOString();
    // Use the running Bun's version as the fallback tag so `isCurrent()`
    // short-circuits with the "already on latest" message instead of
    // actually attempting to download anything.
    const fallbackTag = `bun-v${Bun.version}`;

    using server = Bun.serve({
      tls,
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname.endsWith("/releases/latest")) {
          return new Response(
            JSON.stringify({
              tag_name: "bun-v999.999.999",
              published_at: newPublishedAt,
              assets: allPlatformAssets("bun-v999.999.999"),
            }),
          );
        }
        // `/releases?per_page=10` — newest-first array.
        if (url.pathname.endsWith("/releases")) {
          return new Response(
            JSON.stringify([
              {
                tag_name: "bun-v999.999.999",
                published_at: newPublishedAt,
                assets: allPlatformAssets("bun-v999.999.999"),
              },
              {
                tag_name: fallbackTag,
                published_at: oldPublishedAt,
                assets: allPlatformAssets(fallbackTag),
              },
            ]),
          );
        }
        return new Response("not found", { status: 404 });
      },
    });

    const cwd = tmpdirSync();
    const execPath = join(cwd, basename(bunExe()));
    await copyFile(bunExe(), execPath);
    await writeFile(join(cwd, "bunfig.toml"), `[install]\nminimumReleaseAge = 600 # 10 minutes\n`);

    const { stdout, stderr, exited } = Bun.spawn({
      cmd: [execPath, "upgrade", "--stable"],
      cwd,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...env,
        NODE_TLS_REJECT_UNAUTHORIZED: "0",
        GITHUB_API_DOMAIN: `${server.hostname}:${server.port}`,
      },
    });

    const [err, _out, _code] = await Promise.all([stderr.text(), stdout.text(), exited]);
    // Skipped the too-recent v999.999.999 and landed on the older tag.
    // The actual download will then fail because the asset URL points
    // at a fake CDN host — that's fine; this test only cares which
    // version was *selected*.
    expect(err).not.toContain("v999.999.999");
    expect(err).toContain(`v${Bun.version}`);
  });

  // Same setup, but the `/releases` list contains only too-recent
  // releases. `bun upgrade` must refuse and exit non-zero with a clear
  // message instead of silently downloading the too-recent build.
  it("honors install.minimumReleaseAge: errors when no release passes the window", async () => {
    const now = Date.now();
    const newPublishedAt = new Date(now - 60_000).toISOString(); // 1 min ago

    using server = Bun.serve({
      tls,
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname.endsWith("/releases/latest")) {
          return new Response(
            JSON.stringify({
              tag_name: "bun-v999.999.999",
              published_at: newPublishedAt,
              assets: allPlatformAssets("bun-v999.999.999"),
            }),
          );
        }
        if (url.pathname.endsWith("/releases")) {
          return new Response(
            JSON.stringify([
              {
                tag_name: "bun-v999.999.999",
                published_at: newPublishedAt,
                assets: allPlatformAssets("bun-v999.999.999"),
              },
              {
                tag_name: "bun-v999.999.998",
                published_at: newPublishedAt,
                assets: allPlatformAssets("bun-v999.999.998"),
              },
            ]),
          );
        }
        return new Response("not found", { status: 404 });
      },
    });

    const cwd = tmpdirSync();
    const execPath = join(cwd, basename(bunExe()));
    await copyFile(bunExe(), execPath);
    await writeFile(
      join(cwd, "bunfig.toml"),
      // 1-day window so the 1-minute-old fake releases are both excluded.
      `[install]\nminimumReleaseAge = 86400\n`,
    );

    const { stderr, exited } = Bun.spawn({
      cmd: [execPath, "upgrade", "--stable"],
      cwd,
      stdin: "pipe",
      stdout: null,
      stderr: "pipe",
      env: {
        ...env,
        NODE_TLS_REJECT_UNAUTHORIZED: "0",
        GITHUB_API_DOMAIN: `${server.hostname}:${server.port}`,
      },
    });

    const [err, code] = await Promise.all([stderr.text(), exited]);
    expect(err).toContain("minimumReleaseAge");
    expect(code).not.toBe(0);
  });

  // Sanity check: when the latest release is already older than the
  // configured window, `bun upgrade` uses it directly — no extra request
  // to the list endpoint.
  it("honors install.minimumReleaseAge: uses latest when it already passes the window", async () => {
    const tagNameCurrent = `bun-v${Bun.version}`;
    const publishedAt = new Date(Date.now() - 24 * 60 * 60_000).toISOString(); // 1 day ago

    let listEndpointHit = false;
    using server = Bun.serve({
      tls,
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname.endsWith("/releases/latest")) {
          return new Response(
            JSON.stringify({
              tag_name: tagNameCurrent,
              published_at: publishedAt,
              assets: allPlatformAssets(tagNameCurrent),
            }),
          );
        }
        if (url.pathname.endsWith("/releases")) {
          listEndpointHit = true;
          return new Response("[]");
        }
        return new Response("not found", { status: 404 });
      },
    });

    const cwd = tmpdirSync();
    const execPath = join(cwd, basename(bunExe()));
    await copyFile(bunExe(), execPath);
    await writeFile(join(cwd, "bunfig.toml"), `[install]\nminimumReleaseAge = 600 # 10 min\n`);

    const { stderr, exited } = Bun.spawn({
      cmd: [execPath, "upgrade", "--stable"],
      cwd,
      stdin: "pipe",
      stdout: null,
      stderr: "pipe",
      env: {
        ...env,
        NODE_TLS_REJECT_UNAUTHORIZED: "0",
        GITHUB_API_DOMAIN: `${server.hostname}:${server.port}`,
      },
    });

    const [err, _code] = await Promise.all([stderr.text(), exited]);
    // Latest release already satisfies the window, so only
    // `/releases/latest` should be hit — the list endpoint is the
    // fallback and must not fire here.
    expect(listEndpointHit).toBe(false);
    // Confirm the intended version was picked (download itself will
    // still fail against the fake CDN — ignore the exit code).
    expect(err).toContain(`v${Bun.version}`);
    expect(err).not.toContain("minimumReleaseAge");
  });
});
