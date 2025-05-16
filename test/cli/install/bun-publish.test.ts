import { file, spawn, write } from "bun";
import { afterAll, beforeAll, describe, expect, it, test } from "bun:test";
import { exists, rm } from "fs/promises";
import {
  VerdaccioRegistry,
  bunExe,
  bunEnv as env,
  isWindows,
  pack,
  runBunInstall,
  stderrForInstall,
  tmpdirSync,
} from "harness";
import { join } from "path";

const registry = new VerdaccioRegistry();

beforeAll(async () => {
  await registry.start();
});

afterAll(() => {
  registry.stop();
});

export async function publish(
  env: any,
  cwd: string,
  ...args: string[]
): Promise<{ out: string; err: string; exitCode: number }> {
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "publish", ...args],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env,
  });

  const out = await Bun.readableStreamToText(stdout);
  const err = stderrForInstall(await Bun.readableStreamToText(stderr));
  const exitCode = await exited;
  return { out, err, exitCode };
}

describe("otp", async () => {
  const mockRegistryFetch = function (opts: {
    token: string;
    setAuthHeader?: boolean;
    otpFail?: boolean;
    npmNotice?: boolean;
    xLocalCache?: boolean;
    expectedCI?: string;
  }) {
    return async function (req: Request) {
      const { token, setAuthHeader = true, otpFail = false, npmNotice = false, xLocalCache = false } = opts;
      if (req.url.includes("otp-pkg")) {
        if (opts.expectedCI) {
          expect(req.headers.get("user-agent")).toContain("ci/" + opts.expectedCI);
        }
        if (req.headers.get("npm-otp") === token) {
          if (otpFail) {
            return new Response(
              JSON.stringify({
                error: "You must provide a one-time pass. Upgrade your client to npm@latest in order to use 2FA.",
              }),
              { status: 401 },
            );
          } else {
            return new Response("OK", { status: 200 });
          }
        } else {
          const headers = new Headers();
          if (setAuthHeader) headers.set("www-authenticate", "OTP");

          // `bun publish` won't request a url from a message in the npm-notice header, but we
          // can test that it's displayed
          if (npmNotice) headers.set("npm-notice", `visit http://localhost:${this.port}/auth to login`);

          // npm-notice will be ignored
          if (xLocalCache) headers.set("x-local-cache", "true");

          return new Response(
            JSON.stringify({
              // this isn't accurate, but we just want to check that finding this string works
              mock: setAuthHeader ? "" : "one-time password",

              authUrl: `http://localhost:${this.port}/auth`,
              doneUrl: `http://localhost:${this.port}/done`,
            }),
            {
              status: 401,
              headers,
            },
          );
        }
      } else if (req.url.endsWith("auth")) {
        expect.unreachable("url given to user, bun publish should not request");
      } else if (req.url.endsWith("done")) {
        // send a fake response saying the user has authenticated successfully with the auth url
        return new Response(JSON.stringify({ token: token }), { status: 200 });
      }

      expect.unreachable("unexpected url");
    };
  };

  for (const setAuthHeader of [true, false]) {
    test("mock web login" + (setAuthHeader ? "" : " (without auth header)"), async () => {
      const { packageDir, packageJson } = await registry.createTestDir();
      const token = await registry.generateUser("otp" + (setAuthHeader ? "" : "noheader"), "otp");

      using mockRegistry = Bun.serve({
        port: 0,
        fetch: mockRegistryFetch({ token }),
      });

      const bunfig = `
      [install]
      cache = false
      registry = { url = "http://localhost:${mockRegistry.port}", token = "${token}" }`;
      await Promise.all([
        rm(join(registry.packagesPath, "otp-pkg-1"), { recursive: true, force: true }),
        write(join(packageDir, "bunfig.toml"), bunfig),
        write(
          packageJson,
          JSON.stringify({
            name: "otp-pkg-1",
            version: "2.2.2",
            dependencies: {
              "otp-pkg-1": "2.2.2",
            },
          }),
        ),
      ]);

      const { out, err, exitCode } = await publish(env, packageDir);
      expect(exitCode).toBe(0);
    });
  }

  test("otp failure", async () => {
    const { packageDir, packageJson } = await registry.createTestDir();
    const token = await registry.generateUser("otp-fail", "otp");
    using mockRegistry = Bun.serve({
      port: 0,
      fetch: mockRegistryFetch({ token, otpFail: true }),
    });

    const bunfig = `
      [install]
      cache = false
      registry = { url = "http://localhost:${mockRegistry.port}", token = "${token}" }`;

    await Promise.all([
      rm(join(registry.packagesPath, "otp-pkg-2"), { recursive: true, force: true }),
      write(join(packageDir, "bunfig.toml"), bunfig),
      write(
        packageJson,
        JSON.stringify({
          name: "otp-pkg-2",
          version: "1.1.1",
          dependencies: {
            "otp-pkg-2": "1.1.1",
          },
        }),
      ),
    ]);

    const { out, err, exitCode } = await publish(env, packageDir);
    expect(exitCode).toBe(1);
    expect(err).toContain(" - Received invalid OTP");
  });

  for (const shouldIgnoreNotice of [false, true]) {
    test(`npm-notice with login url${shouldIgnoreNotice ? " (ignored)" : ""}`, async () => {
      const { packageDir, packageJson } = await registry.createTestDir();
      // Situation: user has 2FA enabled account with faceid sign-in.
      // They run `bun publish` with --auth-type=legacy, prompting them
      // to enter their OTP. Because they have faceid sign-in, they don't
      // have a code to enter, so npm sends a message in the npm-notice
      // header with a url for logging in.
      const token = await registry.generateUser(`otp-notice${shouldIgnoreNotice ? "-ignore" : ""}`, "otp");
      using mockRegistry = Bun.serve({
        port: 0,
        fetch: mockRegistryFetch({ token, npmNotice: true, xLocalCache: shouldIgnoreNotice }),
      });

      const bunfig = `
        [install]
        cache = false
        registry = { url = "http://localhost:${mockRegistry.port}", token = "${token}" }`;

      await Promise.all([
        rm(join(registry.packagesPath, "otp-pkg-3"), { recursive: true, force: true }),
        write(join(packageDir, "bunfig.toml"), bunfig),
        write(
          packageJson,
          JSON.stringify({
            name: "otp-pkg-3",
            version: "3.3.3",
            dependencies: {
              "otp-pkg-3": "3.3.3",
            },
          }),
        ),
      ]);

      const { out, err, exitCode } = await publish(env, packageDir);
      expect(exitCode).toBe(0);
      if (shouldIgnoreNotice) {
        expect(err).not.toContain(`note: visit http://localhost:${mockRegistry.port}/auth to login`);
      } else {
        expect(err).toContain(`note: visit http://localhost:${mockRegistry.port}/auth to login`);
      }
    });
  }

  const fakeCIEnvs = [
    { ci: "expo-application-services", envs: { EAS_BUILD: "hi" } },
    { ci: "codemagic", envs: { CM_BUILD_ID: "hi" } },
    { ci: "vercel", envs: { "NOW_BUILDER": "hi" } },
  ];
  for (const envInfo of fakeCIEnvs) {
    test(`CI user agent name: ${envInfo.ci}`, async () => {
      const { packageDir, packageJson } = await registry.createTestDir();
      const token = await registry.generateUser(`otp-${envInfo.ci}`, "otp");
      using mockRegistry = Bun.serve({
        port: 0,
        fetch: mockRegistryFetch({ token, expectedCI: envInfo.ci }),
      });

      const bunfig = `
        [install]
        cache = false
        registry = { url = "http://localhost:${mockRegistry.port}", token = "${token}" }`;

      await Promise.all([
        rm(join(registry.packagesPath, "otp-pkg-4"), { recursive: true, force: true }),
        write(join(packageDir, "bunfig.toml"), bunfig),
        write(
          packageJson,
          JSON.stringify({
            name: "otp-pkg-4",
            version: "4.4.4",
            dependencies: {
              "otp-pkg-4": "4.4.4",
            },
          }),
        ),
      ]);

      const { out, err, exitCode } = await publish(
        { ...env, ...envInfo.envs, ...{ BUILDKITE: undefined, GITHUB_ACTIONS: undefined } },
        packageDir,
      );
      expect(exitCode).toBe(0);
    });
  }
});

