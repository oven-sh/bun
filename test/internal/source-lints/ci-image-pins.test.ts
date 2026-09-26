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

test("scripts/agent.ts starts the agent after the docker service an Alpine image enables", () => {
  using dir = tempDir("ci-image-pins", {});
  const image = images.find(image => image.os === "linux" && image.distro === "alpine")!;
  const bootstrap = readFileSync(join(generateImage(image, String(dir)).directory, "bootstrap.sh"), "utf8");
  // `rc-update add` is a link to the service in the runlevel's directory.
  expect(bootstrap.split("\n")).toContain("rc-update add docker default");

  const agent = readFileSync(join(root, "scripts/agent.ts"), "utf8");
  const [, depend] = agent.match(/^ *depend\(\) \{\n([^}]*)\}/m)!;
  expect(depend.split("\n").map(line => line.trim())).toContain("after docker");
  expect(agent).toContain('const openRcDockerService = "/etc/runlevels/default/docker";');
});

test("the Node-API tests build against the headers of the Node.js the CI images install", () => {
  const harness = readFileSync(join(root, "test/napi/node-napi-tests/harness.ts"), "utf8");
  expect(harness).toContain(`const NODE_HEADERS_VERSION = "${pins.nodejs.version}";`);
});
