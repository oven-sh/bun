import { describe, expect, test } from "bun:test";
import { buildSync } from "esbuild";
import { chmodSync, readFileSync } from "fs";
import { bunEnv, bunExe, isWindows, nodeExe, tempDir, type DirectoryTree } from "harness";
import path from "path";
import { supportedPlatforms } from "../../../packages/bun-release/src/platform";
import { gzipSync } from "zlib";

// The `bun` npm package's postinstall, bundled with esbuild as upload-npm.ts does and run with
// node as npm does, in a project that installed bun without its optionalDependencies:
// node_modules/bun holds the package and the platform package @oven/<bin> is missing. The
// script then has to get the platform package with `npm install`, and failing that, by
// downloading its tarball from the registry.
const node = nodeExe();
const packageDir = path.join(import.meta.dir, "..", "..", "..", "packages", "bun-release");
const version = "1.0.0";
const [platform] = supportedPlatforms;
const pkg = `@oven/${platform.bin}`;
const tarballUrl = ({ bin }: { bin: string }) => `https://registry.npmjs.org/@oven/${bin}/-/${bin}-${version}.tgz`;

const installJs = buildSync({
  entryPoints: [path.join(packageDir, "scripts", "npm-postinstall.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
  define: { version: JSON.stringify(version), module: '"bun"', owner: '"@oven"' },
}).outputFiles[0].text;

// downloadBun() fetches a fixed registry.npmjs.org URL, so fetch is replaced before the
// script runs: it serves the tarball the test put next to the script, or 404s without one.
const fetchCjs = `
const fs = require("fs");
const path = require("path");
globalThis.fetch = async url => {
  console.log("fetch", url);
  const tgz = path.join(__dirname, "bun.tgz");
  return fs.existsSync(tgz) ? new Response(fs.readFileSync(tgz)) : new Response(null, { status: 404 });
};
`;

// resolveBun() runs the installed binary with --version, so the fixture binary has to be
// runnable: a shell script on POSIX, and on Windows (where it is spawned as bin/bun.exe) the
// bun running this test.
const binary: Buffer = isWindows ? readFileSync(bunExe()) : Buffer.from("#!/bin/sh\nexit 0\n");

// downloadBun() reads only the name and size of each tar entry. Like `npm pack`, every
// entry is prefixed with `package/`.
function tarball(files: Record<string, Buffer | string>): Buffer {
  const blocks: Buffer[] = [];
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content);
    const header = Buffer.alloc(512);
    header.write(`package/${name}`, 0);
    header.write(data.length.toString(8).padStart(11, "0"), 124);
    blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

const tgz = tarball({ "package.json": JSON.stringify({ name: pkg, version }), [platform.exe]: binary });

// installBun() runs `npm install <pkg>@<version>` in an empty temporary directory and moves
// node_modules/<pkg> out of it. These stand in for npm there. They are node scripts because
// PATH holds nothing but them. On Windows node cannot spawn `npm` (an npm.cmd) without a shell
// in the first place, so there every `npm install` fails before running anything.
const failingNpm: DirectoryTree = {
  "fake-bin/npm": `#!${node}\nconsole.error("npm ERR! code E404");\nprocess.exit(1);\n`,
};
const installingNpm: DirectoryTree = {
  "binary": binary,
  "fake-bin/npm": ({ root }) => {
    const exe = path.posix.join("node_modules", pkg, platform.exe);
    return `#!${node}
const fs = require("fs");
fs.mkdirSync(${JSON.stringify(path.posix.dirname(exe))}, { recursive: true });
fs.copyFileSync(${JSON.stringify(path.join(root, "binary"))}, ${JSON.stringify(exe)});
fs.chmodSync(${JSON.stringify(exe)}, 0o755);
`;
  },
};

async function postinstall(name: string, options: { npm?: DirectoryTree; tarball?: Buffer }) {
  const bunPackage: DirectoryTree = {
    "install.js": installJs,
    "fetch.cjs": fetchCjs,
    // upload-npm.ts ships placeholders that optimizeBun() replaces with the installed binary.
    "bin/bun.exe": "placeholder",
    "bin/bunx.exe": "placeholder",
  };
  if (options.tarball) bunPackage["bun.tgz"] = options.tarball;
  using dir = tempDir(`bun-npm-postinstall-${name}`, {
    "fake-bin": {},
    ...options.npm,
    "node_modules": { bun: bunPackage },
  });
  const root = String(dir);
  if (options.npm) chmodSync(path.join(root, "fake-bin", "npm"), 0o755);
  await using proc = Bun.spawn({
    cmd: [node!, "-r", "./fetch.cjs", "install.js"],
    cwd: path.join(root, "node_modules", "bun"),
    env: { ...bunEnv, PATH: path.join(root, "fake-bin") },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const bin = readFileSync(path.join(root, "node_modules", "bun", "bin", "bun.exe"));
  return { stdout, stderr, exitCode, bin };
}

const notFound = `Failed to find package "${pkg}". You may have used the "--no-optional" flag when running "npm install".`;
const npmFailed = `Failed to install package "${pkg}" using "npm install".`;

describe.skipIf(!node).concurrent("bun npm package postinstall", () => {
  test('downloads the tarball from the registry when "npm install" fails', async () => {
    const { stdout, stderr, exitCode, bin } = await postinstall("download", { npm: failingNpm, tarball: tgz });
    expect(stderr).toContain(notFound);
    expect(stderr).toContain(npmFailed);
    // The reported error carries npm's output, except on Windows where npm never ran (see failingNpm).
    if (!isWindows) expect(stderr).toContain("npm ERR! code E404");
    expect(stderr).not.toContain("Failed to download");
    expect(stdout).toBe(`fetch ${tarballUrl(platform)}\n`);
    expect(bin.equals(binary)).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("downloads the tarball from the registry when npm is not installed", async () => {
    const { stdout, stderr, exitCode, bin } = await postinstall("no-npm", { tarball: tgz });
    expect(stderr).toContain(notFound);
    expect(stderr).toContain(npmFailed);
    expect(stderr).not.toContain("Failed to download");
    expect(stdout).toBe(`fetch ${tarballUrl(platform)}\n`);
    expect(bin.equals(binary)).toBe(true);
    expect(exitCode).toBe(0);
  });

  test('fails and reports both attempts when "npm install" and the download fail', async () => {
    const { stdout, stderr, exitCode, bin } = await postinstall("neither", { npm: failingNpm });
    for (const { bin } of supportedPlatforms) {
      expect(stderr).toContain(`Failed to find package "@oven/${bin}".`);
      expect(stderr).toContain(`Failed to install package "@oven/${bin}" using "npm install".`);
      expect(stderr).toContain(`Failed to download package "@oven/${bin}" from "registry.npmjs.org".`);
    }
    expect(stderr).toContain('Error: Failed to install package "bun"');
    expect(stdout).toBe(supportedPlatforms.map(platform => `fetch ${tarballUrl(platform)}\n`).join(""));
    expect(bin.toString()).toBe("placeholder");
    expect(exitCode).toBe(1);
  });

  // `npm install` cannot succeed on Windows (see failingNpm).
  test.skipIf(isWindows)('uses the package "npm install" installed without downloading', async () => {
    const { stdout, stderr, exitCode, bin } = await postinstall("npm", { npm: installingNpm, tarball: tgz });
    expect(stderr).toBe(`${notFound}\n`);
    expect(stdout).toBe("");
    expect(bin.equals(binary)).toBe(true);
    expect(exitCode).toBe(0);
  });
});