test("can publish a package then install it", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  const bunfig = await registry.authBunfig("basic");
  await Promise.all([
    rm(join(registry.packagesPath, "publish-pkg-1"), { recursive: true, force: true }),
    write(
      packageJson,
      JSON.stringify({
        name: "publish-pkg-1",
        version: "1.1.1",
        dependencies: {
          "publish-pkg-1": "1.1.1",
        },
      }),
    ),
    write(join(packageDir, "bunfig.toml"), bunfig),
  ]);

  const { out, err, exitCode } = await publish(env, packageDir);
  expect(err).not.toContain("error:");
  expect(err).not.toContain("warn:");
  expect(exitCode).toBe(0);

  await runBunInstall(env, packageDir);
  expect(await exists(join(packageDir, "node_modules", "publish-pkg-1", "package.json"))).toBeTrue();
});
test("can publish from a tarball", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  const bunfig = await registry.authBunfig("tarball");
  const json = {
    name: "publish-pkg-2",
    version: "2.2.2",
    dependencies: {
      "publish-pkg-2": "2.2.2",
    },
  };
  await Promise.all([
    rm(join(registry.packagesPath, "publish-pkg-2"), { recursive: true, force: true }),
    write(packageJson, JSON.stringify(json)),
    write(join(packageDir, "bunfig.toml"), bunfig),
  ]);

  await pack(packageDir, env);

  let { out, err, exitCode } = await publish(env, packageDir, "./publish-pkg-2-2.2.2.tgz");
  expect(err).not.toContain("error:");
  expect(err).not.toContain("warn:");
  expect(exitCode).toBe(0);

  await runBunInstall(env, packageDir);
  expect(await exists(join(packageDir, "node_modules", "publish-pkg-2", "package.json"))).toBeTrue();

  await Promise.all([
    rm(join(registry.packagesPath, "publish-pkg-2"), { recursive: true, force: true }),
    rm(join(packageDir, "bun.lockb"), { recursive: true, force: true }),
    rm(join(packageDir, "node_modules"), { recursive: true, force: true }),
  ]);

  // now with an absoute path
  ({ out, err, exitCode } = await publish(env, packageDir, join(packageDir, "publish-pkg-2-2.2.2.tgz")));
  expect(err).not.toContain("error:");
  expect(err).not.toContain("warn:");
  expect(exitCode).toBe(0);

  await runBunInstall(env, packageDir, { savesLockfile: false });
  expect(await file(join(packageDir, "node_modules", "publish-pkg-2", "package.json")).json()).toEqual(json);
});
test("can publish scoped packages", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  const bunfig = await registry.authBunfig("scoped-pkg");
  const json = {
    name: "@scoped/pkg-1",
    version: "1.1.1",
    dependencies: {
      "@scoped/pkg-1": "1.1.1",
    },
  };
  await Promise.all([
    rm(join(registry.packagesPath, "@scoped", "pkg-1"), { recursive: true, force: true }),
    write(packageJson, JSON.stringify(json)),
    write(join(packageDir, "bunfig.toml"), bunfig),
  ]);

  const { out, err, exitCode } = await publish(env, packageDir);
  expect(err).not.toContain("error:");
  expect(err).not.toContain("warn:");
  expect(exitCode).toBe(0);

  await runBunInstall(env, packageDir);
  expect(await file(join(packageDir, "node_modules", "@scoped", "pkg-1", "package.json")).json()).toEqual(json);
});

