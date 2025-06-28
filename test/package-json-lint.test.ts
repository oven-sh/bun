import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "fs";
import { join } from "path";
const base = join(import.meta.dir, "../");

const packageJSONDirs = [
  join(base, "test"),
  ...readdirSync(join(import.meta.dir, "js", "third_party"))
    .map(a => join(import.meta.dir, "js", "third_party", a))
    .filter(a => existsSync(join(a, "./package.json"))),
];

// For test reliability and security reasons
// We must use exact versions for third-party dependencies in our tests.
describe("package.json dependencies must be exact versions", async () => {
  for (const dir of packageJSONDirs) {
    test(join(dir.replace(base, ""), "package.json"), async () => {
      const {
        dependencies = {},
        devDependencies = {},
        peerDependencies = {},
        optionalDependencies = {},
      } = await Bun.file(join(dir, "./package.json")).json();

      // Hyphen is necessary to accept prerelease versions like "1.1.3-alpha.7"
      // This regex still forbids semver ranges like "1.0.0 - 1.2.0", as those must have spaces
      // around the hyphen.
      const okRegex = /^(([a-zA-Z0-9\.\-]|)+$|file:)/;

      for (const [name, dep] of Object.entries(dependencies)) {
        expect(dep, `dependency ${name} specifies non-exact version "${dep}"`).toMatch(okRegex);
      }

      for (const [name, dep] of Object.entries(devDependencies)) {
        expect(dep, `dev dependency ${name} specifies non-exact version "${dep}"`).toMatch(okRegex);
      }

      for (const [name, dep] of Object.entries(peerDependencies)) {
        expect(dep, `peer dependency ${name} specifies non-exact version "${dep}"`).toMatch(okRegex);
      }

      for (const [name, dep] of Object.entries(optionalDependencies)) {
        expect(dep, `optional dependency ${name} specifies non-exact version "${dep}"`).toMatch(okRegex);
      }
    });
  }
});
