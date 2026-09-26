// src/runtime/cli/install.sh and `bun upgrade` (src/runtime/cli/upgrade_command.rs)
// each carry a list of programs that can extract the release zip. Nothing
// imports one from the other, so they have to say the same thing.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "../../..");
const installSh = readFileSync(join(root, "src/runtime/cli/install.sh"), "utf8");
const upgradeRs = readFileSync(join(root, "src/runtime/cli/upgrade_command.rs"), "utf8");

function shellExtractors(): string[] {
  const probe = /^for cmd in (.+); do$/m.exec(installSh);
  expect(probe).not.toBeNull();
  return probe![1].split(/\s+/);
}

function rustExtractors(): string[] {
  const table = /const UNZIP_PROGRAMS: &\[UnzipProgram\] = &\[([\s\S]*?)\n\];/.exec(upgradeRs);
  expect(table).not.toBeNull();
  return [...table![1].matchAll(/bin: b"([^"]+)"/g)].map(match => match[1]);
}

test("install.sh probes the extractors that bun upgrade probes, in the same order", () => {
  expect(shellExtractors()).toEqual(rustExtractors());
});

test("install.sh has a case arm for every extractor it probes", () => {
  const extract = /^case \$unzip_cmd in\n([\s\S]*?)^esac/m.exec(installSh);
  expect(extract).not.toBeNull();
  const arms = [...extract![1].matchAll(/^([^\s)]+(?: \| [^\s)]+)*)\)$/gm)].flatMap(match => match[1].split(" | "));
  expect(arms).toEqual(shellExtractors());
});

test("install.sh and bun upgrade name the same supported extractors in their error", () => {
  const suffix = /\(([^()]+) supported\)/;
  const shell = suffix.exec(installSh);
  const rust = suffix.exec(upgradeRs);
  expect(shell).not.toBeNull();
  expect(rust).not.toBeNull();
  expect(shell![1]).toBe(rust![1]);
});