for (const info of [
  { user: "bin1", bin: "bin1.js" },
  { user: "bin2", bin: { bin1: "bin1.js", bin2: "bin2.js" } },
  { user: "bin3", directories: { bin: "bins" } },
]) {
  test(`can publish and install binaries with ${JSON.stringify(info)}`, async () => {
    const { packageDir, packageJson } = await registry.createTestDir({ saveTextLockfile: false });
    const publishDir = tmpdirSync();
    const bunfig = await registry.authBunfig("binaries-" + info.user);

    await Promise.all([
      rm(join(registry.packagesPath, "publish-pkg-" + info.user), { recursive: true, force: true }),
      write(
        join(publishDir, "package.json"),
        JSON.stringify({
          name: "publish-pkg-" + info.user,
          version: "1.1.1",
          ...info,
        }),
      ),
      write(join(publishDir, "bunfig.toml"), bunfig),
      write(join(publishDir, "bin1.js"), `#!/usr/bin/env bun\nconsole.log("bin1!")`),
      write(join(publishDir, "bin2.js"), `#!/usr/bin/env bun\nconsole.log("bin2!")`),
      write(join(publishDir, "bins", "bin3.js"), `#!/usr/bin/env bun\nconsole.log("bin3!")`),
      write(join(publishDir, "bins", "moredir", "bin4.js"), `#!/usr/bin/env bun\nconsole.log("bin4!")`),

      write(
        packageJson,
        JSON.stringify({
          name: "foo",
          dependencies: {
            ["publish-pkg-" + info.user]: "1.1.1",
          },
        }),
      ),
    ]);

    const { out, err, exitCode } = await publish(env, publishDir);
    expect(err).not.toContain("error:");
    expect(err).not.toContain("warn:");
    expect(out).toContain(`+ publish-pkg-${info.user}@1.1.1`);
    expect(exitCode).toBe(0);

    await runBunInstall(env, packageDir);

    const results = await Promise.all([
      exists(join(packageDir, "node_modules", ".bin", isWindows ? "bin1.bunx" : "bin1")),
      exists(join(packageDir, "node_modules", ".bin", isWindows ? "bin2.bunx" : "bin2")),
      exists(join(packageDir, "node_modules", ".bin", isWindows ? "bin3.js.bunx" : "bin3.js")),
      exists(join(packageDir, "node_modules", ".bin", isWindows ? "bin4.js.bunx" : "bin4.js")),
      exists(join(packageDir, "node_modules", ".bin", isWindows ? "moredir" : "moredir/bin4.js")),
      exists(
        join(
          packageDir,
          "node_modules",
          ".bin",
          isWindows ? `publish-pkg-${info.user}.bunx` : "publish-pkg-" + info.user,
        ),
      ),
    ]);

    switch (info.user) {
      case "bin1": {
        expect(results).toEqual([false, false, false, false, false, true]);
        break;
      }
      case "bin2": {
        expect(results).toEqual([true, true, false, false, false, false]);
        break;
      }
      case "bin3": {
        expect(results).toEqual([false, false, true, true, !isWindows, false]);
        break;
      }
    }
  });
}

