/**
 * packages/bun-release/scripts/upload-s3.ts mirrors a release to the bucket that bun.report reads debug info from.
 * It runs here with stand-ins for its two packages, for the network and for unzip.
 */
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { chmodSync } from "node:fs";
import { join } from "node:path";

const script = join(import.meta.dir, "../../packages/bun-release/scripts/upload-s3.ts");
const commit = "4ce14ba8b150c3c7315284f3df8480eb4158b38a";
const local = `bun-linux-${process.arch === "arm64" ? "aarch64" : "x64"}`;

const preload = `
  const assets = ["bun-windows-x64-profile.zip", "${local}.zip"];
  class Octokit {
    async request(route, { tag }) {
      if (route.includes("/git/ref/")) return { data: { object: { sha: "${commit}" } } };
      const tag_name = route.endsWith("/latest") ? "bun-v1.4.4" : tag;
      return { data: { tag_name, assets: assets.map(name => ({ name, browser_download_url: name })) } };
    }
  }
  class AwsClient {
    async fetch(href) {
      const { pathname } = new URL(href);
      console.log("PUT", pathname);
      const failure = JSON.parse(process.env.FAILURE);
      return failure && pathname.includes("/1.4.4-canary.") ? new Response(failure.body, failure) : new Response();
    }
  }
  Bun.plugin({
    name: "stand-ins",
    setup(build) {
      build.module("octokit", () => ({ exports: { Octokit }, loader: "object" }));
      build.module("aws4fetch", () => ({ exports: { AwsClient }, loader: "object" }));
    },
  });
  globalThis.fetch = async (url, init) => {
    if (init?.method === "POST") console.log("POST", url);
    return url.includes("dist-tags") ? Response.json({ canary: "" }) : new Response("zip");
  };
`;

/** `failure` is the answer to every upload into the folder that is named after the version of the canary. */
async function upload(tag: string, failure: { status: number; statusText: string; body: string } | null = null) {
  using dir = tempDir("upload-s3", {
    "preload.js": preload,
    "features.sh": `#!/bin/sh\necho '{"revision":"${commit}","is_canary":${tag === "canary"}}'\n`,
    "bin/unzip": `#!/bin/sh\nmkdir ${local} && cp "$RUNNER_TEMP/features.sh" ${local}/bun\n`,
  });
  for (const file of ["features.sh", "bin/unzip"]) chmodSync(join(String(dir), file), 0o755);

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--no-install", "--preload", "./preload.js", script, tag],
    cwd: String(dir),
    env: {
      ...bunEnv,
      PATH: `${join(String(dir), "bin")}:${bunEnv.PATH}`,
      RUNNER_TEMP: String(dir),
      AWS_ACCESS_KEY_ID: "id",
      AWS_SECRET_ACCESS_KEY: "secret",
      AWS_ENDPOINT: "https://account.invalid",
      AWS_BUCKET: "bun",
      BUN_REPORT_TOKEN: "token",
      FAILURE: JSON.stringify(failure),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const withoutDate = (text: string) => text.replace(/canary\.\d{8}\./g, "canary.DATE.");
  return {
    requests: withoutDate(stdout).match(/^(PUT|POST) .*/gm),
    errors: withoutDate(stderr).match(/^(error: |Failed to upload ).*/gm) ?? [],
    echoesBody: stderr.includes("c0ffee"),
    exitCode,
  };
}

const files = ["features.json", `${local}.zip`, "bun-windows-x64-profile.zip"];
const puts = (...folders: string[]) => files.flatMap(file => folders.map(dir => `PUT /bun/releases/${dir}/${file}`));
const canary = puts("canary", "1.4.4-canary.DATE.1%2B4ce14ba", `${commit}-canary`);
const purge = `POST https://bun.report/purge-cache/${commit}`;
const failed = (file: string, reason: string) =>
  `Failed to upload "releases/1.4.4-canary.DATE.1+4ce14ba/${file}" to S3: ${reason}`;
const xml = (code: string) => `<Error><Code>${code}</Code><SignatureProvided>c0ffee</SignatureProvided></Error>`;

// release.yml runs the script on Linux.
describe.concurrent.skipIf(!isLinux)("upload-s3.ts", () => {
  test.each([
    ["canary", canary],
    ["bun-v1.4.4", puts("latest", "bun-v1.4.4", commit)],
    ["bun-v1.4.3", puts("bun-v1.4.3", commit)],
  ])("uploads %s", async (tag, requests) => {
    expect(await upload(tag)).toEqual({ requests: [...requests, purge], errors: [], echoesBody: false, exitCode: 0 });
  });

  test.each([
    ["SignatureDoesNotMatch", xml("SignatureDoesNotMatch")],
    ["Forbidden", "<html>c0ffee</html>"],
  ])("fails after the other uploads when one is refused (%s)", async (reason, body) => {
    expect(await upload("canary", { status: 403, statusText: "Forbidden", body })).toEqual({
      requests: canary,
      errors: [...files.map(file => failed(file, `403 ${reason}`)), "error: Uploads that S3 refused: 3"],
      echoesBody: false,
      exitCode: 1,
    });
  });

  test.each([
    [500, "InternalError"],
    [429, "TooManyRequests"],
  ])("fails at once when the bucket is unavailable (%d)", async (status, code) => {
    expect(await upload("canary", { status, statusText: "", body: xml(code) })).toEqual({
      requests: canary.slice(0, 2),
      errors: [`error: ${failed("features.json", `${status} ${code}`)}`],
      echoesBody: false,
      exitCode: 1,
    });
  });
});
