import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "path";
import { platforms } from "../../../packages/bun-release/src/platform";

// Runs packages/bun-release/scripts/upload-npm.ts against a fake GitHub release.
// Its dependencies are stubbed: octokit answers every release lookup with
// release.json, jszip treats a downloaded "zip" as an archive holding `${body}/bun`,
// and esbuild (only used to bundle the postinstall script) does nothing.
const packageDir = path.join(import.meta.dir, "..", "..", "..", "packages", "bun-release");

const sources: Record<string, string> = {
  "scripts/upload-npm.ts": readFileSync(path.join(packageDir, "scripts", "upload-npm.ts"), "utf8"),
};
for (const name of new Bun.Glob("*.ts").scanSync(path.join(packageDir, "src"))) {
  sources[`src/${name}`] = readFileSync(path.join(packageDir, "src", name), "utf8");
}

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

function serveAssets(downloaded: string[]) {
  return Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(request) {
      const bin = path.posix.basename(new URL(request.url).pathname, ".zip");
      downloaded.push(bin);
      return new Response(bin);
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

async function uploadNpm(cwd: string, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), path.join("scripts", "upload-npm.ts"), version, ...args],
    cwd,
    env: bunEnv,
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

test.concurrent("builds the host's packages from the release assets", async () => {
  const downloaded: string[] = [];
  using server = serveAssets(downloaded);
  const bins = platforms.map(({ bin }) => bin);
  using dir = releaseDir("complete", assetsOn(server, bins));
  const cwd = String(dir);

  const { stderr, exitCode } = await uploadNpm(cwd);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);

  expect(downloaded).toEqual(host.map(({ bin }) => bin));
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
});

test.concurrent("fails before building anything when a selected platform has no asset", async () => {
  const downloaded: string[] = [];
  using server = serveAssets(downloaded);
  const [absent] = host;
  const bins = platforms.filter(platform => platform !== absent).map(({ bin }) => bin);
  using dir = releaseDir("incomplete", assetsOn(server, bins));
  const cwd = String(dir);

  const { stderr, exitCode } = await uploadNpm(cwd);
  expect(stderr).toContain(missingPrefix);
  expect(missingAssets(stderr)).toEqual([`${absent.bin}.zip`]);
  expect(exitCode).toBe(1);

  expect(downloaded).toEqual([]);
  expect(existsSync(path.join(cwd, "npm"))).toBe(false);
});

test.concurrent("publish checks every platform in platform.ts for an asset", async () => {
  // With no assets at all there is never a package directory for `npm publish` to
  // run in, so this stays harmless even if the check it exercises were missing.
  using dir = releaseDir("publish", []);
  const cwd = String(dir);

  const { stderr, exitCode } = await uploadNpm(cwd, "publish");
  expect(stderr).toContain(missingPrefix);
  expect(missingAssets(stderr)).toEqual(platforms.map(({ bin }) => `${bin}.zip`));
  expect(exitCode).toBe(1);

  expect(existsSync(path.join(cwd, "npm"))).toBe(false);
});
