import { describe, expect, test } from "bun:test";
import { buildSync } from "esbuild";
import { chmodSync, existsSync, readdirSync, readFileSync } from "fs";
import { bunEnv, bunExe, isWindows, nodeExe, tempDir, type DirectoryTree } from "harness";
import path from "path";
import { gzipSync } from "zlib";
import { supportedPlatforms } from "../../../packages/bun-release/src/platform";

// The `bun` npm package's postinstall, bundled with esbuild as upload-npm.ts does, run in a
// project that installed bun without its optionalDependencies: node_modules/bun holds the
// package and the platform package @oven/<bin> is missing. The script then has to get the
// platform package with `npm install`, and failing that, by downloading its tarball from the
// registry. npm runs the script with node; `bun install` on a machine without node runs it
// with bun standing in for node; so it is run with both.
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

// The script runs the installed binary with --version, so the fixture binary has to be
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
  // Stored rather than deflated: on Windows the payload is bun.exe, and compressing it would
  // take longer than everything else in this file.
  return gzipSync(Buffer.concat(blocks), { level: 0 });
}

const tgz = tarball({ "package.json": JSON.stringify({ name: pkg, version }), [platform.exe]: binary });

// installBun() runs `npm install <pkg>@<version>` in a scratch directory and moves
// node_modules/<pkg> out of it. These stand in for npm there: a script for the runtime under
// test (PATH holds nothing but fake-bin), which on Windows is reached through an npm.cmd, the
// way the real npm is.
function fakeNpm(runtime: string, script: (root: string) => string): DirectoryTree {
  return {
    "fake-bin/npm": ({ root }) => `#!${runtime}\n${script(root)}`,
    "fake-bin/npm.cmd": `@"${runtime.replaceAll("/", "\\")}" "%~dp0npm" %*\r\n`,
  };
}
function failingNpm(runtime: string): DirectoryTree {
  return fakeNpm(runtime, () => `console.error("npm ERR! code E404");\nprocess.exit(1);\n`);
}
// Installs <root>/binary as the package and records how it was invoked in <root>/npm-call.json.
function installingNpm(runtime: string): DirectoryTree {
  const exe = path.posix.join("node_modules", pkg, platform.exe);
  return {
    "binary": binary,
    ...fakeNpm(
      runtime,
      root => `const fs = require("fs");
fs.writeFileSync(
  ${JSON.stringify(path.join(root, "npm-call.json"))},
  JSON.stringify({ cwd: process.cwd(), argv: process.argv.slice(2), global: "npm_config_global" in process.env }),
);
fs.mkdirSync(${JSON.stringify(path.posix.dirname(exe))}, { recursive: true });
fs.copyFileSync(${JSON.stringify(path.join(root, "binary"))}, ${JSON.stringify(exe)});
fs.chmodSync(${JSON.stringify(exe)}, 0o755);
`,
    ),
  };
}
const npmInstallArgs = [
  "install",
  "--loglevel=error",
  "--prefer-offline",
  "--no-audit",
  "--progress=false",
  `${pkg}@${version}`,
];

// The script gets PATH pointing at fake-bin only. The inherited PATH has to be removed rather
// than shadowed: on Windows process.env spells it `Path`, and Bun.spawn gives the child the
// first of two keys differing only in case. The other variables are the ones console.ts
// changes the script's output on. npm_config_global is what `npm install -g bun` runs the
// script with, and what installBun() must not pass on to its own `npm install`.
const scriptEnv = Object.fromEntries(
  Object.entries(bunEnv).filter(
    ([key]) => !["PATH", "DEBUG", "LOG_LEVEL", "RUNNER_DEBUG", "GITHUB_ACTION"].includes(key.toUpperCase()),
  ),
);
scriptEnv.npm_config_global = "true";

