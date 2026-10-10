import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "path";
import { platforms } from "../../../packages/bun-release/src/platform";

// Runs packages/bun-release/scripts/upload-npm.ts against a fake GitHub release.
// Its dependencies are stubbed: octokit answers every release lookup with
// release.json, jszip treats a downloaded "zip" as an archive holding `${body}/bun`,
// and esbuild (only used to bundle the postinstall script) does nothing. src/spawn.ts
// (covered by spawn.test.ts) is replaced with a copy that records every command in
// spawn.log instead of running it, so npm itself is never invoked.
const repoDir = path.join(import.meta.dir, "..", "..", "..");
const packageDir = path.join(repoDir, "packages", "bun-release");

const sources: Record<string, string> = {
  "scripts/upload-npm.ts": readFileSync(path.join(packageDir, "scripts", "upload-npm.ts"), "utf8"),
};
for (const name of new Bun.Glob("*.ts").scanSync(path.join(packageDir, "src"))) {
  sources[`src/${name}`] = readFileSync(path.join(packageDir, "src", name), "utf8");
}
sources["src/spawn.ts"] = `
  import { appendFileSync } from "fs";
  export function spawn(cmd, args, options = {}) {
    appendFileSync(new URL("../spawn.log", import.meta.url), JSON.stringify({ cmd, args, cwd: options.cwd }) + "\\n");
    return { exitCode: 0, stdout: "", stderr: "" };
  }
`;

const stubs = {
  "node_modules/octokit/package.json": JSON.stringify({ name: "octokit", version: "0.0.0", main: "index.js" }),
  "node_modules/octokit/index.js": `
    import release from "../../release.json";
    export class Octokit {
      async request(route) {
        if (route === "GET /repos/{owner}/{repo}/releases/latest") return { data: release };
        if (route === "GET /repos/{owner}/{repo}/releases/tags/{tag}") return { data: release };
        throw new Error("unexpected request: " + route);
      }
    }
  `,
  "node_modules/jszip/package.json": JSON.stringify({ name: "jszip", version: "0.0.0", main: "index.js" }),
  "node_modules/jszip/index.js": `
    export async function loadAsync(buffer) {
      const bin = new TextDecoder().decode(buffer);
      return { files: { [bin + "/bun"]: { dir: false, async: async () => buffer } } };
    }
  `,
  "node_modules/esbuild/package.json": JSON.stringify({ name: "esbuild", version: "0.0.0", main: "index.js" }),
  "node_modules/esbuild/index.js": `
    export function buildSync() { return { errors: [], warnings: [] }; }
    export function formatMessagesSync() { return []; }
  `,
};

const version = "1.0.0";
const tagName = `bun-v${version}`;
const missingPrefix = `Release "${tagName}" is missing assets: `;
const host = platforms.filter(({ os, arch }) => os === process.platform && arch === process.arch);
const allBins = platforms.map(({ bin }) => bin);

function serveAssets(downloaded: string[], unavailable?: string) {
  return Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(request) {
      const bin = path.posix.basename(new URL(request.url).pathname, ".zip");
      downloaded.push(bin);
      return new Response(bin, { status: bin === unavailable ? 404 : 200 });
    },
  });
}

function assetsOn(server: { url: URL }, bins: string[]) {
  return bins.map(bin => ({ name: `${bin}.zip`, browser_download_url: new URL(`/${bin}.zip`, server.url).href }));
}

function releaseDir(name: string, assets: ReturnType<typeof assetsOn>) {
  return tempDir(`bun-release-${name}`, {
    ...sources,
    ...stubs,
    "release.json": JSON.stringify({ tag_name: tagName, assets }),
  });
}

async function uploadNpm(cwd: string, action: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), path.join("scripts", "upload-npm.ts"), version, action],
    cwd,
    // src/console.ts switches to "::error::" annotations when GITHUB_ACTION is set.
    env: { ...bunEnv, GITHUB_ACTION: undefined },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

function missingAssets(stderr: string): string[] | undefined {
  const line = stderr.split(/\r?\n/).find(line => line.includes(missingPrefix));
  return line?.slice(line.indexOf(missingPrefix) + missingPrefix.length).split(", ");
}

/** The npm commands the script ran, in order, as `{ cwd, args }` with `cwd` relative to the package. */
function npmCalls(dir: string): { cwd: string; args: string[] }[] {
  const log = path.join(dir, "spawn.log");
  if (!existsSync(log)) return [];
  return readFileSync(log, "utf8")
    .split("\n")
    .filter(Boolean)
    .map(line => JSON.parse(line))
    .filter(({ cmd }) => cmd === "npm")
    .map(({ cwd, args }) => ({ cwd, args }));
}

function npmCallsFor(bins: string[], args: string[]) {
  return [...bins.map(bin => ({ cwd: path.join("npm", "@oven", bin), args })), { cwd: path.join("npm", "bun"), args }];
}

