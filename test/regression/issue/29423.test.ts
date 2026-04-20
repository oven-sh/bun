// Regression test for https://github.com/oven-sh/bun/issues/29423.
//
// Before markAsUncloneable was implemented, every undici 8.0.3+ constructor
// that called webidl.util.markAsUncloneable (CacheStorage, Response, Request,
// Headers, FormData, WebSocket, EventSource) crashed at module-load time with:
//   TypeError: webidl.util.markAsUncloneable is not a function
//
// undici 8.0.3 removed the runtime feature probe (nodejs/undici#4968) and
// 8.1.0's lib/web/webidl/index.js does
//   const { markAsUncloneable } = require("node:worker_threads");
// unconditionally at module load.
//
// This test exercises the real npm package (not Bun's built-in `undici` shim,
// which intercepts the bare `"undici"` specifier). Deep subpath imports bypass
// the shim, so we drive the webidl module-load through them.

import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const kUndiciVersion = "^8.1.0";

// Pulls undici from the real npm registry, so give the install enough time to
// either succeed or fail gracefully (the "install failed → skip" branch below
// only runs if the child exits; the default 5s per-test timeout isn't enough
// for a cold registry fetch).
const kTestTimeoutMs = 120_000;

test(
  "undici 8.1+ loads webidl without crashing (regression for missing markAsUncloneable)",
  async () => {
    using dir = tempDir("markAsUncloneable-undici-regression", {
      "package.json": JSON.stringify({
        name: "markasuncloneable-regression",
        version: "0.0.0",
        private: true,
        dependencies: { undici: kUndiciVersion },
      }),
    });

    // Install undici from npm into the temp dir. If we can't reach the registry
    // (offline CI / sandbox), skip the test instead of failing — the smoke test
    // is only meaningful with the real package.
    await using install = Bun.spawn({
      cmd: [bunExe(), "install", "--no-save"],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [installStdout, installStderr, installExit] = await Promise.all([
      install.stdout.text(),
      install.stderr.text(),
      install.exited,
    ]);

    if (installExit !== 0) {
      console.warn(
        `[markAsUncloneable-undici-regression] Skipping: 'bun install undici@${kUndiciVersion}' failed (exit ${installExit}).\nstdout: ${installStdout}\nstderr: ${installStderr}`,
      );
      return;
    }

    // Resolve the installed undici version and confirm we got >=8.1 (otherwise
    // the regression does not apply). Read package.json directly so we don't
    // depend on any particular `bun pm ls` output format.
    let major: number;
    let minor: number;
    let patch: number;
    try {
      const pkg = JSON.parse(readFileSync(join(String(dir), "node_modules", "undici", "package.json"), "utf8")) as {
        version: string;
      };
      const match = pkg.version.match(/^(\d+)\.(\d+)\.(\d+)/);
      if (!match) {
        console.warn(
          `[markAsUncloneable-undici-regression] Skipping: could not parse undici version '${pkg.version}'.`,
        );
        return;
      }
      major = Number(match[1]);
      minor = Number(match[2]);
      patch = Number(match[3]);
    } catch (err) {
      console.warn(`[markAsUncloneable-undici-regression] Skipping: could not read undici package.json: ${err}`);
      return;
    }
    if (major < 8 || (major === 8 && minor < 1)) {
      console.warn(
        `[markAsUncloneable-undici-regression] Skipping: resolved undici@${major}.${minor}.${patch} is too old.`,
      );
      return;
    }

    // Now drive the actual repro: deep-subpath require of cachestorage.js pulls
    // in lib/web/webidl/index.js, which calls markAsUncloneable at module-load
    // time. If markAsUncloneable is missing, the require throws synchronously.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        // Keep this aligned with the user-visible repro in the PR body.
        `require("undici/lib/web/cache/cachestorage.js"); console.log("ok");`,
      ],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // The specific pre-fix symptom we're guarding against. Print both streams
    // on failure so diagnosis is easy.
    expect(stderr).not.toContain("markAsUncloneable is not a function");
    expect(stdout.trim()).toBe("ok");
    expect(exitCode).toBe(0);
  },
  kTestTimeoutMs,
);