async function postinstall(runtime: string, name: string, options: { npm?: DirectoryTree; tarball?: Buffer }) {
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
  const bunPackageDir = path.join(root, "node_modules", "bun");
  if (options.npm) chmodSync(path.join(root, "fake-bin", "npm"), 0o755);
  await using proc = Bun.spawn({
    cmd: [runtime, "-r", "./fetch.cjs", "install.js"],
    cwd: bunPackageDir,
    env: { ...scriptEnv, PATH: path.join(root, "fake-bin") },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const npmCallFile = path.join(root, "npm-call.json");
  const npmCall = existsSync(npmCallFile) ? JSON.parse(readFileSync(npmCallFile, "utf8")) : undefined;
  return {
    stdout,
    stderr,
    exitCode,
    bin: readFileSync(path.join(bunPackageDir, "bin", "bun.exe")),
    // Everything the script left in its own directory, so a scratch directory would show up.
    files: readdirSync(bunPackageDir).sort(),
    // installingNpm()'s record, with npm's cwd made relative to the script's directory.
    npmCall: npmCall && { ...npmCall, cwd: path.relative(bunPackageDir, npmCall.cwd) },
  };
}

const notFound = `Failed to find package "${pkg}". You may have used the "--no-optional" flag when running "npm install".`;
const npmFailed = `Failed to install package "${pkg}" using "npm install".`;
// installBun() prints npm's output (the fake's one line) before requireBun() reports the failure.
const npmFailedOutput = `${notFound}\nnpm ERR! code E404\n\n${npmFailed}`;

const runtimes = [
  // spawnError: how each runtime's spawnSync() describes a missing npm, which installBun()
  // prints in that case. On Windows it is the shell that reports it instead.
  { name: "node", exe: nodeExe(), spawnError: "spawnSync npm ENOENT" },
  { name: "bun", exe: bunExe(), spawnError: 'Executable not found in $PATH: "npm"' },
];

for (const { name, exe, spawnError } of runtimes) {
  const runtime = exe!;
  const npmMissing = isWindows ? "'npm' is not recognized" : spawnError;
  describe.skipIf(!exe).concurrent(`bun npm package postinstall run with ${name}`, () => {
    test('downloads the tarball from the registry when "npm install" fails', async () => {
      const { stdout, stderr, exitCode, bin, files } = await postinstall(runtime, `${name}-download`, {
        npm: failingNpm(runtime),
        tarball: tgz,
      });
      expect(stderr).toStartWith(npmFailedOutput);
      expect(stderr).not.toContain("Failed to download");
      expect(stdout).toBe(`fetch ${tarballUrl(platform)}\n`);
      expect(bin.equals(binary)).toBe(true);
      expect(files).toEqual(["bin", "bun.tgz", "fetch.cjs", "install.js", "node_modules"]);
      expect(exitCode).toBe(0);
    });

    test("downloads the tarball from the registry when npm is not installed", async () => {
      const { stdout, stderr, exitCode, bin, files } = await postinstall(runtime, `${name}-no-npm`, { tarball: tgz });
      expect(stderr).toStartWith(`${notFound}\n${npmMissing}`);
      expect(stderr).toContain(npmFailed);
      expect(stderr).not.toContain("Failed to download");
      expect(stdout).toBe(`fetch ${tarballUrl(platform)}\n`);
      expect(bin.equals(binary)).toBe(true);
      expect(files).toEqual(["bin", "bun.tgz", "fetch.cjs", "install.js", "node_modules"]);
      expect(exitCode).toBe(0);
    });

    test('fails and reports both attempts when "npm install" and the download fail', async () => {
      const { stdout, stderr, exitCode, bin, files } = await postinstall(runtime, `${name}-neither`, {
        npm: failingNpm(runtime),
      });
      expect(stderr).toStartWith(npmFailedOutput);
      for (const { bin } of supportedPlatforms) {
        expect(stderr).toContain(`Failed to find package "@oven/${bin}".`);
        expect(stderr).toContain(`Failed to install package "@oven/${bin}" using "npm install".`);
        expect(stderr).toContain(`Failed to download package "@oven/${bin}" from "registry.npmjs.org".`);
      }
      expect(stderr).toContain('Failed to install package "bun"');
      expect(stdout).toBe(supportedPlatforms.map(platform => `fetch ${tarballUrl(platform)}\n`).join(""));
      expect(bin.toString()).toBe("placeholder");
      expect(files).toEqual(["bin", "fetch.cjs", "install.js"]);
      expect(exitCode).toBe(1);
    });

    test('uses the package "npm install" installed without downloading', async () => {
      const { stdout, stderr, exitCode, bin, files, npmCall } = await postinstall(runtime, `${name}-npm`, {
        npm: installingNpm(runtime),
        tarball: tgz,
      });
      expect(stderr).toBe(`${notFound}\n`);
      expect(stdout).toBe("");
      expect(bin.equals(binary)).toBe(true);
      expect(npmCall).toEqual({
        // A scratch directory directly inside the script's own directory, so on the same file
        // system as the node_modules the package is moved to.
        cwd: expect.stringMatching(/^bun-[^/\\]+$/),
        argv: npmInstallArgs,
        global: false,
      });
      // The scratch directory is gone again.
      expect(files).toEqual(["bin", "bun.tgz", "fetch.cjs", "install.js", "node_modules"]);
      expect(exitCode).toBe(0);
    });
  });
}
