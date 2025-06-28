import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

import * as Chooses from "./chooses-ts";

test(".ts file is chosen over .js file locally", () => {
  expect(Chooses.pass).toBeTrue();
});

// const isTestingInNode = { type: "module" };
const isTestingInNode = {};

// The idea with this test is:
// - In node_modules, prefer non-ts files over ts files
// - Outside node_modules, prefer ts files over non-ts files
// - ./dir/*.js should NOT be resolve to ./dir/*.ts
// - "package/dir" should resolve to "package/dir/index.ts" if "package/dir/index.js" does NOT exist
// - "package/dir" should resolve to "package/dir/index.js" if "package/dir/index.ts" does exist
// - it should work when no node_modules/package/package.json exists

// A good package to try this on is `capnp-ts`:
// https://github.com/oven-sh/bun/issues/5426

function runTest(
  { withPackageJSON = false, withPackageJSONExports = false, type = "", jsFile = false, asDir = false } = {} as {
    withPackageJSON?: boolean;
    withPackageJSONExports?: boolean;
    type?: string;
    jsFile?: boolean;
    asDir?: boolean;
  },
) {
  const typeFlag = type ? { type } : {};
  const exportsObject = withPackageJSONExports
    ? {
        exports: {
          ".": (asDir ? "./dir/index." : "./index.") + (jsFile ? "js" : "ts"),
          ...(asDir ? { "./*": "./dir/*.js" } : {}),
        },
      }
    : {};

  const files: Record<string, string> = {};
  if (jsFile) {
    files[asDir ? "node_modules/abc/dir/index.js" : "node_modules/abc/index.js"] =
      "export * from './sibling'; export const foo = 1;";
    files[asDir ? "node_modules/abc/dir/sibling.js" : "node_modules/abc/sibling.js"] = "export const sibling = 1;";
  }

  if (withPackageJSON) {
    files["node_modules/abc/package.json"] = JSON.stringify(
      {
        name: "abc",
        ...exportsObject,
        ...typeFlag,
      },
      null,
      2,
    );
  }

  files["package.json"] = JSON.stringify(
    {
      name: "myapp",
      ...isTestingInNode,
    },
    null,
    2,
  );

  let extra = "";

  if (asDir && withPackageJSONExports && jsFile) {
    extra = `

      import * as index from "abc/index";

      if (index.foo !== 1) {
          throw new Error("Unexpected value\\n" + JSON.stringify(index, null, 2));
      }
    `;
  }

  let entry = "";
  if (asDir && !withPackageJSONExports) {
    entry = `
        import * as pkg from "abc/dir";

        if (${jsFile ? "pkg.foo !== 1" : "pkg.bar !== 2"}) {
            throw new Error("Unexpected value\\n" + JSON.stringify(pkg, null, 2));
        }

        if (${jsFile ? "pkg.sibling !== 1" : "pkg.sibling !== 2"}) {
          throw new Error("Unexpected value\\n" + JSON.stringify(pkg, null, 2));
        }
    `;

    if (!jsFile) {
      entry += `
      import * as pkg2 from "abc/dir/index";
      import * as pkg3 from "abc/dir/index.js";
      import * as pkg4 from "abc/dir/index.ts";

        if (pkg2.bar !== 2) {
            throw new Error("Unexpected value\\n" + JSON.stringify(pkg2, null, 2));
        }

        if (pkg3.bar !== 2) {
          throw new Error("Unexpected value\\n" + JSON.stringify(pkg3, null, 2));
        }

        if (pkg4.bar !== 2) {
          throw new Error("Unexpected value\\n" + JSON.stringify(pkg4, null, 2));
        }

        if (pkg2 !== pkg3 || pkg3 !== pkg4) {
          throw new Error("Unexpected value\\n" + JSON.stringify(pkg2, null, 2));
        }
      
      `;
    }
  } else {
    entry = `
        import * as pkg from "abc";

        if (${jsFile ? "pkg.foo !== 1" : "pkg.bar !== 2"}) {
            throw new Error("Unexpected value\\n" + JSON.stringify(pkg, null, 2));
        }
    `;
  }

  const dirname = tempDirWithFiles("resolve" + ((Math.random() * 10000) | 0).toString(16), {
    ...files,
    [`node_modules/abc${asDir ? "/dir" : ""}/index.ts`]: `
    ${asDir ? `export * from "./sibling";` : ""}
    export const bar = 2;
`,
    [`node_modules/abc${asDir ? "/dir" : ""}/sibling.ts`]: "export const sibling = 2;",
    "index.js": entry + extra,
  });

  const { exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "index.js"],
    env: bunEnv,
    cwd: dirname,
    stderr: "inherit",
    stdout: "inherit",
    stdin: "inherit",
  });

  expect(exitCode).toBe(0);
}

for (let withPackageJSON of [true, false]) {
  if (withPackageJSON) {
    describe("with package.json", () => {
      for (let withPackageJSONExports of [true, false]) {
        for (let asDir of [true, false] as const) {
          const callback = () => {
            for (let type of ["module", "commonjs", ""]) {
              for (let jsFile of [true, false]) {
                test(`resolve ${withPackageJSONExports ? "with" : "without"} package.json exports${
                  type ? " type:" + type : " "
                } ${jsFile ? "with" : "without"} .js file`, () => {
                  runTest({ withPackageJSON, withPackageJSONExports, type, jsFile, asDir });
                });
              }
            }
          };

          if (asDir) {
            describe("as dir", callback);
          } else {
            callback();
          }
        }
      }
    });
  } else {
    for (let jsFile of [true, false]) {
      test(`resolve without package.json and ${jsFile ? "with" : "without"} .js file`, () => {
        runTest({ withPackageJSON: false, jsFile, asDir: false });
      });
    }
  }
}
