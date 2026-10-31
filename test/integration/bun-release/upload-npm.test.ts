import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "path";
import { describePlatform, platforms } from "../../../packages/bun-release/src/platform";

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
// Without an action argument the script builds (but does not publish) the packages
// whose platform matches the machine it runs on.
const host = platforms.filter(({ os, arch }) => os === process.platform && arch === process.arch);

test.concurrent("each platform package is described as its own platform's binary", async () => {
  const downloaded: string[] = [];
  using server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(request) {
      const bin = path.posix.basename(new URL(request.url).pathname, ".zip");
      downloaded.push(bin);
      return new Response(bin);
    },
  });
  using dir = tempDir("bun-release-descriptions", {
    ...sources,
    ...stubs,
    "release.json": JSON.stringify({
      tag_name: `bun-v${version}`,
      assets: platforms.map(({ bin }) => ({
        name: `${bin}.zip`,
        browser_download_url: new URL(`/${bin}.zip`, server.url).href,
      })),
    }),
  });
  const cwd = String(dir);

  await using proc = Bun.spawn({
    cmd: [bunExe(), path.join("scripts", "upload-npm.ts"), version],
    cwd,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });

  expect(host).not.toBeEmpty();
  expect(downloaded).toEqual(host.map(({ bin }) => bin));
  // On a linux-x64 host this covers the glibc and musl packages and their baseline
  // aliases, so the abi has to make it into the description as well as the os and arch.
  for (const platform of host) {
    const { bin, os, arch } = platform;
    const manifest = path.join(cwd, "npm", "@oven", bin, "package.json");
    expect(JSON.parse(readFileSync(manifest, "utf8"))).toMatchObject({
      name: `@oven/${bin}`,
      version,
      description: `This is the ${describePlatform(platform)} binary for Bun, a fast all-in-one JavaScript runtime.`,
      os: [os],
      cpu: [arch],
    });
  }
});
