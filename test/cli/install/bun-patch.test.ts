import { $, ShellOutput } from "bun";
import { beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";

const expectNoError = (o: ShellOutput) => expect(o.stderr.toString()).not.toContain("error");
// const platformPath = (path: string) => (process.platform === "win32" ? path.replaceAll("/", sep) : path);
const platformPath = (path: string) => path;

beforeAll(() => {
  setDefaultTimeout(1000 * 60 * 5);
});

describe("bun patch <pkg>", async () => {
  describe("workspace interactions", async () => {
    /**
     * @repo/eslint-config and @repo/typescript-config both depend on @types/ws@8.5.4
     * so it should be hoisted to the root node_modules
     */
    describe("inside workspace with hoisting", async () => {
      const args = [
        ["packages/eslint-config/node_modules/@types/ws", "packages/eslint-config/node_modules/@types/ws"],
        ["@types/ws@8.5.4", "node_modules/@types/ws"],
      ];
      for (const [arg, path] of args) {
        test(arg, async () => {
          const tempdir = tempDirWithFiles("lol", {
            "package.json": JSON.stringify({
              "name": "my-workspace",
              private: "true",
              version: "0.0.1",
              "devDependencies": {
                "@repo/ui": "*",
                "@repo/eslint-config": "*",
                "@repo/typescript-config": "*",
              },
              workspaces: ["packages/*"],
            }),
            packages: {
              "eslint-config": {
                "package.json": JSON.stringify({
                  name: "@repo/eslint-config",
                  "version": "0.0.0",
                  dependencies: {
                    "@types/ws": "8.5.4",
                  },
                  private: "true",
                }),
              },
              "typescript-config": {
                "package.json": JSON.stringify({
                  "name": "@repo/typescript-config",
                  "version": "0.0.0",
                  dependencies: {
                    "@types/ws": "8.5.4",
                  },
                  private: "true",
                }),
              },
              "ui": {
                "package.json": JSON.stringify({
                  name: "@repo/ui",
                  version: "0.0.0",
                  private: "true",
                  devDependencies: {
                    "@repo/eslint-config": "*",
                    "@repo/typescript-config": "*",
                  },
                }),
              },
            },
          });

          console.log("TEMPDIR", tempdir);

          await $`${bunExe()} i`.env(bunEnv).cwd(tempdir);

          let result = await $` ${bunExe()} patch ${arg}`.env(bunEnv).cwd(tempdir);
          expect(result.stderr.toString()).not.toContain("error");
          expect(result.stdout.toString()).toContain(`To patch @types/ws, edit the following folder:\n\n  ${path}\n`);

          await $`echo LOL > ${path}/index.d.ts`.env(bunEnv).cwd(tempdir);

          expectNoError(await $`${bunExe()} patch --commit ${arg}`.env(bunEnv).cwd(tempdir));

          expect(await $`cat ${path}/index.d.ts`.env(bunEnv).cwd(tempdir).text()).toEqual("LOL\n");

          expect(
            (await $`cat package.json`.cwd(tempdir).env(bunEnv).json()).patchedDependencies["@types/ws@8.5.4"],
          ).toEqual("patches/@types%2Fws@8.5.4.patch");
        });
      }
    });

    describe("inside workspace with multiple workspace packages with same dependency", async () => {
      const args = [
        ["node_modules/@types/ws", "packages/eslint-config/node_modules/@types/ws"],
        ["@types/ws@8.5.4", "node_modules/@repo/eslint-config/node_modules/@types/ws"],
      ];
      for (const [arg, path] of args) {
        test(arg, async () => {
          const tempdir = tempDirWithFiles("lol", {
            "package.json": JSON.stringify({
              "name": "my-workspace",
              private: "true",
              version: "0.0.1",
              "devDependencies": {
                "@repo/ui": "*",
                "@repo/eslint-config": "*",
                "@repo/typescript-config": "*",
                "@types/ws": "7.4.7",
              },
              workspaces: ["packages/*"],
            }),
            packages: {
              "eslint-config": {
                "package.json": JSON.stringify({
                  name: "@repo/eslint-config",
                  "version": "0.0.0",
                  dependencies: {
                    "@types/ws": "8.5.4",
                  },
                  private: "true",
                }),
              },
              "typescript-config": {
                "package.json": JSON.stringify({
                  "name": "@repo/typescript-config",
                  "version": "0.0.0",
                  dependencies: {
                    "@types/ws": "8.5.4",
                  },
                  private: "true",
                }),
              },
              "ui": {
                "package.json": JSON.stringify({
                  name: "@repo/ui",
                  version: "0.0.0",
                  private: "true",
                  devDependencies: {
                    "@repo/eslint-config": "*",
                    "@repo/typescript-config": "*",
                  },
                }),
              },
            },
          });

          console.log("TEMPDIR", tempdir);

          await $`${bunExe()} i`.env(bunEnv).cwd(tempdir);

          let result = await $`cd packages/eslint-config; ${bunExe()} patch ${arg}`.env(bunEnv).cwd(tempdir);
          expect(result.stderr.toString()).not.toContain("error");
          expect(result.stdout.toString()).toContain(
            `To patch @types/ws, edit the following folder:\n\n  ${tempdir}/${path}\n`,
          );

          await $`echo LOL > ${path}/index.d.ts`.env(bunEnv).cwd(tempdir);

          expectNoError(await $`cd packages/eslint-config; ${bunExe()} patch --commit ${arg}`.env(bunEnv).cwd(tempdir));

          expect(await $`cat ${path}/index.d.ts`.env(bunEnv).cwd(tempdir).text()).toEqual("LOL\n");

          expect(
            (await $`cat package.json`.cwd(tempdir).env(bunEnv).json()).patchedDependencies["@types/ws@8.5.4"],
          ).toEqual("patches/@types%2Fws@8.5.4.patch");
        });
      }
    });

    describe("inside workspace package", async () => {
      const args = [
        ["node_modules/@types/ws", "packages/eslint-config/node_modules/@types/ws"],
        ["@types/ws@8.5.4", "node_modules/@repo/eslint-config/node_modules/@types/ws"],
      ];
      for (const [arg, path] of args) {
        test(arg, async () => {
          const tempdir = tempDirWithFiles("lol", {
            "package.json": JSON.stringify({
              "name": "my-workspace",
              private: "true",
              version: "0.0.1",
              "devDependencies": {
                "@repo/ui": "*",
                "@repo/eslint-config": "*",
                "@repo/typescript-config": "*",
                "@types/ws": "7.4.7",
              },
              workspaces: ["packages/*"],
            }),
            packages: {
              "eslint-config": {
                "package.json": JSON.stringify({
                  name: "@repo/eslint-config",
                  "version": "0.0.0",
                  dependencies: {
                    "@types/ws": "8.5.4",
                  },
                  private: "true",
                }),
              },
              "typescript-config": {
                "package.json": JSON.stringify({
                  "name": "@repo/typescript-config",
                  "version": "0.0.0",
                  private: "true",
                }),
              },
              "ui": {
                "package.json": JSON.stringify({
                  name: "@repo/ui",
                  version: "0.0.0",
                  private: "true",
                  devDependencies: {
                    "@repo/eslint-config": "*",
                    "@repo/typescript-config": "*",
                  },
                }),
              },
            },
          });

          console.log("TEMPDIR", tempdir);

          await $`${bunExe()} i`.env(bunEnv).cwd(tempdir);

          let result = await $`cd packages/eslint-config; ${bunExe()} patch ${arg}`.env(bunEnv).cwd(tempdir);
          expect(result.stderr.toString()).not.toContain("error");
          expect(result.stdout.toString()).toContain(
            `To patch @types/ws, edit the following folder:\n\n  ${tempdir}/${path}\n`,
          );

          await $`echo LOL > ${path}/index.js`.env(bunEnv).cwd(tempdir);

          expectNoError(await $`cd packages/eslint-config; ${bunExe()} patch --commit ${arg}`.env(bunEnv).cwd(tempdir));

          expect(await $`cat ${path}/index.js`.env(bunEnv).cwd(tempdir).text()).toEqual("LOL\n");

          expect(
            (await $`cat package.json`.cwd(tempdir).env(bunEnv).json()).patchedDependencies["@types/ws@8.5.4"],
          ).toEqual("patches/@types%2Fws@8.5.4.patch");
        });
      }
    });

    describe("inside ROOT workspace package", async () => {
      const args = [
        [
          "packages/eslint-config/node_modules/@types/ws",
          "packages/eslint-config/node_modules/@types/ws",
          "@types/ws@8.5.4",
          "patches/@types%2Fws@8.5.4.patch",
        ],
        [
          "@types/ws@8.5.4",
          "node_modules/@repo/eslint-config/node_modules/@types/ws",
          "@types/ws@8.5.4",
          "patches/@types%2Fws@8.5.4.patch",
        ],
        ["@types/ws@7.4.7", "node_modules/@types/ws", "@types/ws@7.4.7", "patches/@types%2Fws@7.4.7.patch"],
      ];
      for (const [arg, path, version, patch_path] of args) {
        test(arg, async () => {
          const tempdir = tempDirWithFiles("lol", {
            "package.json": JSON.stringify({
              "name": "my-workspace",
              private: "true",
              version: "0.0.1",
              "devDependencies": {
                "@repo/ui": "*",
                "@repo/eslint-config": "*",
                "@repo/typescript-config": "*",
                "@types/ws": "7.4.7",
              },
              workspaces: ["packages/*"],
            }),
            packages: {
              "eslint-config": {
                "package.json": JSON.stringify({
                  name: "@repo/eslint-config",
                  "version": "0.0.0",
                  dependencies: {
                    "@types/ws": "8.5.4",
                  },
                  private: "true",
                }),
              },
              "typescript-config": {
                "package.json": JSON.stringify({
                  "name": "@repo/typescript-config",
                  "version": "0.0.0",
                  private: "true",
                }),
              },
              "ui": {
                "package.json": JSON.stringify({
                  name: "@repo/ui",
                  version: "0.0.0",
                  private: "true",
                  devDependencies: {
                    "@repo/eslint-config": "*",
                    "@repo/typescript-config": "*",
                  },
                }),
              },
            },
          });

          console.log("TEMPDIR", tempdir);

          await $`${bunExe()} i`.env(bunEnv).cwd(tempdir);

          let result = await $`${bunExe()} patch ${arg}`.env(bunEnv).cwd(tempdir);
          expect(result.stderr.toString()).not.toContain("error");
          expect(result.stdout.toString()).toContain(`To patch @types/ws, edit the following folder:\n\n  ${path}\n`);

          await $`echo LOL > ${path}/index.js`.env(bunEnv).cwd(tempdir);

          expectNoError(await $`${bunExe()} patch --commit ${arg}`.env(bunEnv).cwd(tempdir));

          expect(await $`cat ${path}/index.js`.env(bunEnv).cwd(tempdir).text()).toEqual("LOL\n");

          expect((await $`cat package.json`.cwd(tempdir).env(bunEnv).json()).patchedDependencies[version]).toEqual(
            patch_path,
          );
        });
      }
    });
  });

  // Tests to make sure that patching
  describe("popular pkg", async () => {
    const dummyCode = /* ts */ `
    module.exports = function lmao() {
      return 420;
    }
    `;

    function makeTest(pkgName: string, version: string, folder_in_node_modules: string = `${pkgName}`) {
      test(
        `${pkgName}@${version}`,
        async () => {
          const tempdir = tempDirWithFiles("popular", {
            "package.json": JSON.stringify({
              "name": "bun-patch-test",
              "module": "index.ts",
              "type": "module",
              "dependencies": {
                [pkgName]: version,
              },
            }),
            "index.ts": /* ts */ `import lmao from '${pkgName}'; console.log(lmao())`,
          });

          console.log("TEMPDIR", tempdir);
          expectNoError(await $`${bunExe()} i`.env(bunEnv).cwd(tempdir));
          expectNoError(await $`${bunExe()} patch ${pkgName}@${version}`.env(bunEnv).cwd(tempdir));
          await $`echo ${dummyCode} > node_modules/${folder_in_node_modules}/index.js`.env(bunEnv).cwd(tempdir);
          const { type, module, exports, ...package_json }: Record<string, any> =
            await $`cat node_modules/${folder_in_node_modules}/package.json`.env(bunEnv).cwd(tempdir).json();
          package_json["main"] = "index.js";
          await $`echo ${JSON.stringify(package_json)} > node_modules/${folder_in_node_modules}/package.json`
            .env(bunEnv)
            .cwd(tempdir);

          expectNoError(
            await $`${bunExe()} patch --commit node_modules/${folder_in_node_modules}`.env(bunEnv).cwd(tempdir),
          );

          const { stdout } = await $`${bunExe()} run index.ts`.env(bunEnv).cwd(tempdir);
          expect(stdout.toString()).toBe("420\n");
        },
        30 * 1000,
      );
    }

    makeTest("lodash", "4.17.21");
    makeTest("react", "18.3.1");
    makeTest("react-dom", "18.3.1");
    makeTest("axios", "1.7.2");
    // makeTest("tslib", "2.6.3");
    // makeTest("chalk", "5.3.0");
    // makeTest("next", "14.2.4");
    // makeTest("express", "4.19.2");
    // makeTest("inquirer", "9.2.23");
    // makeTest("commander", "12.1.0");

    // // vercel/next.js
    // makeTest("webpack-sources", "3.2.3");

    // // vitejs/vite
    // makeTest("acorn", "8.11.3");
    // makeTest("chokidar", "3.6.0");
    // makeTest("http-proxy", "1.18.1");
    // makeTest("sirv", "2.0.4");

    // // mermaid-js/mermaid
    // makeTest("cytoscape", "3.28.1");

    // // remix-run/react-router
    // makeTest("@changesets/get-dependents-graph", "1.3.6", "@changesets/get-dependents-graph");

    // // n8n-io/n8n
    // makeTest("typedi", "0.10.0");
    // makeTest("@sentry/cli", "2.17.0", "@sentry/cli");
    // makeTest("pkce-challenge", "3.0.0");
    // makeTest("pyodide", "0.23.4");
    makeTest("@types/express-serve-static-core", "4.17.43", "@types/express-serve-static-core");
    makeTest("@types/ws", "8.5.4", "@types/ws");
    makeTest("@types/uuencode", "0.0.3", "@types/uuencode");
  });
  test("should patch a package when it is already patched", async () => {
    const tempdir = tempDirWithFiles("lol", {
      "package.json": JSON.stringify({
        "name": "bun-patch-test",
        "module": "index.ts",
        "type": "module",
        "dependencies": {
          "is-even": "1.0.0",
          "is-odd": "3.0.1",
        },
      }),
      "index.ts": /* ts */ `import isEven from 'is-even'; console.log(isEven(420))`,
    });

    await $`${bunExe()} i`.env(bunEnv).cwd(tempdir);
    const { stderr } = await $`${bunExe()} patch is-odd@0.1.2`.env(bunEnv).cwd(tempdir).throws(false);
    expect(stderr.toString()).not.toContain("error");

    const firstChange = /* ts */ `/*!
* is-odd <https://github.com/jonschlinkert/is-odd>
*
* Copyright (c) 2015-2017, Jon Schlinkert.
* Released under the MIT License.
*/

'use strict';

var isNumber = require('is-number');

module.exports = function isOdd(i) {
  if (!isNumber(i)) {
    throw new TypeError('is-odd expects a number.');
  }
  if (Number(i) !== Math.floor(i)) {
    throw new RangeError('is-odd expects an integer.');
  }
  console.log('hi')
  return !!(~~i & 1);
};`;

    await $`echo ${firstChange} > node_modules/is-even/node_modules/is-odd/index.js`.env(bunEnv).cwd(tempdir);

    const { stderr: stderr2 } = await $`${bunExe()} patch --commit node_modules/is-even/node_modules/is-odd`
      .env(bunEnv)
      .cwd(tempdir)
      .throws(false);
    expect(stderr2.toString()).not.toContain("error");

    const { stderr: stderr3 } = await $`${bunExe()} patch is-odd@0.1.2`.env(bunEnv).cwd(tempdir).throws(false);
    expect(stderr3.toString()).not.toContain("error");

    const secondChange = /* ts */ `/*!
* is-odd <https://github.com/jonschlinkert/is-odd>
*
* Copyright (c) 2015-2017, Jon Schlinkert.
* Released under the MIT License.
*/

'use strict';

var isNumber = require('is-number');

module.exports = function isOdd(i) {
  if (!isNumber(i)) {
    throw new TypeError('is-odd expects a number.');
  }
  if (Number(i) !== Math.floor(i)) {
    throw new RangeError('is-odd expects an integer.');
  }
  console.log('hi')
  console.log('hello')
  return !!(~~i & 1);
};`;

    await $`echo ${secondChange} > node_modules/is-even/node_modules/is-odd/index.js`.env(bunEnv).cwd(tempdir);
    const { stderr: stderr4 } = await $`${bunExe()} patch --commit node_modules/is-even/node_modules/is-odd`
      .env(bunEnv)
      .cwd(tempdir)
      .throws(false);
    expect(stderr4.toString()).not.toContain("error");

    await $`cat patches/is-odd@0.1.2.patch`.env(bunEnv).cwd(tempdir);

    await $`${bunExe()} i`.env(bunEnv).cwd(tempdir).throws(false);
    const { stdout } = await $`${bunExe()} run index.ts`.env(bunEnv).cwd(tempdir).throws(false);
    expect(stdout.toString()).toContain("hi\nhello\n");
  });

  test("bad patch arg", async () => {
    const tempdir = tempDirWithFiles("lol", {
      "package.json": JSON.stringify({
        "name": "bun-patch-test",
        "module": "index.ts",
        "type": "module",
        "dependencies": {
          "is-even": "1.0.0",
        },
      }),
      "index.ts": /* ts */ `import isEven from 'is-even'; console.log(isEven(420))`,
    });

    await $`${bunExe()} i`.env(bunEnv).cwd(tempdir);
    const { stderr, exitCode } = await $`${bunExe()} patch lkflksdkfj`.env(bunEnv).cwd(tempdir).throws(false);
    expect(exitCode).toBe(1);
    expect(stderr.toString()).toContain("error: package lkflksdkfj not found");
  });

  test("bad patch commit arg", async () => {
    const tempdir = tempDirWithFiles("lol", {
      "package.json": JSON.stringify({
        "name": "bun-patch-test",
        "module": "index.ts",
        "type": "module",
        "dependencies": {
          "is-even": "1.0.0",
        },
      }),
      "index.ts": /* ts */ `import isEven from 'is-even'; console.log(isEven(420))`,
    });

    await $`${bunExe()} i`.env(bunEnv).cwd(tempdir);
    const { stderr } = await $`${bunExe()} patch is-even`.env(bunEnv).cwd(tempdir);
    expect(stderr.toString()).not.toContain("error");

    const { stderr: stderr2 } = await $`${bunExe()} patch --commit lskfjdslkfjsldkfjlsdkfj`
      .env(bunEnv)
      .cwd(tempdir)
      .throws(false);
    expect(stderr2.toString()).toContain("error: package lskfjdslkfjsldkfjlsdkfj not found");
  });

  function makeTest(
    name: string,
    {
      dependencies,
      mainScript,
      patchArg,
      patchedCode,
      expected,
    }: {
      dependencies: Record<string, string>;
      mainScript: string;
      patchArg: string;
      patchedCode: string;
      expected: { patchName: string; patchPath: string; stdout: string };
      extra?: (filedir: string) => Promise<void>;
    },
  ) {
    expected.patchPath = platformPath(expected.patchPath);
    test(name, async () => {
      $.throws(true);

      const filedir = tempDirWithFiles("patch1", {
        "package.json": JSON.stringify({
          "name": "bun-patch-test",
          "module": "index.ts",
          "type": "module",
          "dependencies": dependencies,
        }),
        "index.ts": mainScript,
      });

      {
        const { stderr } = await $`${bunExe()} i --linker hoisted`.env(bunEnv).cwd(filedir);
        expect(stderr.toString()).not.toContain("error");
      }

      {
        const { stderr, stdout } = await $`${bunExe()} patch ${patchArg} --linker hoisted`.env(bunEnv).cwd(filedir);
        expect(stderr.toString()).not.toContain("error");
        expect(stdout.toString()).toContain(
          `To patch ${platformPath(expected.patchName)}, edit the following folder:

  ${platformPath(expected.patchPath)}

Once you're done with your changes, run:

  bun patch --commit '${platformPath(expected.patchPath)}'`,
        );
      }

      {
        const newCode = patchedCode;

        await $`echo ${newCode} > ${expected.patchPath}/index.js`.env(bunEnv).cwd(filedir);
        const { stderr, stdout } = await $`${bunExe()} patch --commit ${expected.patchPath}`.env(bunEnv).cwd(filedir);
      }

      const output = await $`${bunExe()} run index.ts`.env(bunEnv).cwd(filedir).text();
      expect(output).toBe(expected.stdout);
    });
  }

  test(
    "overwriting module with multiple levels of directories",
    async () => {
      const filedir = tempDirWithFiles("patch1", {
        "package.json": JSON.stringify({
          "name": "bun-patch-test",
          "module": "index.ts",
          "type": "module",
          "dependencies": { lodash: "4.17.21" },
        }),
        "index.ts": /* ts */ `import isEven from 'is-even'; console.log(isEven())`,
      });

      {
        const { stderr } = await $`${bunExe()} i`.env(bunEnv).cwd(filedir);
        expect(stderr.toString()).not.toContain("error");
      }

      {
        const { stderr, stdout } = await $`${bunExe()} patch lodash`.env(bunEnv).cwd(filedir);
        expect(stderr.toString()).not.toContain("error");
      }

      // run it again to make sure we didn't f something up
      {
        const { stderr, stdout } = await $`${bunExe()} patch lodash`.env(bunEnv).cwd(filedir);
        expect(stderr.toString()).not.toContain("error");
      }
    },
    15 * 1000,
  );

  ["is-even@1.0.0", "node_modules/is-even"].map(patchArg =>
    makeTest("should patch a node_modules package", {
      dependencies: { "is-even": "1.0.0" },
      mainScript: /* ts */ `import isEven from 'is-even'; isEven(420)`,
      patchArg,
      patchedCode: /* ts */ `/*!
      * is-even <https://github.com/jonschlinkert/is-even>
      *
      * Copyright (c) 2015, 2017, Jon Schlinkert.
      * Released under the MIT License.
      */

     'use strict';

     var isOdd = require('is-odd');

     module.exports = function isEven(i) {
       console.log("If you're reading this, the patch worked!")
       return !isOdd(i);
     };
     `,
      expected: {
        patchName: "is-even",
        patchPath: "node_modules/is-even",
        stdout: "If you're reading this, the patch worked!\n",
      },
    }),
  );

  ["is-odd@0.1.2", "node_modules/is-even/node_modules/is-odd"].map(patchArg =>
    makeTest("should patch a nested node_modules package", {
      dependencies: { "is-even": "1.0.0", "is-odd": "3.0.1" },
      mainScript: /* ts */ `import isEven from 'is-even'; isEven(420)`,
      patchArg,
      patchedCode: /* ts */ `/*!
      * is-odd <https://github.com/jonschlinkert/is-odd>
      *
      * Copyright (c) 2015-2017, Jon Schlinkert.
      * Released under the MIT License.
      */

     'use strict';

     var isNumber = require('is-number');

     module.exports = function isOdd(i) {
       if (!isNumber(i)) {
         throw new TypeError('is-odd expects a number.');
       }
       if (Number(i) !== Math.floor(i)) {
         throw new RangeError('is-odd expects an integer.');
       }
       console.log("If you're reading this, the patch worked.")
       return !!(~~i & 1);
     };
     `,
      expected: {
        patchName: "is-odd",
        patchPath: "node_modules/is-even/node_modules/is-odd",
        stdout: "If you're reading this, the patch worked.\n",
      },
      extra: async filedir => {
        const patchfile = await $`cat ${join(filedir, "patches", "is-odd@0.1.2.patch")}`.cwd(filedir).text();
        // ensure node modules is not in the patch
        expect(patchfile).not.toContain("node_modules");
      },
    }),
  );

  test("should overwrite the node_modules folder of the package", async () => {
    const patchArgs = ["is-even@1.0.0", "node_modules/is-even"];

    for (const patchArg of patchArgs) {
      $.throws(true);

      const filedir = tempDirWithFiles("patch1", {
        "package.json": JSON.stringify({
          "name": "bun-patch-test",
          "module": "index.ts",
          "type": "module",
          "dependencies": {
            "is-even": "1.0.0",
          },
        }),
        "index.ts": /* ts */ `import isEven from 'is-even'; console.log(isEven())`,
      });

      {
        const { stderr } = await $`${bunExe()} i --backend hardlink`.env(bunEnv).cwd(filedir);
        expect(stderr.toString()).toContain("Saved lockfile");

        const newCode = /* ts */ `
module.exports = function isEven() {
  return 'LOL'
}
`;

        await $`${bunExe()} patch ${patchArg}`.env(bunEnv).cwd(filedir);
        await $`echo ${newCode} > node_modules/is-even/index.js`.env(bunEnv).cwd(filedir);
      }

      const tempdir = tempDirWithFiles("unpatched", {
        "package.json": JSON.stringify({
          "name": "bun-patch-test",
          "module": "index.ts",
          "type": "module",
          "dependencies": {
            "is-even": "1.0.0",
          },
        }),
        "index.ts": /* ts */ `import isEven from 'is-even'; console.log(isEven(420))`,
      });

      await $`${bunExe()} i`
        .env(bunEnv)
        .cwd(tempdir)
        .then(o => expect(o.stderr.toString()).not.toContain("error"));

      const { stdout, stderr } = await $`${bunExe()} run index.ts`.env(bunEnv).cwd(tempdir);
      expect(stderr.toString()).toBe("");
      expect(stdout.toString()).toBe("true\n");
    }
  });

  test("should overwrite nested node_modules folder of the package", async () => {
    const patchArgs = ["is-odd@0.1.2", "node_modules/is-even/node_modules/is-odd"];

    for (const patchArg of patchArgs) {
      $.throws(true);

      const filedir = tempDirWithFiles("patch1", {
        "package.json": JSON.stringify({
          "name": "bun-patch-test",
          "module": "index.ts",
          "type": "module",
          "dependencies": {
            "is-even": "1.0.0",
            "is-odd": "3.0.1",
          },
        }),
        "index.ts": /* ts */ `import isEven from 'is-even'; console.log(isEven())`,
      });

      {
        const { stderr } = await $`${bunExe()} i --backend hardlink --linker hoisted`.env(bunEnv).cwd(filedir);
        expect(stderr.toString()).toContain("Saved lockfile");

        const newCode = /* ts */ `
module.exports = function isOdd() {
  return 'LOL'
}
`;

        await $`ls -d node_modules/is-even/node_modules/is-odd`.cwd(filedir);
        await $`${bunExe()} patch ${patchArg} --linker hoisted`.env(bunEnv).cwd(filedir);
        await $`echo ${newCode} > node_modules/is-even/node_modules/is-odd/index.js`.env(bunEnv).cwd(filedir);
      }

      const tempdir = tempDirWithFiles("unpatched", {
        "package.json": JSON.stringify({
          "name": "bun-patch-test",
          "module": "index.ts",
          "type": "module",
          "dependencies": {
            "is-even": "1.0.0",
          },
        }),
        "index.ts": /* ts */ `import isEven from 'is-even'; console.log(isEven(420))`,
      });

      await $`${bunExe()} i`
        .env(bunEnv)
        .cwd(tempdir)
        .then(o => expect(o.stderr.toString()).not.toContain("error"));

      const { stdout, stderr } = await $`${bunExe()} run index.ts`.env(bunEnv).cwd(tempdir);
      expect(stderr.toString()).toBe("");
      expect(stdout.toString()).toBe("true\n");
    }
  });
});