test("dependencies are installed", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  const publishDir = tmpdirSync();
  const bunfig = await registry.authBunfig("manydeps");
  await Promise.all([
    rm(join(registry.packagesPath, "publish-pkg-deps"), { recursive: true, force: true }),
    write(
      join(publishDir, "package.json"),
      JSON.stringify(
        {
          name: "publish-pkg-deps",
          version: "1.1.1",
          dependencies: {
            "no-deps": "1.0.0",
          },
          peerDependencies: {
            "a-dep": "1.0.1",
          },
          optionalDependencies: {
            "basic-1": "1.0.0",
          },
        },
        null,
        2,
      ),
    ),
    write(join(publishDir, "bunfig.toml"), bunfig),
    write(
      packageJson,
      JSON.stringify({
        name: "foo",
        dependencies: {
          "publish-pkg-deps": "1.1.1",
        },
      }),
    ),
  ]);

  let { out, err, exitCode } = await publish(env, publishDir);
  expect(err).not.toContain("error:");
  expect(err).not.toContain("warn:");
  expect(out).toContain("+ publish-pkg-deps@1.1.1");
  expect(exitCode).toBe(0);

  await runBunInstall(env, packageDir);

  const results = await Promise.all([
    exists(join(packageDir, "node_modules", "no-deps", "package.json")),
    exists(join(packageDir, "node_modules", "a-dep", "package.json")),
    exists(join(packageDir, "node_modules", "basic-1", "package.json")),
  ]);

  expect(results).toEqual([true, true, true]);
});

test("can publish workspace package", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  const bunfig = await registry.authBunfig("workspace");
  const pkgJson = {
    name: "publish-pkg-3",
    version: "3.3.3",
    dependencies: {
      "publish-pkg-3": "3.3.3",
    },
  };
  await Promise.all([
    rm(join(registry.packagesPath, "publish-pkg-3"), { recursive: true, force: true }),
    write(join(packageDir, "bunfig.toml"), bunfig),
    write(
      packageJson,
      JSON.stringify({
        name: "root",
        workspaces: ["packages/*"],
      }),
    ),
    write(join(packageDir, "packages", "publish-pkg-3", "package.json"), JSON.stringify(pkgJson)),
  ]);

  await publish(env, join(packageDir, "packages", "publish-pkg-3"));

  await write(packageJson, JSON.stringify({ name: "root", "dependencies": { "publish-pkg-3": "3.3.3" } }));

  await runBunInstall(env, packageDir);

  expect(await file(join(packageDir, "node_modules", "publish-pkg-3", "package.json")).json()).toEqual(pkgJson);
});

