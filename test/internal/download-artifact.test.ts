// Regression tests for the Buildkite artifact download retry policy
// (scripts/download-artifact.mjs). The runner used to throw on the first
// download timeout, failing the whole test job on a single slow download; the
// retry loop only retried the "artifact not uploaded yet" case. See
// https://github.com/oven-sh/bun/issues/33116

import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { downloadArtifactZip } from "../../scripts/download-artifact.mjs";

type Behavior = { error?: string; writeZip?: string };

/**
 * Fake `buildkite-agent` spawn. Each call consumes the next behavior (the last
 * one repeats): it optionally writes a zip into the download directory (which
 * the real agent derives from args[3]) and resolves with `{ error }`.
 */
function fakeSpawn(behaviors: Behavior[]) {
  const calls: { args: string[]; timeout: number }[] = [];
  const spawn = async ({ args, timeout }: { command: string; args: string[]; timeout: number }) => {
    const behavior = behaviors[Math.min(calls.length, behaviors.length - 1)];
    calls.push({ args, timeout });
    if (behavior.writeZip) {
      const releasePath = args[3];
      writeFileSync(join(releasePath, behavior.writeZip), "PK\u0003\u0004fake");
    }
    return { error: behavior.error };
  };
  return { spawn, calls };
}

const noSleep = async () => {};

describe("downloadArtifactZip", () => {
  test("retries a timed-out download and recovers", async () => {
    using dir = tempDir("dl-artifact", {});
    const releasePath = join(String(dir), "release");
    const { spawn, calls } = fakeSpawn([{ error: "timeout" }, { writeZip: "bun-linux-x64.zip" }]);

    const zipPath = await downloadArtifactZip({
      target: "darwin-aarch64-build-bun",
      releasePath,
      spawn,
      sleep: noSleep,
    });

    expect(zipPath).toBe(join(releasePath, "bun-linux-x64.zip"));
    expect(calls.length).toBe(2);
  });

  test("retries while the artifact is still uploading", async () => {
    using dir = tempDir("dl-artifact", {});
    const releasePath = join(String(dir), "release");
    // First download succeeds but the zip is not present yet.
    const { spawn, calls } = fakeSpawn([{}, { writeZip: "bun-linux-x64.zip" }]);

    const zipPath = await downloadArtifactZip({
      target: "darwin-aarch64-build-bun",
      releasePath,
      spawn,
      sleep: noSleep,
    });

    expect(zipPath).toBe(join(releasePath, "bun-linux-x64.zip"));
    expect(calls.length).toBe(2);
  });

  test("prefers the profile build when several zips are present", async () => {
    using dir = tempDir("dl-artifact", {});
    const releasePath = join(String(dir), "release");
    const spawn = async ({ args }: { command: string; args: string[]; timeout: number }) => {
      const downloadPath = args[3];
      writeFileSync(join(downloadPath, "bun-linux-x64.zip"), "PK\u0003\u0004fake");
      writeFileSync(join(downloadPath, "bun-profile.zip"), "PK\u0003\u0004fake");
      return {};
    };

    const zipPath = await downloadArtifactZip({
      target: "darwin-aarch64-build-bun",
      releasePath,
      spawn,
      sleep: noSleep,
    });

    expect(zipPath).toBe(join(releasePath, "bun-profile.zip"));
  });

  test("throws after exhausting every attempt and surfaces the last error", async () => {
    using dir = tempDir("dl-artifact", {});
    const releasePath = join(String(dir), "release");
    const { spawn, calls } = fakeSpawn([{ error: "timeout" }]);

    await expect(
      downloadArtifactZip({
        target: "darwin-aarch64-build-bun",
        releasePath,
        spawn,
        attempts: 3,
        sleep: noSleep,
      }),
    ).rejects.toThrow(/after 3 attempts.*last download error: timeout/s);
    expect(calls.length).toBe(3);
  });

  test("never reuses a partial zip left behind by a killed download", async () => {
    using dir = tempDir("dl-artifact", {});
    const releasePath = join(String(dir), "release");
    // Attempt 1: the killed download leaves a truncated zip, then reports the
    // timeout. Attempt 2: the download succeeds but produces no zip. The fix
    // must start attempt 2 from a clean directory, so the stale zip is gone
    // and we throw instead of handing back the partial artifact.
    const { spawn, calls } = fakeSpawn([{ writeZip: "bun-stale.zip", error: "timeout" }, {}]);

    await expect(
      downloadArtifactZip({
        target: "darwin-aarch64-build-bun",
        releasePath,
        spawn,
        attempts: 2,
        sleep: noSleep,
      }),
    ).rejects.toThrow(/after 2 attempts/);
    expect(calls.length).toBe(2);
    expect(existsSync(join(releasePath, "bun-stale.zip"))).toBe(false);
  });

  test("passes the build id through to buildkite-agent when provided", async () => {
    using dir = tempDir("dl-artifact", {});
    const releasePath = join(String(dir), "release");
    const { spawn, calls } = fakeSpawn([{ writeZip: "bun-linux-x64.zip" }]);

    await downloadArtifactZip({
      target: "darwin-aarch64-build-bun",
      buildId: "01234567-89ab-cdef-0123-456789abcdef",
      releasePath,
      spawn,
      sleep: noSleep,
    });

    expect(calls[0].args).toContain("--build");
    expect(calls[0].args).toContain("01234567-89ab-cdef-0123-456789abcdef");
    expect(calls[0].args).toEqual([
      "artifact",
      "download",
      "**",
      releasePath,
      "--step",
      "darwin-aarch64-build-bun",
      "--build",
      "01234567-89ab-cdef-0123-456789abcdef",
    ]);
  });
});
