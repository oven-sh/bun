// scripts/build/ci-images/spec.ts is where the versions of CI's tools and the
// places they go are written. Some files cannot import it: other programs read
// them, or they run somewhere the spec is not. They have to say the same thing.
import { expect, test } from "bun:test";
import { tempDir } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { linuxAgentPaths } from "../../../scripts/agent.ts";
import { generateImage, images, locations, pins } from "../../../scripts/build/ci-images/spec.ts";
import { nodeGypCacheDirectory, nodeGypCacheProblems } from "../../../scripts/node-gyp-cache.ts";

const root = join(import.meta.dir, "../../..");

test("rust-toolchain.toml is the toolchain the CI images install", () => {
  const { toolchain } = Bun.TOML.parse(readFileSync(join(root, "rust-toolchain.toml"), "utf8")) as {
    toolchain: { channel: string; components: string[]; targets: string[] };
  };
  expect(toolchain.channel).toBe(pins.rust.channel);
  expect(toolchain.components.toSorted()).toEqual([...pins.rust.components].sort());
  expect(toolchain.targets.toSorted()).toEqual([...pins.rust.targets].sort());
});

test("the workflows install the Bun the CI images install", () => {
  const workflows = join(root, ".github/workflows");
  const versions = readdirSync(workflows).flatMap(name =>
    [
      ...readFileSync(join(workflows, name), "utf8").matchAll(/^\s*(?:BUN_VERSION|bun-version): "?(\d+\.\d+\.\d+)"?/gm),
    ].map(match => `${name}: ${match[1]}`),
  );
  expect(versions.length).toBeGreaterThan(0);
  expect(versions.filter(version => !version.endsWith(`: ${pins.bun.version}`))).toEqual([]);
});

test("the workflows that pin a nightly pin the one the CI images install", () => {
  const workflows = join(root, ".github/workflows");
  const nightlies = readdirSync(workflows)
    .filter(name => name.endsWith(".yml"))
    .flatMap(name =>
      [...readFileSync(join(workflows, name), "utf8").matchAll(/^\s*RUSTUP_TOOLCHAIN: (nightly-\S+)/gm)].map(
        match => `${name}: ${match[1]}`,
      ),
    );
  expect(nightlies.length).toBeGreaterThan(0);
  expect(nightlies.filter(nightly => !nightly.endsWith(`: ${pins.rust.channel}`))).toEqual([]);
});

test("the format workflow uses the LLVM the CI images install", () => {
  const workflow = readFileSync(join(root, ".github/workflows/format.yml"), "utf8");
  expect(workflow).toContain(`LLVM_VERSION: "${pins.llvm.version}"`);
  expect(workflow).toContain(`LLVM_VERSION_MAJOR: "${pins.llvm.version.split(".")[0]}"`);
});

test("scripts/darwin-ci, which is copied to its hosts, names the agent and the LLVM the spec pins", () => {
  const config = readFileSync(join(root, "scripts/darwin-ci/lib/config.ts"), "utf8");
  expect(config).toContain(`buildkiteAgent: { version: "${pins.buildkiteAgent.version}"`);
  expect(config).toContain(`"clang-${pins.llvm.version.split(".")[0]}"`);
});

test("scripts/agent.ts, which runs on the machines alone, puts the spec's Rust directory on a Mac's PATH", () => {
  expect(readFileSync(join(root, "scripts/agent.ts"), "utf8")).toContain(`<string>${locations.rust.darwin}/bin:`);
});

// node-gyp's cache is baked for the account that runs jobs, which is not the one that runs a bake.
// scripts/runner.node.ts asks scripts/node-gyp-cache.ts about it before a job's first test.

/** The lines of an image's bake script from the first that names `directory` to the `end` of the last file written there. */
function linesWritingTo(image: (typeof images)[number], root: string, directory: string, end: string): string[] {
  const script = join(generateImage(image, root).directory, image.os === "windows" ? "bootstrap.ps1" : "bootstrap.sh");
  const lines = readFileSync(script, "utf8").split("\n");
  const first = lines.findIndex(line => line.includes(directory));
  const last = lines.findLastIndex(line => line.includes(directory));
  return first < 0 ? [] : lines.slice(first, lines.indexOf(end, last) + 1);
}