describe("--dry-run", async () => {
  test("does not publish", async () => {
    const { packageDir, packageJson } = await registry.createTestDir();
    const bunfig = await registry.authBunfig("dryrun");
    await Promise.all([
      rm(join(registry.packagesPath, "dry-run-1"), { recursive: true, force: true }),
      write(join(packageDir, "bunfig.toml"), bunfig),
      write(
        packageJson,
        JSON.stringify({
          name: "dry-run-1",
          version: "1.1.1",
          dependencies: {
            "dry-run-1": "1.1.1",
          },
        }),
      ),
    ]);

    const { out, err, exitCode } = await publish(env, packageDir, "--dry-run");
    expect(exitCode).toBe(0);

    expect(await exists(join(registry.packagesPath, "dry-run-1"))).toBeFalse();
  });
  test("does not publish from tarball path", async () => {
    const { packageDir, packageJson } = await registry.createTestDir();
    const bunfig = await registry.authBunfig("dryruntarball");
    await Promise.all([
      rm(join(registry.packagesPath, "dry-run-2"), { recursive: true, force: true }),
      write(join(packageDir, "bunfig.toml"), bunfig),
      write(
        packageJson,
        JSON.stringify({
          name: "dry-run-2",
          version: "2.2.2",
          dependencies: {
            "dry-run-2": "2.2.2",
          },
        }),
      ),
    ]);

    await pack(packageDir, env);

    const { out, err, exitCode } = await publish(env, packageDir, "./dry-run-2-2.2.2.tgz", "--dry-run");
    expect(exitCode).toBe(0);

    expect(await exists(join(registry.packagesPath, "dry-run-2"))).toBeFalse();
  });
});

describe("lifecycle scripts", async () => {
  const script = `const fs = require("fs");
    fs.writeFileSync(process.argv[2] + ".txt", \`
prepublishOnly: \${fs.existsSync("prepublishOnly.txt")}
publish: \${fs.existsSync("publish.txt")}
postpublish: \${fs.existsSync("postpublish.txt")}
prepack: \${fs.existsSync("prepack.txt")}
prepare: \${fs.existsSync("prepare.txt")}
postpack: \${fs.existsSync("postpack.txt")}\`)`;
  const json = {
    name: "publish-pkg-4",
    version: "4.4.4",
    scripts: {
      // should happen in this order
      "prepublishOnly": `${bunExe()} script.js prepublishOnly`,
      "prepack": `${bunExe()} script.js prepack`,
      "prepare": `${bunExe()} script.js prepare`,
      "postpack": `${bunExe()} script.js postpack`,
      "publish": `${bunExe()} script.js publish`,
      "postpublish": `${bunExe()} script.js postpublish`,
    },
    dependencies: {
      "publish-pkg-4": "4.4.4",
    },
  };

  for (const arg of [[], ["--dry-run"]]) {
    test(`should run in order${arg.length > 0 ? " (--dry-run)" : ""}`, async () => {
      const { packageDir, packageJson } = await registry.createTestDir();
      const bunfig = await registry.authBunfig("lifecycle" + (arg.length > 0 ? "dry" : ""));
      await Promise.all([
        rm(join(registry.packagesPath, "publish-pkg-4"), { recursive: true, force: true }),
        write(packageJson, JSON.stringify(json)),
        write(join(packageDir, "script.js"), script),
        write(join(packageDir, "bunfig.toml"), bunfig),
      ]);

      const { out, err, exitCode } = await publish(env, packageDir, ...arg);
      expect(exitCode).toBe(0);

      const results = await Promise.all([
        file(join(packageDir, "prepublishOnly.txt")).text(),
        file(join(packageDir, "prepack.txt")).text(),
        file(join(packageDir, "prepare.txt")).text(),
        file(join(packageDir, "postpack.txt")).text(),
        file(join(packageDir, "publish.txt")).text(),
        file(join(packageDir, "postpublish.txt")).text(),
      ]);

      expect(results).toEqual([
        "\nprepublishOnly: false\npublish: false\npostpublish: false\nprepack: false\nprepare: false\npostpack: false",
        "\nprepublishOnly: true\npublish: false\npostpublish: false\nprepack: false\nprepare: false\npostpack: false",
        "\nprepublishOnly: true\npublish: false\npostpublish: false\nprepack: true\nprepare: false\npostpack: false",
        "\nprepublishOnly: true\npublish: false\npostpublish: false\nprepack: true\nprepare: true\npostpack: false",
        "\nprepublishOnly: true\npublish: false\npostpublish: false\nprepack: true\nprepare: true\npostpack: true",
        "\nprepublishOnly: true\npublish: true\npostpublish: false\nprepack: true\nprepare: true\npostpack: true",
      ]);
    });
  }

  test("--ignore-scripts", async () => {
    const { packageDir, packageJson } = await registry.createTestDir();
    const bunfig = await registry.authBunfig("ignorescripts");
    await Promise.all([
      rm(join(registry.packagesPath, "publish-pkg-5"), { recursive: true, force: true }),
      write(packageJson, JSON.stringify(json)),
      write(join(packageDir, "script.js"), script),
      write(join(packageDir, "bunfig.toml"), bunfig),
    ]);

    const { out, err, exitCode } = await publish(env, packageDir, "--ignore-scripts");
    expect(exitCode).toBe(0);

    const results = await Promise.all([
      exists(join(packageDir, "prepublishOnly.txt")),
      exists(join(packageDir, "prepack.txt")),
      exists(join(packageDir, "prepare.txt")),
      exists(join(packageDir, "postpack.txt")),
      exists(join(packageDir, "publish.txt")),
      exists(join(packageDir, "postpublish.txt")),
    ]);

    expect(results).toEqual([false, false, false, false, false, false]);
  });
});

