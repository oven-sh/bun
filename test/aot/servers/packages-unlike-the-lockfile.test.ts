import { expect, test } from "bun:test";
import { tempDir } from "harness";
import { join } from "path";
import { packagesUnlikeLockfile } from "./run-servers";

test("a folder of packages is held against the lockfile by name and version", () => {
  using folder = tempDir("aot-servers-lockfile", {
    "bun.lock": `{
      "lockfileVersion": 2,
      "packages": {
        "same": ["same@1.0.0", "", {}, "sha512-a"],
        "older": ["older@2.1.0", "", {}, "sha512-b"],
        "absent": ["absent@3.0.0", "", {}, "sha512-c"],
        "@scope/name": ["@scope/name@4.0.0", "", {}, "sha512-d"],
        "@scope/name/nested": ["nested@5.0.1", "", {}, "sha512-e"],
        "same/inner/@scope/deep": ["@scope/deep@6.0.0", "", {}, "sha512-f"],
      },
    }`,
    "node_modules/same/package.json": `{ "version": "1.0.0" }`,
    "node_modules/older/package.json": `{ "version": "2.0.9" }`,
    "node_modules/@scope/name/package.json": `{ "version": "4.0.0" }`,
    "node_modules/@scope/name/node_modules/nested/package.json": `{ "version": "5.0.0" }`,
    "node_modules/same/node_modules/inner/node_modules/@scope/deep/package.json": `{ "version": "6.0.0" }`,
  });
  expect(packagesUnlikeLockfile(join(String(folder), "bun.lock"), join(String(folder), "node_modules"))).toEqual([
    "older: the lockfile has 2.1.0, the folder has 2.0.9",
    "absent: the lockfile has 3.0.0, the folder has nothing",
    "@scope/name/nested: the lockfile has 5.0.1, the folder has 5.0.0",
  ]);
});
