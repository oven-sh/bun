/**
 * The files of a release are named in four places. A name that only one of them has is a release step that fails on
 * main or a release branch, where alone it runs, or a package that is published without its binary:
 *
 * - .buildkite/ci.ts decides which builds there are and which zips the steps behind them ask for. It can't be imported
 *   (it generates the pipeline on import), so it is read as text.
 * - scripts/build/ci.ts names the zips that a build uploads.
 * - .buildkite/scripts/upload-release.ts fetches them by name and puts them into the release.
 * - packages/bun-release/src/platform.ts names the zip that each package on npm is made of.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { artifacts, getBaselineAlias } from "../../../.buildkite/scripts/upload-release.ts";
import { platforms } from "../../../packages/bun-release/src/platform.ts";
import { computeBunTriplet } from "../../../scripts/build/ci.ts";
import type { Config } from "../../../scripts/build/config.ts";

const repoRoot = join(import.meta.dir, "..", "..", "..");
const ciScript = readFileSync(join(repoRoot, ".buildkite", "ci.ts"), "utf8");
const sorted = (names: string[]) => [...names].sort();

type Target = { os: string; arch: string; abi?: string; profile?: string };

const matrix = /^const (?:bunPlatforms|buildPlatforms): Platform\[\] = \[\n([\s\S]*?)^\];/m.exec(ciScript);
if (matrix === null) throw new Error("the build matrix was not found in .buildkite/ci.ts");
const field = (entry: string, name: string) => new RegExp(`\\b${name}: "([^"]+)"`).exec(entry)?.[1];
const targets: Target[] = (
  matrix[1]
    .split("\n")
    .filter(line => !line.trim().startsWith("//"))
    .join("\n")
    .match(/\{[^}]*\}/g) ?? []
)
  .map(entry => ({
    os: field(entry, "os")!,
    arch: field(entry, "arch")!,
    abi: field(entry, "abi"),
    profile: field(entry, "profile"),
  }))
  // A build with a profile of its own, like asan, is in no release.
  .filter(target => target.profile === undefined);

const source = /^function getTargetTriplet\(platform: Target\): string (\{[\s\S]*?^\})/m.exec(ciScript);
if (source === null) throw new Error("getTargetTriplet was not found in .buildkite/ci.ts");
const getTargetTriplet = new Function("platform", source[1]) as (platform: Target) => string;

const fetched = artifacts.map(zip => zip.slice(0, -".zip".length));

// packages/bun-release/scripts/upload-s3.ts starts the upload on import, so the text of its function is run.
const s3Script = readFileSync(join(repoRoot, "packages", "bun-release", "scripts", "upload-s3.ts"), "utf8");
const upload = /^async function uploadToS3\(\{[\s\S]*?\}\): Promise<void> (\{[\s\S]*?^\})/m.exec(s3Script);
if (upload === null) throw new Error("uploadToS3 was not found in packages/bun-release/scripts/upload-s3.ts");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (...args: unknown[]) => Promise<void>;
const uploadToS3 = new AsyncFunction("aws", "bucketUrl", "dryRun", "key", "body", "headers", upload[1]);
const bucketUrl = new URL("bun/", "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com");

test("upload-release.ts fetches the zips that the builds of ci.ts upload, and no other", () => {
  // Where each release build is made more than once, under a profile each.
  const multiplied = /^const buildPlatforms: Platform\[\] = bunPlatforms\.flatMap\(([\s\S]*?)^\);/m.exec(ciScript);
  const profiles = [undefined, ...[...(multiplied?.[1] ?? "").matchAll(/profile: "(\w+)" as const/g)].map(m => m[1])];
  const triplets = profiles.flatMap(profile => targets.map(target => getTargetTriplet({ ...target, profile })));

  expect(targets.length).toBeGreaterThanOrEqual(8);
  expect(sorted(fetched)).toEqual(sorted(triplets.flatMap(triplet => [triplet, `${triplet}-profile`])));
});

test("ci.ts asks for a build's zips by the name that scripts/build/ci.ts gives them", () => {
  expect(targets.map(target => computeBunTriplet(target as Config))).toEqual(targets.map(getTargetTriplet));
});

test("upload-s3.ts sends the path of each file of a release as aws4fetch signs it", async () => {
  // What aws4fetch 1.0.17 signs for the path of an S3 host (dist/aws4fetch.esm.mjs:125-137). It sends the path as it is.
  const signed = (pathname: string) =>
    encodeURIComponent(decodeURIComponent(pathname.replace(/\+/g, " ")))
      .replace(/%2F/g, "/")
      .replace(/[!'()*]/g, char => "%" + char.charCodeAt(0).toString(16).toUpperCase());
  const sha = "bd92f9bef31a186baf8c9fc07640baedf349e7cc";
  // The folders of setPaths() in upload-s3.ts. The last one is of a canary: the version that npm gets.
  const folders = ["latest", "bun-v1.4.5", sha, "canary", `${sha}-canary`, "1.4.5-canary.20261124.1+bd92f9b"];
  const aliases = artifacts.flatMap(zip => getBaselineAlias(zip) ?? []);
  const names = [...artifacts, ...aliases, "SHASUMS256.txt", "SHASUMS256.txt.asc", "features.json"];
  const keys = folders.flatMap(folder => names.map(name => `releases/${folder}/${name}`));

  const sent: string[] = [];
  const aws = { fetch: async (url: string) => (sent.push(url), new Response()) };
  for (const key of keys) await uploadToS3(aws, bucketUrl, false, key, "", undefined);

  const paths = sent.map(url => new URL(url).pathname);
  expect(paths.map(signed)).toEqual(paths);
  // Only a `+` changes the URL of a file.
  expect(sent).toEqual(keys.map(key => new URL(key, bucketUrl).href.replace("+", "%2B")));
});

test("upload-s3.ts names the file and the error code of S3 when an upload fails", async () => {
  const key = "releases/1.4.5-canary.20261124.1+bd92f9b/features.json";
  const failure = (response: Response) =>
    uploadToS3({ fetch: async () => response }, bucketUrl, false, key, "", undefined).then(
      () => undefined,
      (error: Error) => error.message,
    );
  // As S3 answers: with the request that the client signed.
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Error><Code>SignatureDoesNotMatch</Code><Message>The request signature we calculated does not match the signature you provided.</Message><StringToSign>AWS4-HMAC-SHA256
20261124T141056Z</StringToSign><CanonicalRequest>PUT
/bun/releases/1.4.5-canary.20261124.1%2Bbd92f9b/features.json</CanonicalRequest></Error>`;

  expect(await failure(new Response(xml, { status: 403, statusText: "Forbidden" }))).toBe(
    `Failed to upload "${key}" to S3: 403 Forbidden (SignatureDoesNotMatch)`,
  );
  expect(await failure(new Response("Bad Gateway", { status: 502, statusText: "Bad Gateway" }))).toBe(
    `Failed to upload "${key}" to S3: 502 Bad Gateway`,
  );
  expect(await failure(new Response())).toBeUndefined();
});

test("every package on npm is made of a zip of the release", () => {
  const aliases = artifacts.flatMap(zip => getBaselineAlias(zip)?.slice(0, -".zip".length) ?? []);
  const released = [...fetched, ...aliases];
  expect(platforms.map(platform => platform.bin).filter(bin => !released.includes(bin))).toEqual([]);
});