test("attempting to publish a private package should fail", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  const bunfig = await registry.authBunfig("privatepackage");
  await Promise.all([
    rm(join(registry.packagesPath, "publish-pkg-6"), { recursive: true, force: true }),
    write(
      packageJson,
      JSON.stringify({
        name: "publish-pkg-6",
        version: "6.6.6",
        private: true,
        dependencies: {
          "publish-pkg-6": "6.6.6",
        },
      }),
    ),
    write(join(packageDir, "bunfig.toml"), bunfig),
  ]);

  // should fail
  let { out, err, exitCode } = await publish(env, packageDir);
  expect(exitCode).toBe(1);
  expect(err).toContain("error: attempted to publish a private package");
  expect(await exists(join(registry.packagesPath, "publish-pkg-6-6.6.6.tgz"))).toBeFalse();

  // try tarball
  await pack(packageDir, env);
  ({ out, err, exitCode } = await publish(env, packageDir, "./publish-pkg-6-6.6.6.tgz"));
  expect(exitCode).toBe(1);
  expect(err).toContain("error: attempted to publish a private package");
  expect(await exists(join(packageDir, "publish-pkg-6-6.6.6.tgz"))).toBeTrue();
});

describe("access", async () => {
  test("--access", async () => {
    const { packageDir, packageJson } = await registry.createTestDir();
    const bunfig = await registry.authBunfig("accessflag");
    await Promise.all([
      rm(join(registry.packagesPath, "publish-pkg-7"), { recursive: true, force: true }),
      write(join(packageDir, "bunfig.toml"), bunfig),
      write(
        packageJson,
        JSON.stringify({
          name: "publish-pkg-7",
          version: "7.7.7",
        }),
      ),
    ]);

    // should fail
    let { out, err, exitCode } = await publish(env, packageDir, "--access", "restricted");
    expect(exitCode).toBe(1);
    expect(err).toContain("error: unable to restrict access to unscoped package");

    ({ out, err, exitCode } = await publish(env, packageDir, "--access", "public"));
    expect(exitCode).toBe(0);

    expect(await exists(join(registry.packagesPath, "publish-pkg-7"))).toBeTrue();
  });

  for (const access of ["restricted", "public"]) {
    test(`access ${access}`, async () => {
      const { packageDir, packageJson } = await registry.createTestDir();
      const bunfig = await registry.authBunfig("access" + access);

      const pkgJson = {
        name: "@secret/publish-pkg-8",
        version: "8.8.8",
        dependencies: {
          "@secret/publish-pkg-8": "8.8.8",
        },
        publishConfig: {
          access,
        },
      };

      await Promise.all([
        rm(join(registry.packagesPath, "@secret", "publish-pkg-8"), { recursive: true, force: true }),
        write(join(packageDir, "bunfig.toml"), bunfig),
        write(packageJson, JSON.stringify(pkgJson)),
      ]);

      let { out, err, exitCode } = await publish(env, packageDir);
      expect(exitCode).toBe(0);

      await runBunInstall(env, packageDir);

      expect(await file(join(packageDir, "node_modules", "@secret", "publish-pkg-8", "package.json")).json()).toEqual(
        pkgJson,
      );
    });
  }
});