test("a Windows bake writes node-gyp's cache where a job's node-gyp looks, in the profile of SYSTEM", () => {
  using dir = tempDir("ci-image-pins", {});
  // What a Windows test job prints for USERPROFILE and LOCALAPPDATA.
  const profile = "C:\\Windows\\system32\\config\\systemprofile";
  const read = nodeGypCacheDirectory({
    isWindows: true,
    homedir: profile,
    env: { LOCALAPPDATA: `${profile}\\AppData\\Local` },
  });
  const cache = `C:\\Windows\\System32\\config\\systemprofile\\AppData\\Local\\node-gyp\\Cache\\${pins.nodejs.version}`;
  // Windows does not tell the two spellings of System32 apart.
  expect(read.toLowerCase()).toBe(cache.toLowerCase());
  const written = (["x64", "aarch64"] as const).map(arch =>
    linesWritingTo(images.find(image => image.os === "windows" && image.arch === arch)!, String(dir), cache, ")"),
  );
  expect(written).toEqual(
    ["x64", "arm64"].map(arch => [
      `New-Item -ItemType Directory -Force '${cache}' | Out-Null`,
      `Copy-Item "$scratch\\headers\\include" '${cache}' -Recurse -Force`,
      `New-Item -ItemType Directory -Force '${cache}\\${arch}' | Out-Null`,
      `Copy-Item "$scratch\\node.lib" '${cache}\\${arch}\\node.lib' -Recurse -Force`,
      `Set-Content -Path '${cache}\\installVersion' -Encoding ascii -Value @(`,
      `  '${pins.nodejs.nodeGypInstallVersion}'`,
      ")",
    ]),
  );
});

test("a Linux bake writes node-gyp's cache where a job's node-gyp looks, in the home of the agent's user", () => {
  using dir = tempDir("ci-image-pins", {});
  const cache = nodeGypCacheDirectory({ isWindows: false, homedir: linuxAgentPaths.homePath, env: {} });
  // Node.js for glibc and for musl come from two places. The cache is the same.
  const linux = (["debian", "alpine"] as const).map(
    distro => images.find(image => image.os === "linux" && image.distro === distro)!,
  );
  expect(linux.map(image => linesWritingTo(image, String(dir), cache, "EOF"))).toEqual(
    linux.map(() => [
      `mkdir -p ${cache}`,
      `cp -R "$scratch/headers/include" ${cache}`,
      `cat > ${cache}/installVersion <<'EOF'`,
      pins.nodejs.nodeGypInstallVersion,
      "EOF",
    ]),
  );
});

test("node-gyp's cache is looked for where node-gyp keeps it by default", () => {
  const { version } = pins.nodejs;
  expect([
    nodeGypCacheDirectory({ isWindows: false, homedir: "/home/ci", env: {} }),
    nodeGypCacheDirectory({ isWindows: false, homedir: "/home/ci", env: { XDG_CACHE_HOME: "/cache" } }),
    nodeGypCacheDirectory({ isWindows: true, homedir: "C:\\Users\\ci", env: {} }),
    nodeGypCacheDirectory({ isWindows: true, homedir: "C:\\Users\\ci", env: { LOCALAPPDATA: "D:\\Local" } }),
  ]).toEqual([
    `/home/ci/.cache/node-gyp/${version}`,
    `/cache/node-gyp/${version}`,
    `C:\\Users\\ci\\AppData\\Local\\node-gyp\\Cache\\${version}`,
    `D:\\Local\\node-gyp\\Cache\\${version}`,
  ]);
});

test("what is missing from node-gyp's cache is named", () => {
  const installVersion = pins.nodejs.nodeGypInstallVersion;
  using dir = tempDir("ci-image-pins", {
    // PowerShell's Set-Content ends the line with CRLF.
    "complete/installVersion": `${installVersion}\r\n`,
    "complete/include/node/node_api.h": "",
    "complete/arm64/node.lib": "",
    "headers/installVersion": `${installVersion}\n`,
    "headers/include/node/node_api.h": "",
    "older/installVersion": "9\n",
    "older/include/node/node_api.h": "",
    "older/arm64/node.lib": "",
  });
  const problems = (name: string, isWindows: boolean) =>
    nodeGypCacheProblems(join(String(dir), name), { isWindows, arch: "arm64" });
  expect({
    "complete, Windows": problems("complete", true),
    "complete, Linux": problems("complete", false),
    "no node.lib, Linux": problems("headers", false),
    "no node.lib, Windows": problems("headers", true),
    "installVersion of an older node-gyp": problems("older", true),
    "no directory": problems("absent", true),
  }).toEqual({
    "complete, Windows": [],
    "complete, Linux": [],
    "no node.lib, Linux": [],
    "no node.lib, Windows": ["arm64/node.lib is missing"],
    "installVersion of an older node-gyp": [`installVersion is 9, the bake writes ${installVersion}`],
    "no directory": ["installVersion is missing", "include/node/node_api.h is missing", "arm64/node.lib is missing"],
  });
});

test("the Node-API tests build against the headers of the Node.js the CI images install, with their clang", () => {
  const harness = readFileSync(join(root, "test/napi/node-napi-tests/harness.ts"), "utf8");
  expect(harness).toContain(`const NODE_HEADERS_VERSION = "${pins.nodejs.version}";`);
  const major = pins.llvm.version.split(".")[0];
  expect(harness).toContain(`? "${locations.llvm}/bin/clang" : "/usr/lib/llvm${major}/bin/clang";`);
});
