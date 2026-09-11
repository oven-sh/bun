import { expect, test } from "bun:test";
import { readFileSync } from "fs";
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
// Without a "publish" action the script builds the root package and the packages for the machine it runs on.
const host = platforms.filter(({ os, arch }) => os === process.platform && arch === process.arch);
const names = ["bun", ...host.map(({ bin }) => `@oven/${bin}`)];

function serveAssets() {
  return Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(request) {
      return new Response(path.posix.basename(new URL(request.url).pathname, ".zip"));
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

async function uploadNpm(cwd: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), path.join(cwd, "scripts", "upload-npm.ts"), version],
    cwd,
    // src/console.ts adds debug output to stdout under any of these.
    env: { ...bunEnv, GITHUB_ACTION: undefined, DEBUG: undefined, LOG_LEVEL: undefined, RUNNER_DEBUG: undefined },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

function readPackageJson(cwd: string, name: string) {
  return JSON.parse(readFileSync(path.join(cwd, "npm", name, "package.json"), "utf8"));
}

test("the root package and every platform package link to the project's homepage, issue tracker and repository", async () => {
  using server = serveAssets();
  const bins = platforms.map(({ bin }) => bin);
  using dir = releaseDir("links", assetsOn(server, bins));
  const cwd = String(dir);

  expect(host).not.toBeEmpty();
  expect(await uploadNpm(cwd)).toEqual({
    stdout: names.map(name => `Building: ${name}@${version}\n`).join(""),
    stderr: "",
    exitCode: 0,
  });

  // npm shows these on the package pages and `npm bugs bun` / `npm repo bun` open them,
  // so `bun` and every `@oven/bun-*` package must carry the same URLs, and they must exist.
  const links = {
    homepage: "https://bun.com",
    bugs: "https://github.com/oven-sh/bun/issues",
    license: "MIT",
    repository: "https://github.com/oven-sh/bun",
  };
  const built = Object.fromEntries(
    names.map(name => {
      const { homepage, bugs, license, repository } = readPackageJson(cwd, name);
      return [name, { homepage, bugs, license, repository }];
    }),
  );
  expect(built).toEqual(Object.fromEntries(names.map(name => [name, links])));
});