describe("tag", async () => {
  test("can publish with a tag", async () => {
    const { packageDir, packageJson } = await registry.createTestDir();
    const bunfig = await registry.authBunfig("simpletag");
    const pkgJson = {
      name: "publish-pkg-9",
      version: "9.9.9",
      dependencies: {
        "publish-pkg-9": "simpletag",
      },
    };
    await Promise.all([
      rm(join(registry.packagesPath, "publish-pkg-9"), { recursive: true, force: true }),
      write(join(packageDir, "bunfig.toml"), bunfig),
      write(packageJson, JSON.stringify(pkgJson)),
    ]);

    let { out, err, exitCode } = await publish(env, packageDir, "--tag", "simpletag");
    expect(exitCode).toBe(0);

    await runBunInstall(env, packageDir);
    expect(await file(join(packageDir, "node_modules", "publish-pkg-9", "package.json")).json()).toEqual(pkgJson);
  });
});

it("$npm_command is accurate during publish", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  await write(
    packageJson,
    JSON.stringify({
      name: "publish-pkg-10",
      version: "1.0.0",
      scripts: {
        publish: "echo $npm_command",
      },
    }),
  );
  await write(join(packageDir, "bunfig.toml"), await registry.authBunfig("npm_command"));
  await rm(join(registry.packagesPath, "publish-pkg-10"), { recursive: true, force: true });
  let { out, err, exitCode } = await publish(env, packageDir, "--tag", "simpletag");
  expect(err).toBe(`$ echo $npm_command\n`);
  expect(out.split("\n")).toEqual([
    `bun publish ${Bun.version_with_sha}`,
    ``,
    `packed 95B package.json`,
    ``,
    `Total files: 1`,
    expect.stringContaining(`Shasum: `),
    expect.stringContaining(`Integrity: sha512-`),
    `Unpacked size: 95B`,
    expect.stringContaining(`Packed size: `),
    `Tag: simpletag`,
    `Access: default`,
    `Registry: http://localhost:${registry.port}/`,
    ``,
    ` + publish-pkg-10@1.0.0`,
    `publish`,
    ``,
  ]);
  expect(exitCode).toBe(0);
});

it("$npm_lifecycle_event is accurate during publish", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  await write(
    packageJson,
    `{
      "name": "publish-pkg-11",
      "version": "1.0.0",
      "scripts": {
        "prepublish": "echo 1 $npm_lifecycle_event",
        "publish": "echo 2 $npm_lifecycle_event",
        "postpublish": "echo 3 $npm_lifecycle_event",
      },
    }
    `,
  );
  await write(join(packageDir, "bunfig.toml"), await registry.authBunfig("npm_lifecycle_event"));
  await rm(join(registry.packagesPath, "publish-pkg-11"), { recursive: true, force: true });
  let { out, err, exitCode } = await publish(env, packageDir, "--tag", "simpletag");
  expect(err).toBe(`$ echo 2 $npm_lifecycle_event\n$ echo 3 $npm_lifecycle_event\n`);
  expect(out.split("\n")).toEqual([
    `bun publish ${Bun.version_with_sha}`,
    ``,
    `packed 256B package.json`,
    ``,
    `Total files: 1`,
    expect.stringContaining(`Shasum: `),
    expect.stringContaining(`Integrity: sha512-`),
    `Unpacked size: 256B`,
    expect.stringContaining(`Packed size: `),
    `Tag: simpletag`,
    `Access: default`,
    `Registry: http://localhost:${registry.port}/`,
    ``,
    ` + publish-pkg-11@1.0.0`,
    `2 publish`,
    `3 postpublish`,
    ``,
  ]);
  expect(exitCode).toBe(0);
});
