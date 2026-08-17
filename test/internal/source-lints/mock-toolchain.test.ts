/**
 * test/_util/mock-toolchain.ts stands in for a resolved `Toolchain` in the
 * build-script tests. It is typed as a `Toolchain`, so a field added to the
 * interface and not to the mock is a type error, but nothing type-checks the
 * test tree in CI (the per-file copies this helper replaced had been missing
 * `hostCc`/`hostCxx` since those fields were added). Pin the mock's keys to
 * the interface's declared properties at runtime instead.
 */
import { mockToolchain, mockWindowsCrossToolchain } from "_util/mock-toolchain.ts";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The property names declared by `export interface Toolchain` in scripts/build/config.ts. */
function declaredToolchainFields(): string[] {
  const configTs = join(import.meta.dir, "..", "..", "..", "scripts", "build", "config.ts");
  const body = readFileSync(configTs, "utf8").match(/^export interface Toolchain \{\n([\s\S]*?)^\}/m)?.[1];
  if (body === undefined) throw new Error("export interface Toolchain not found in scripts/build/config.ts");
  const withoutComments = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
  return [...withoutComments.matchAll(/^\s+(\w+)\??:/gm)].map(m => m[1]).sort();
}

test("the mock toolchains define exactly the fields Toolchain declares", () => {
  const declared = declaredToolchainFields();
  expect(Object.keys(mockToolchain()).sort()).toEqual(declared);
  expect(Object.keys(mockWindowsCrossToolchain()).sort()).toEqual(declared);
});
