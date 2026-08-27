import { $, ShellOutput } from "bun";
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { appendFileSync, lstatSync, readdirSync, readFileSync } from "fs";
import { bunEnv, bunExe, isASAN, tempDir, VerdaccioRegistry } from "harness";
import { isAbsolute, join, sep } from "path";

const expectNoError = (o: ShellOutput) => expect(o.stderr.toString()).not.toContain("error");
// const platformPath = (path: string) => (process.platform === "win32" ? path.replaceAll("/", sep) : path);
const platformPath = (path: string) => path;

setDefaultTimeout(1000 * 60 * 5);

describe("error messages", () => {
  test("'bun patch' with no package name shows a usage example", async () => {
    await using dir = tempDir("bun-patch-noarg", {
      "package.json": JSON.stringify({ name: "t" }),
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "patch"],
      env: bunEnv,
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("Missing package name to patch");
    expect(stderr).toContain("bun patch <package>");
    expect(stderr).toContain("bun patch --help");
    expect(exitCode).toBe(1);
  });

  test("'bun patch --commit' with no directory shows a usage example", async () => {
    await using dir = tempDir("bun-patch-commit-noarg", {
      "package.json": JSON.stringify({ name: "t" }),
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "patch", "--commit"],
      env: bunEnv,
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("Missing path to the package directory");
    expect(stderr).toContain("bun patch --commit node_modules/<package>");
    expect(stderr).toContain("bun patch --help");
    expect(exitCode).toBe(1);
  });

  test("'bun patch-commit' with no directory shows a usage example", async () => {
    await using dir = tempDir("bun-patchcommit-noarg", {
      "package.json": JSON.stringify({ name: "t" }),
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "patch-commit"],
      env: bunEnv,
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("Missing path to the package directory");
    expect(stderr).toContain("bun patch-commit node_modules/<package>");
    expect(stderr).toContain("bun patch-commit --help");
    expect(exitCode).toBe(1);
  });
});

// `bun patch` identifies packages by `name@label`, where a tarball package's label is
// the spec it was installed from. These labels used to be formatted into 1024 byte
// stack buffers (512 bytes in the installer itself), so a long enough spec crashed
// every command that formatted it.
describe("packages whose label is longer than 1024 bytes", () => {
  const registry = new VerdaccioRegistry();

  beforeAll(async () => {
    await registry.start();
  });

  afterAll(() => {
    registry.stop();
  });

  // `x/../` normalizes away, so the tarball still lives at a short path that is valid
  // on every platform while the recorded spec stays long.
  const longSpec = (tarball: string) => `./${Buffer.alloc(1050, "x/../").toString()}${tarball}`;

  async function createProject(tarball: string, packageJson: Record<string, unknown>) {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "hoisted" },
      files: {
        "package.json": JSON.stringify(packageJson),
        [tarball]: readFileSync(join(import.meta.dir, tarball)),
      },
    });
    return packageDir;
  }

  async function runBun(cwd: string, ...args: string[]) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      cwd,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  async function install(cwd: string) {
    const { stderr, exitCode } = await runBun(cwd, "install");
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
  }

  test.concurrent("bun patch <name>@<label>", async () => {
    const spec = longSpec("bar-0.0.2.tgz");
    const packageDir = await createProject("bar-0.0.2.tgz", { name: "foo", dependencies: { bar: spec } });
    await install(packageDir);

    const { stdout, stderr, exitCode } = await runBun(packageDir, "patch", `bar@${spec}`);
    expect(stderr).not.toContain("error:");
    expect(stdout).toContain("To patch bar, edit the following folder:\n\n  node_modules/bar\n");
    expect(exitCode).toBe(0);
  });

  // `bun patch <path>` and `bun patch --commit <path>` find the package by comparing the
  // label of every package with that name against the version in <path>/package.json.
  // The lockfile lists the long-labeled `bar` before `bar-from-npm`, so both commands
  // format the long label before reaching the package that matches.
  test.concurrent("bun patch <path> when another package with the same name has a long label", async () => {
    const packageDir = await createProject("bar-0.0.2.tgz", {
      name: "foo",
      dependencies: { "bar": longSpec("bar-0.0.2.tgz"), "bar-from-npm": "npm:bar@0.0.7" },
    });
    await install(packageDir);

    const prepare = await runBun(packageDir, "patch", "node_modules/bar-from-npm");
    expect(prepare.stderr).not.toContain("error:");
    expect(prepare.stdout).toContain("To patch bar, edit the following folder:\n\n  node_modules/bar-from-npm\n");
    expect(prepare.exitCode).toBe(0);

    await Bun.write(join(packageDir, "node_modules", "bar-from-npm", "index.js"), "module.exports = 'patched';\n");

    const commit = await runBun(packageDir, "patch", "--commit", "node_modules/bar-from-npm");
    expect(commit.stderr).not.toContain("error:");
    expect(commit.exitCode).toBe(0);
    expect((await Bun.file(join(packageDir, "package.json")).json()).patchedDependencies).toEqual({
      "bar@0.0.7": "patches/bar@0.0.7.patch",
    });
    expect(await Bun.file(join(packageDir, "patches", "bar@0.0.7.patch")).text()).toContain(
      "+module.exports = 'patched';",
    );
  });

  // Committing formats `name@label` before doing anything else. The commit itself cannot
  // succeed for such a package (the patch file is named after the label, which no file
  // system accepts at this length), so what is pinned here is that it fails at that step.
  test.concurrent("bun patch --commit of a long-labeled package exits 1 without recording a patch", async () => {
    const packageJson = { name: "foo", dependencies: { baz: longSpec("baz-0.0.3.tgz") } };
    const packageDir = await createProject("baz-0.0.3.tgz", packageJson);
    await install(packageDir);

    const prepare = await runBun(packageDir, "patch", "node_modules/baz");
    expect(prepare.stderr).not.toContain("error:");
    expect(prepare.exitCode).toBe(0);

    await Bun.write(join(packageDir, "node_modules", "baz", "index.js"), "console.log('patched baz');\n");

    const commit = await runBun(packageDir, "patch", "--commit", "node_modules/baz");
    expect(commit.stderr).toContain("failed renaming patch file to patches dir");
    expect(commit.exitCode).toBe(1);
    expect(await Bun.file(join(packageDir, "package.json")).json()).toEqual(packageJson);
  });
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
          await using tempdir = tempDir("lol", {
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
          await using tempdir = tempDir("lol", {
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
          await using tempdir = tempDir("lol", {
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

    // https://github.com/oven-sh/bun/issues/12200
    // https://github.com/oven-sh/bun/issues/12882
    describe("inside workspace package, committing with the path bun suggested", async () => {
      const files = {
        "package.json": JSON.stringify({
          name: "root",
          private: true,
          workspaces: ["packages/*"],
        }),
        packages: {
          server: {
            "package.json": JSON.stringify({
              name: "server",
              version: "1.0.0",
              dependencies: { "is-odd": "3.0.1" },
            }),
          },
        },
      };

      async function prepare(tempdir: string) {
        const subdir = join(tempdir, "packages", "server");
        await $`${bunExe()} i`.env(bunEnv).cwd(subdir);

        const prep = await $`${bunExe()} patch is-odd`.env(bunEnv).cwd(subdir);
        expect(prep.stderr.toString()).not.toContain("error");
        const suggested = prep.stdout.toString().match(/bun patch --commit '([^']+)'/);
        expect(suggested).not.toBeNull();
        const absPath = suggested![1];
        expect(isAbsolute(absPath.replaceAll("/", sep))).toBe(true);
        expect(absPath).toContain("node_modules");

        await Bun.write(join(tempdir, "node_modules", "is-odd", "index.js"), "module.exports = () => 'patched';\n");
        return { subdir, absPath };
      }

      async function check(tempdir: string, commit: ShellOutput) {
        expect(commit.stderr.toString()).not.toContain("ENOENT");
        expect(commit.stderr.toString()).not.toContain("error");
        expect(commit.exitCode).toBe(0);

        expect((await Bun.file(join(tempdir, "package.json")).json()).patchedDependencies).toEqual({
          "is-odd@3.0.1": "patches/is-odd@3.0.1.patch",
        });
        const patch = await Bun.file(join(tempdir, "patches", "is-odd@3.0.1.patch")).text();
        expect(patch).not.toContain("new file mode 120000");
        expect(patch).not.toContain("deleted file mode");
        expect(patch).toContain("patched");
      }

      // On Windows the suggested path is a drive-letter absolute path like
      // `C:\tmp\.../node_modules/is-odd`. Previously this was treated as
      // relative and joined onto `packages/server/`, producing
      // `packages\server\C:\...\package.json` → ENOENT.
      test("absolute path", async () => {
        await using tempdir = tempDir("patch-ws-abs", files);
        const { subdir, absPath } = await prepare(String(tempdir));
        const commit = await $`${bunExe()} patch --commit ${absPath}`.env(bunEnv).cwd(subdir).throws(false);
        await check(String(tempdir), commit);
      });

      // With the isolated linker `packages/server/node_modules/is-odd` is a
      // symlink into `.bun/`. `bun patch is-odd` placed the editable copy at
      // the root `node_modules/is-odd`, so committing `node_modules/is-odd`
      // from the subdir must diff the root copy, not the symlink.
      test("relative node_modules/<pkg>", async () => {
        await using tempdir = tempDir("patch-ws-rel", files);
        const { subdir } = await prepare(String(tempdir));
        expect(lstatSync(join(subdir, "node_modules", "is-odd")).isSymbolicLink()).toBe(true);
        const commit = await $`${bunExe()} patch --commit node_modules/is-odd`.env(bunEnv).cwd(subdir).throws(false);
        await check(String(tempdir), commit);
      });
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
          await using tempdir = tempDir("lol", {
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
          await using tempdir = tempDir("popular", {
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
        (isASAN ? 4 : 1) * 30 * 1000,
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
    await using tempdir = tempDir("lol", {
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

  describe(".bun-tag sentinel leak test", () => {
    const registry = new VerdaccioRegistry();

    beforeAll(async () => {
      await registry.start();
    });

    afterAll(() => {
      registry.stop();
    });

    // https://github.com/oven-sh/bun/issues/19327
    test("should not leak .bun-tag sentinel or accumulate tags across patch cycles", async () => {
      await using tempdir = tempDir("buntag", {
        "package.json": JSON.stringify({
          "name": "bun-patch-test",
          "version": "1.0.0",
          "dependencies": { "basic-1": "1.0.0" },
        }),
      });

      const env = {
        ...bunEnv,
        BUN_INSTALL_CACHE_DIR: join(String(tempdir), ".bun-cache"),
        BUN_CONFIG_REGISTRY: registry.registryUrl(),
      };
      await $`${bunExe()} i`.env(env).cwd(tempdir);

      const pkgDir = join(String(tempdir), "node_modules/basic-1");
      const patchfilePath = join(String(tempdir), "patches/basic-1@1.0.0.patch");
      const sentinels = () => readdirSync(pkgDir).filter(name => name.startsWith(".bun-tag-"));

      for (const cycle of [0, 1]) {
        expectNoError(await $`${bunExe()} patch basic-1@1.0.0`.env(env).cwd(tempdir));
        appendFileSync(join(pkgDir, "index.js"), `console.log(${cycle})\n`);
        expectNoError(await $`${bunExe()} patch --commit ${pkgDir}`.env(env).cwd(tempdir));

        expect(readFileSync(patchfilePath, "utf8")).not.toMatch(/\.bun-tag-[0-9a-f]+/);

        await $`${bunExe()} i`.env(env).cwd(tempdir);
        expect(sentinels()).toHaveLength(1);
      }
    });
  });

  test("bad patch arg", async () => {
    await using tempdir = tempDir("lol", {
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
    await using tempdir = tempDir("lol", {
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

      await using filedir = tempDir("patch1", {
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
      await using filedir = tempDir("patch1", {
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

      await using filedir = tempDir("patch1", {
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

      await using tempdir = tempDir("unpatched", {
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

      await using filedir = tempDir("patch1", {
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

      await using tempdir = tempDir("unpatched", {
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

// `bun patch --commit` derives the pristine copy's cache folder from the
// package's resolution. For non-registry resolutions (git, github, tarball)
// the resolution strings live in the lockfile's string buffer; resolving them
// against the wrong buffer produced paths like "@GH@@@@1" and the diff step
// failed with "Could not access".
describe.concurrent("bun patch --commit for non-registry dependencies", () => {
  async function runBun(cwd: string, env: Record<string, string | undefined>, ...args: string[]) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      env,
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  async function expectPatchFlowWorks(dir: string, env: Record<string, string | undefined>, commitArg: string) {
    {
      const { stderr, exitCode } = await runBun(dir, env, "install");
      expect(exitCode, `bun install failed: ${stderr}`).toBe(0);
    }
    {
      const { stderr, exitCode } = await runBun(dir, env, "patch", "pkg-to-patch");
      expect(exitCode, `bun patch failed: ${stderr}`).toBe(0);
    }

    await Bun.write(join(dir, "node_modules", "pkg-to-patch", "index.js"), `module.exports = "patched";\n`);

    {
      const { stderr, exitCode } = await runBun(dir, env, "patch", "--commit", commitArg);
      expect(stderr).not.toContain("Could not access");
      expect(exitCode, `bun patch --commit failed: ${stderr}`).toBe(0);
    }

    const pkg = await Bun.file(join(dir, "package.json")).json();
    const entries = Object.entries(pkg.patchedDependencies ?? {}) as [string, string][];
    expect(entries).toHaveLength(1);
    const [patchKey, patchPath] = entries[0];
    // the filename must stay valid on Windows (no NTFS-reserved characters)
    expect(patchPath).not.toMatch(/[:?*"<>|]/);
    const patchContents = await Bun.file(join(dir, patchPath)).text();
    expect(patchContents).toContain('-module.exports = "original";');
    expect(patchContents).toContain('+module.exports = "patched";');
    // the commit flow reinstalls with the patch applied
    expect(await Bun.file(join(dir, "node_modules", "pkg-to-patch", "index.js")).text()).toBe(
      `module.exports = "patched";\n`,
    );
    return patchKey;
  }

  test("github dependency", async () => {
    await using dir = tempDir("patch-commit-github", {
      "package.json": JSON.stringify({
        name: "test-patch-github",
        dependencies: { "pkg-to-patch": "github:testowner/testrepo#aaaaaaa" },
      }),
      // GitHub API tarballs have an `<owner>-<repo>-<committish>` root folder;
      // that folder name becomes the `resolved` part of the cache folder name.
      "tarball-src": {
        "testowner-testrepo-aaaaaaa": {
          "package.json": JSON.stringify({ name: "pkg-to-patch", version: "1.0.0" }),
          "index.js": `module.exports = "original";\n`,
        },
      },
    });

    await using tarProc = Bun.spawn({
      cmd: [
        "tar",
        "-czf",
        join(String(dir), "gh.tgz"),
        "-C",
        join(String(dir), "tarball-src"),
        "testowner-testrepo-aaaaaaa",
      ],
      env: bunEnv,
      stdout: "inherit",
      stderr: "inherit",
    });
    expect(await tarProc.exited).toBe(0);
    const tgz = await Bun.file(join(String(dir), "gh.tgz")).bytes();

    await using server = Bun.serve({
      port: 0,
      fetch: () => new Response(tgz, { headers: { "content-type": "application/gzip" } }),
    });

    const env = {
      ...bunEnv,
      GITHUB_API_URL: `http://localhost:${server.port}`,
      BUN_INSTALL_CACHE_DIR: join(String(dir), ".bun-cache"),
    };

    const patchKey = await expectPatchFlowWorks(String(dir), env, "node_modules/pkg-to-patch");
    expect(patchKey).toBe("pkg-to-patch@github:testowner/testrepo#aaaaaaa");
  });

  test("git dependency", async () => {
    await using dir = tempDir("patch-commit-git", {
      "gitrepo": {
        "package.json": JSON.stringify({ name: "pkg-to-patch", version: "1.0.0" }),
        "index.js": `module.exports = "original";\n`,
      },
      "project": {},
    });
    const repo = join(String(dir), "gitrepo");

    // keep git away from the machine's global/system config (autocrlf, gpgsign)
    const gitEnv = { ...bunEnv, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: join(String(dir), "no-gitconfig") };
    for (const args of [
      ["init", "-q"],
      ["config", "core.autocrlf", "false"],
      ["add", "-A"],
      ["-c", "user.email=test@test.test", "-c", "user.name=test", "commit", "-q", "-m", "init"],
      // serve the repo over git's dumb HTTP protocol (plain file fetches)
      ["update-server-info"],
    ]) {
      await using proc = Bun.spawn({ cmd: ["git", ...args], cwd: repo, env: gitEnv, stderr: "pipe" });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      expect(exitCode, `git ${args.join(" ")} failed: ${stderr}`).toBe(0);
    }

    await using server = Bun.serve({
      port: 0,
      async fetch(req) {
        const pathname = new URL(req.url).pathname;
        if (!pathname.startsWith("/repo.git/")) return new Response("not found", { status: 404 });
        const file = Bun.file(join(repo, ".git", ...pathname.slice("/repo.git/".length).split("/")));
        return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
      },
    });

    const project = join(String(dir), "project");
    const depUrl = `git+http://localhost:${server.port}/repo.git`;
    await Bun.write(
      join(project, "package.json"),
      JSON.stringify({ name: "test-patch-git", dependencies: { "pkg-to-patch": depUrl } }),
    );

    const env = { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(String(dir), ".bun-cache") };

    const patchKey = await expectPatchFlowWorks(project, env, "node_modules/pkg-to-patch");
    expect(patchKey).toStartWith(`pkg-to-patch@${depUrl}#`);
  });

  test("local tarball dependency", async () => {
    await using dir = tempDir("patch-commit-tarball", {
      "package.json": JSON.stringify({
        name: "test-patch-tarball",
        dependencies: { "pkg-to-patch": "file:./dep.tgz" },
      }),
      "tarball-src": {
        "package": {
          "package.json": JSON.stringify({ name: "pkg-to-patch", version: "1.0.0" }),
          "index.js": `module.exports = "original";\n`,
        },
      },
    });

    await using tarProc = Bun.spawn({
      cmd: ["tar", "-czf", join(String(dir), "dep.tgz"), "-C", join(String(dir), "tarball-src"), "package"],
      env: bunEnv,
      stdout: "inherit",
      stderr: "inherit",
    });
    expect(await tarProc.exited).toBe(0);

    const env = { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(String(dir), ".bun-cache") };

    // name-only argument exercises the name-and-version lookup path
    const patchKey = await expectPatchFlowWorks(String(dir), env, "pkg-to-patch");
    expect(patchKey).toBe("pkg-to-patch@./dep.tgz");
  });
});