test.concurrent("dry-run builds and packs the host's packages, then the root package", async () => {
  const downloaded: string[] = [];
  using server = serveAssets(downloaded);
  using dir = releaseDir("dry-run", assetsOn(server, allBins));
  const cwd = String(dir);

  const { stderr, exitCode } = await uploadNpm(cwd, "dry-run");
  // publishModule() echoes each npm command's (here empty) output as a line on stderr.
  expect(stderr.trim()).toBe("");
  expect(exitCode).toBe(0);

  const hostBins = host.map(({ bin }) => bin);
  expect(downloaded).toEqual(hostBins);
  for (const { bin, exe, os, arch } of host) {
    const module = path.join(cwd, "npm", "@oven", bin);
    expect(readFileSync(path.join(module, exe), "utf8")).toBe(bin);
    expect(JSON.parse(readFileSync(path.join(module, "package.json"), "utf8"))).toMatchObject({
      name: `@oven/${bin}`,
      version,
      os: [os],
      cpu: [arch],
    });
  }
  // The root package pins every platform package to its own version, which is why a
  // release that cannot build one of them must not publish any of them.
  const root = JSON.parse(readFileSync(path.join(cwd, "npm", "bun", "package.json"), "utf8"));
  expect(root.optionalDependencies).toEqual(
    Object.fromEntries(platforms.filter(({ alias }) => !alias).map(({ bin }) => [`@oven/${bin}`, version])),
  );
  expect(npmCalls(cwd)).toEqual(npmCallsFor(hostBins, ["pack"]));
});

test.concurrent("dry-run fails before building anything when a host platform has no asset", async () => {
  const downloaded: string[] = [];
  using server = serveAssets(downloaded);
  const [absent] = host;
  const bins = allBins.filter(bin => bin !== absent.bin);
  using dir = releaseDir("dry-run-incomplete", assetsOn(server, bins));
  const cwd = String(dir);

  const { stderr, exitCode } = await uploadNpm(cwd, "dry-run");
  expect(stderr).toContain(missingPrefix);
  expect(missingAssets(stderr)).toEqual([`${absent.bin}.zip`]);
  expect(exitCode).toBe(1);

  expect(downloaded).toEqual([]);
  expect(existsSync(path.join(cwd, "npm"))).toBe(false);
  expect(npmCalls(cwd)).toEqual([]);
});

test.concurrent("publish builds and publishes every platform in platform.ts, then the root package", async () => {
  const downloaded: string[] = [];
  using server = serveAssets(downloaded);
  using dir = releaseDir("publish", assetsOn(server, allBins));
  const cwd = String(dir);

  const { stderr, exitCode } = await uploadNpm(cwd, "publish");
  expect(stderr.trim()).toBe("");
  expect(exitCode).toBe(0);

  expect(downloaded).toEqual(allBins);
  expect(npmCalls(cwd)).toEqual(npmCallsFor(allBins, ["publish", "--access", "public", "--tag", "latest"]));
});

// An asset can be listed on the release but still fail to download, e.g. while
// upload-release.sh is replacing it; the packages built before that point stay unpublished.
test.concurrent("publish publishes nothing when an asset fails to download", async () => {
  const downloaded: string[] = [];
  const [built, unavailable] = allBins;
  using server = serveAssets(downloaded, unavailable);
  using dir = releaseDir("publish-download-failure", assetsOn(server, allBins));
  const cwd = String(dir);

  const { stderr, exitCode } = await uploadNpm(cwd, "publish");
  expect(stderr).toContain(`404: ${new URL(`/${unavailable}.zip`, server.url).href}`);
  expect(exitCode).toBe(1);

  expect(downloaded).toEqual([built, unavailable]);
  expect(existsSync(path.join(cwd, "npm", "@oven", built, "package.json"))).toBe(true);
  expect(npmCalls(cwd)).toEqual([]);
});

test.concurrent("publish publishes nothing when any platform has no asset", async () => {
  const downloaded: string[] = [];
  using server = serveAssets(downloaded);
  const absent = platforms.find(platform => !host.includes(platform))!;
  const bins = allBins.filter(bin => bin !== absent.bin);
  using dir = releaseDir("publish-incomplete", assetsOn(server, bins));
  const cwd = String(dir);

  const { stderr, exitCode } = await uploadNpm(cwd, "publish");
  expect(stderr).toContain(missingPrefix);
  expect(missingAssets(stderr)).toEqual([`${absent.bin}.zip`]);
  expect(exitCode).toBe(1);

  expect(downloaded).toEqual([]);
  expect(existsSync(path.join(cwd, "npm"))).toBe(false);
  expect(npmCalls(cwd)).toEqual([]);
});

test.concurrent("publish reports every missing asset at once", async () => {
  using dir = releaseDir("publish-empty", []);
  const cwd = String(dir);

  const { stderr, exitCode } = await uploadNpm(cwd, "publish");
  expect(stderr).toContain(missingPrefix);
  expect(missingAssets(stderr)).toEqual(allBins.map(bin => `${bin}.zip`));
  expect(exitCode).toBe(1);

  expect(npmCalls(cwd)).toEqual([]);
});

// The zips come from .buildkite/scripts/upload-release.sh, so a platform added to
// platform.ts without also being uploaded there fails every release until both agree.
test("upload-release.sh uploads a zip for every platform in platform.ts", () => {
  const script = readFileSync(path.join(repoDir, ".buildkite", "scripts", "upload-release.sh"), "utf8");
  const uploaded = new Set([
    ...script
      .match(/artifacts=\(([^)]*)\)/)![1]
      .split(/\s+/)
      .filter(Boolean),
    // The -baseline zips are repacked from the plain ones by alias_baseline_artifact.
    ...[...script.matchAll(/echo "([^"]+\.zip)"/g)].map(([, zip]) => zip),
  ]);
  expect(allBins.map(bin => `${bin}.zip`).filter(zip => !uploaded.has(zip))).toEqual([]);
});
