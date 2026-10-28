// scripts/build/ci-images/spec.ts is where the versions of CI's tools and the
// places they go are written. Some files cannot import it: other programs read
// them, or they run somewhere the spec is not. They have to say the same thing.
import { expect, test } from "bun:test";
import { tempDir } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { generateImage, images, locations, pins } from "../../../scripts/build/ci-images/spec.ts";

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

// A job runs as SYSTEM, and its node-gyp reads %LOCALAPPDATA%\node-gyp\Cache of that account. A bake
// runs as another user. scripts/runner.node.ts checks the directory on the machine (assertNodeGypCache).
test("a Windows bake writes node-gyp's cache into the profile of SYSTEM, the account that runs jobs", () => {
  using dir = tempDir("ci-image-pins", {});
  const cache = `C:\\Windows\\System32\\config\\systemprofile\\AppData\\Local\\node-gyp\\Cache\\${pins.nodejs.version}`;
  const written = (["x64", "aarch64"] as const).map(arch => {
    const image = images.find(image => image.os === "windows" && image.arch === arch)!;
    const { directory } = generateImage(image, String(dir));
    return readFileSync(join(directory, "bootstrap.ps1"), "utf8")
      .split("\n")
      .filter(line => line.includes(cache));
  });
  expect(written).toEqual(
    ["x64", "arm64"].map(arch => [
      `New-Item -ItemType Directory -Force '${cache}' | Out-Null`,
      `Copy-Item "$scratch\\headers\\include" '${cache}' -Recurse -Force`,
      `New-Item -ItemType Directory -Force '${cache}\\${arch}' | Out-Null`,
      `Copy-Item "$scratch\\node.lib" '${cache}\\${arch}\\node.lib' -Recurse -Force`,
      `Set-Content -Path '${cache}\\installVersion' -Encoding ascii -Value @(`,
    ]),
  );
});

test("the Node-API tests build against the headers of the Node.js the CI images install, with their clang", () => {
  const harness = readFileSync(join(root, "test/napi/node-napi-tests/harness.ts"), "utf8");
  expect(harness).toContain(`const NODE_HEADERS_VERSION = "${pins.nodejs.version}";`);
  const major = pins.llvm.version.split(".")[0];
  expect(harness).toContain(`? "${locations.llvm}/bin/clang" : "/usr/lib/llvm${major}/bin/clang";`);
});
