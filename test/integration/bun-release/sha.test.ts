/**
 * The npm canary publish (packages/bun-release/scripts/upload-npm.ts) stamps a
 * commit sha into each package version. That sha must describe the binaries it
 * packages, which come from the assets of the rolling GitHub "canary" release.
 * The release's tag never moves, so the binaries themselves are the only
 * record of the commit they were built from: Bun embeds it as Bun.revision.
 *
 * These tests cover the helpers in packages/bun-release/src/sha.ts that read
 * and verify that embedded commit, and pin getSemver to stamp the sha of the
 * assets instead of heads/main.
 */
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { cpSync } from "node:fs";
import { join } from "node:path";
import { binaryIncludesSha, binaryRevision } from "../../../packages/bun-release/src/sha";

const SHA = "d578a8c70d103dd11c75cf3c8b681d4a015a66df";

test("binaryRevision reads the embedded build commit out of a binary", () => {
  expect(binaryRevision(bunExe())).toBe(Bun.revision);
  expect(() => binaryRevision("/does/not/exist")).toThrow(/Could not read the build commit from/);
});

test("binaryIncludesSha finds the embedded revision among binary bytes", () => {
  // Bun.revision is the embedded full build sha that binaryIncludesSha
  // searches for in released binaries.
  expect(Bun.revision).toMatch(/^[0-9a-f]{40}$/);

  const junk = Buffer.alloc(1 << 16);
  for (let i = 0; i < junk.length; i++) junk[i] = i * 31;
  const binary = Buffer.concat([junk, Buffer.from(SHA, "utf8"), junk]);
  expect(binaryIncludesSha(binary, SHA)).toBe(true);
  expect(binaryIncludesSha(binary, Buffer.alloc(40, "f").toString())).toBe(false);
  expect(binaryIncludesSha(junk, SHA)).toBe(false);
});

test("getSemver stamps the canary version with the sha of the assets, not heads/main", async () => {
  // The shas from oven-sh/bun#40880: the rolling release held binaries built
  // from ASSET_SHA while heads/main had moved on to MAIN_SHA. The publish
  // scripts read ASSET_SHA out of a downloaded binary and pass it in, and the
  // version must carry it. The mocked GitHub API serves a main ref at
  // MAIN_SHA, which is what the version must not fall back to.
  const ASSET_SHA = "731aa92dad3777448920b40a4c2d3efe7e776c4e";
  const MAIN_SHA = SHA;
  using dir = tempDir("bun-release-semver", {
    "node_modules/octokit/package.json": `{ "name": "octokit", "version": "0.0.0", "main": "index.js" }`,
    "node_modules/octokit/index.js": `
      exports.Octokit = class Octokit {
        constructor() {}
        async request(route, params = {}) {
          switch (route) {
            case "GET /repos/{owner}/{repo}/releases/latest":
              return { data: { tag_name: "bun-v1.4.1" } };
            case "GET /repos/{owner}/{repo}/releases/tags/{tag}":
              return { data: { tag_name: params.tag, assets: [] } };
            case "GET /repos/{owner}/{repo}/git/ref/{ref}":
              return { data: { object: { sha: "${MAIN_SHA}" } } };
            default:
              throw new Error("Unexpected request: " + route);
          }
        }
      };
    `,
    // Passing the build number skips getBuild's npm registry request.
    "run-semver.fixture.ts": `
      import { getSemver } from "./src/github";
      console.log(await getSemver("canary", 1, "${ASSET_SHA}"));
    `,
  });
  // Copy the sources at test time, so this runs whatever state the release
  // scripts are in, with only the octokit dependency mocked.
  cpSync(join(import.meta.dir, "../../../packages/bun-release/src"), join(String(dir), "src"), { recursive: true });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run-semver.fixture.ts"],
    env: { ...bunEnv, GITHUB_REPOSITORY: "oven-sh/bun" },
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ version: stdout.trim(), stderr }).toEqual({
    version: expect.stringMatching(new RegExp(`^1\\.4\\.1-canary\\.\\d{8}\\.1\\+${ASSET_SHA.substring(0, 7)}$`)),
    stderr: "",
  });
  expect(exitCode).toBe(0);
});
