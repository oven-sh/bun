// scripts/build/ci-images/spec.ts is where the versions of CI's tools are
// written. Two files cannot import it, because other programs read them; they
// have to say the same thing.
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pins } from "../../../scripts/build/ci-images/spec.ts";

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
