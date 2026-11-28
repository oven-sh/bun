// scripts/build/ci-images/spec.ts is where the versions of CI's tools and the
// places they go are written. Some files cannot import it: other programs read
// them, or they run somewhere the spec is not. They have to say the same thing.
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { nightlyPlist } from "../../../scripts/agent.ts";
import { locations, pins } from "../../../scripts/build/ci-images/spec.ts";

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

// Not a pin. The nightly wipes the machine it runs on and reboots it, so no test runs it: its text is read.
test("scripts/agent.ts: a Mac's nightly waits for the agent's job and unloads the agent before it wipes and reboots", () => {
  const plist = nightlyPlist("/Users/administrator/Library/Services/buildkite-agent", "administrator");
  const script = plist.slice(plist.indexOf("<![CDATA[") + "<![CDATA[".length, plist.indexOf("]]>"));
  expect(script.split("\n")).toEqual([
    "PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
    `BASE_PREFIX=$([ "$(uname -m)" = "arm64" ] && echo "/opt/homebrew" || echo "/usr/local")`,
    "if pkill -TERM -f '[b]uildkite-agent start'; then",
    "  sleep 2",
    "  waited=2",
    "  while pgrep -f '[b]uildkite-agent start' >/dev/null && [ $waited -lt 3900 ]; do",
    "    sleep 10",
    "    waited=$((waited + 10))",
    "  done",
    "fi",
    "launchctl bootout system/buildkite-agent",
    "if pkill -QUIT -f '[b]uildkite-agent start'; then",
    "  waited=0",
    "  while pgrep -x buildkite-agent >/dev/null && [ $waited -lt 60 ]; do",
    "    sleep 5",
    "    waited=$((waited + 5))",
    "  done",
    "fi",
    "if ! pgrep -x buildkite-agent >/dev/null; then",
    "  { rm -rf $BASE_PREFIX/{var,etc}/buildkite-agent/{builds,cache}/* /Users/administrator/Library/Services/buildkite-agent/{builds,cache}/* /tmp/* /var/tmp/* || true; } &&",
    "  { chown -R administrator:admin $BASE_PREFIX/var/buildkite-agent $BASE_PREFIX/etc/buildkite-agent || true; } &&",
    "  { chmod -R 755 $BASE_PREFIX/var/buildkite-agent $BASE_PREFIX/etc/buildkite-agent || true; }",
    "fi",
    "shutdown -r now || reboot",
    "sleep 600",
    "launchctl bootstrap system /Library/LaunchDaemons/buildkite-agent.plist",
  ]);
});

test("the Node-API tests build against the headers of the Node.js the CI images install, with their clang", () => {
  const harness = readFileSync(join(root, "test/napi/node-napi-tests/harness.ts"), "utf8");
  expect(harness).toContain(`const NODE_HEADERS_VERSION = "${pins.nodejs.version}";`);
  const major = pins.llvm.version.split(".")[0];
  expect(harness).toContain(`? "${locations.llvm}/bin/clang" : "/usr/lib/llvm${major}/bin/clang";`);
});
