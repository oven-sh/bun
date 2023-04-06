import { it, expect } from "bun:test";
import { mkdirSync, writeFileSync, existsSync, rmSync, copyFileSync } from "fs";
import { join } from "path";
import { bunExe, bunEnv } from "harness";

it("spawn test file", () => {
  writePackageJSONImportsFixture();
  writePackageJSONExportsFixture();

  copyFileSync(join(import.meta.dir, "resolve-test.js"), join(import.meta.dir, "resolve-test.test.js"));

  const { exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "test", "resolve-test.test.js"],
    env: bunEnv,
    cwd: import.meta.dir,
  });

  expect(exitCode).toBe(0);

  rmSync(join(import.meta.dir, "resolve-test.test.js"));
  expect(existsSync(join(import.meta.dir, "resolve-test.test.js"))).toBe(false);
});

function writePackageJSONExportsFixture() {
  try {
    mkdirSync(join(import.meta.dir, "./node_modules/package-json-exports/foo"), {
      recursive: true,
    });
  } catch (exception) {}
  writeFileSync(join(import.meta.dir, "./node_modules/package-json-exports/foo/bar.js"), "export const bar = 1;");
  writeFileSync(
    join(import.meta.dir, "./node_modules/package-json-exports/foo/references-baz.js"),
    "export {bar} from 'package-json-exports/baz';",
  );
  writeFileSync(
    join(import.meta.dir, "./node_modules/package-json-exports/package.json"),
    JSON.stringify(
      {
        name: "package-json-exports",
        exports: {
          "./baz": "./foo/bar.js",
          "./references-baz": "./foo/references-baz.js",
        },
      },
      null,
      2,
    ),
  );
}

function writePackageJSONImportsFixture() {
  try {
    mkdirSync(join(import.meta.dir, "./node_modules/package-json-imports/foo"), {
      recursive: true,
    });
  } catch (exception) {}
  writeFileSync(join(import.meta.dir, "./node_modules/package-json-imports/foo/bar.js"), "export const bar = 1;");
  writeFileSync(
    join(import.meta.dir, "./node_modules/package-json-imports/foo/wildcard.js"),
    "export const wildcard = 1;",
  );
  writeFileSync(
    join(import.meta.dir, "./node_modules/package-json-imports/foo/private-foo.js"),
    "export {bar} from 'package-json-imports/#foo';",
  );
  writeFileSync(
    join(import.meta.dir, "./node_modules/package-json-imports/package.json"),
    JSON.stringify(
      {
        name: "package-json-imports",
        exports: {
          "./baz": "./foo/bar.js",
        },
        imports: {
          "#foo/bar": "./foo/private-foo.js",
          "#foo/*.js": "./foo/*.js",
          "#foo/extensionless/*": "./foo/*.js",
          "#foo": "./foo/private-foo.js",

          "#internal-react": "react",
        },
      },
      null,
      2,
    ),
  );
}
