/**
 * The npm canary publish (packages/bun-release/scripts/upload-npm.ts) stamps a
 * commit sha into each package version. That sha must describe the binaries it
 * packages, which come from the assets of the rolling GitHub "canary" release.
 * The record of what those assets were built from is the release notes line
 * that .buildkite/scripts/upload-release.sh writes after every upload.
 *
 * These tests pin the parser in packages/bun-release/src/sha.ts to the exact
 * template in the upload script, and cover the byte check that upload-npm.ts
 * runs on every downloaded binary before it is packaged.
 */
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { cpSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { binaryIncludesSha, getShaFromReleaseBody } from "../../../packages/bun-release/src/sha";

const SHA = "d578a8c70d103dd11c75cf3c8b681d4a015a66df";

test("getShaFromReleaseBody parses the notes template in upload-release.sh", () => {
  const script = readFileSync(join(import.meta.dir, "../../../.buildkite/scripts/upload-release.sh"), "utf8");
  const template = /--notes "([^"]*corresponds to the commit[^"]*)"/.exec(script)?.[1];
  expect(template).toBeDefined();
  const body = template!.replace("$BUILDKITE_COMMIT", SHA);
  expect(getShaFromReleaseBody(body)).toBe(SHA);
});

test("getShaFromReleaseBody parses the live canary release body format", () => {
  expect(getShaFromReleaseBody(`This release of Bun corresponds to the commit: ${SHA}`)).toBe(SHA);
  expect(getShaFromReleaseBody(`This release of Bun corresponds to the commit: ${SHA}\n\nmore notes`)).toBe(SHA);
});

test("getShaFromReleaseBody rejects bodies without a full commit sha", () => {
  expect(getShaFromReleaseBody(undefined)).toBeUndefined();
  expect(getShaFromReleaseBody(null)).toBeUndefined();
  expect(getShaFromReleaseBody("")).toBeUndefined();
  expect(getShaFromReleaseBody("Bun is a fast all-in-one JavaScript runtime.")).toBeUndefined();
  // A short sha is not enough to identify the build.
  expect(getShaFromReleaseBody("This release of Bun corresponds to the commit: d578a8c")).toBeUndefined();
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

test("getSemver stamps the canary version with the sha from the release notes, not heads/main", async () => {
  // The shas from oven-sh/bun#40880: the rolling release held binaries built
  // from ASSET_SHA while heads/main had moved on to MAIN_SHA. The version
  // must carry the sha of the assets, so the mocked GitHub API answers with a
  // canary release whose notes name ASSET_SHA and a main ref at MAIN_SHA.
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
              return {
                data: {
                  tag_name: params.tag,
                  body: "This release of Bun corresponds to the commit: ${ASSET_SHA}",
                  assets: [],
                },
              };
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
      console.log(await getSemver("canary", 1));
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
