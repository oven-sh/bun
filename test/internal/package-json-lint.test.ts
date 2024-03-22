import { test, expect, describe } from "bun:test";
import { join } from "path";
import { readdirSync, existsSync } from "fs";
const base = join(import.meta.dir, "../");

const packageJSONDirs = [
  base,
  ...readdirSync(join(import.meta.dir, "../", "js", "third_party"))
    .map(a => join(import.meta.dir, "../", "js", "third_party", a))
    .filter(a => existsSync(join(a, "./package.json"))),
];

// For test reliability and security reasons
// We must use exact versions for third-party dependencies in our tests.
describe("package.json dependencies must be exact versions", async () => {
  for (const dir of packageJSONDirs) {
    test(join("test", dir.replace(base, ""), "package.json"), async () => {
      const {
        dependencies = {},
        devDependencies = {},
        peerDependencies = {},
        optionalDependencies = {},
      } = await Bun.file(join(dir, "./package.json")).json();

      for (const [name, dep] of Object.entries(dependencies)) {
        expect(dep).toMatch(/^([a-zA-Z0-9\.])+$/);
      }

      for (const [name, dep] of Object.entries(devDependencies)) {
        expect(dep).toMatch(/^([a-zA-Z0-9\.])+$/);
      }

      for (const [name, dep] of Object.entries(peerDependencies)) {
        expect(dep).toMatch(/^([a-zA-Z0-9\.])+$/);
      }

      for (const [name, dep] of Object.entries(optionalDependencies)) {
        expect(dep).toMatch(/^([a-zA-Z0-9\.])+$/);
      }
    });
  }
});
