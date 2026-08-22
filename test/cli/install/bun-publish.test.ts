import { file, spawn, write } from "bun";
import { afterAll, beforeAll, describe, expect, it, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { exists, rm } from "fs/promises";
import {
  VerdaccioRegistry,
  bunExe,
  bunEnv as env,
  isLinux,
  isWindows,
  pack,
  runBunInstall,
  tempDir,
  tmpdirSync,
} from "harness";
import { delimiter, join } from "path";

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

  const [out, err, exitCode] = await Promise.all([stdout.text(), stderr.text(), exited]);
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

      const bunfig = Bun.TOML.stringify({
        install: {
          cache: false,
          registry: { url: `http://localhost:${mockRegistry.port}`, token },
        },
      });
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

    const bunfig = Bun.TOML.stringify({
      install: {
        cache: false,
        registry: { url: `http://localhost:${mockRegistry.port}`, token },
      },
    });

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

  test("non-http auth url is shown without launching a browser and login completes via done url polling", async () => {
    const { packageDir, packageJson } = await registry.createTestDir();
    const token = await registry.generateUser("otp-classic-fallback", "otp");

    let doneHits = 0;
    using mockRegistry = Bun.serve({
      port: 0,
      fetch(req: Request) {
        if (req.method === "PUT") {
          if (req.headers.get("npm-otp") === token) {
            return new Response("OK", { status: 200 });
          }
          return new Response(
            JSON.stringify({
              authUrl: "customapp://login",
              doneUrl: `http://localhost:${mockRegistry.port}/done`,
            }),
            { status: 401, headers: { "www-authenticate": "OTP" } },
          );
        }
        if (req.url.endsWith("done")) {
          doneHits++;
          return new Response(JSON.stringify({ token }), { status: 200 });
        }
        return new Response("unexpected url", { status: 500 });
      },
    });

    const bunfig = Bun.TOML.stringify({
      install: {
        cache: false,
        registry: { url: `http://localhost:${mockRegistry.port}`, token },
      },
    });

    await Promise.all([
      rm(join(registry.packagesPath, "otp-pkg-5"), { recursive: true, force: true }),
      write(join(packageDir, "bunfig.toml"), bunfig),
      write(
        packageJson,
        JSON.stringify({
          name: "otp-pkg-5",
          version: "5.5.5",
          dependencies: {
            "otp-pkg-5": "5.5.5",
          },
        }),
      ),
    ]);

    await using proc = spawn({
      cmd: [bunExe(), "publish"],
      cwd: packageDir,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
      env,
    });

    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(out).toContain("Authenticate your account at:");
    expect(out).toContain("customapp://login");
    expect(out).not.toContain("open in browser");
    expect(out).not.toContain("Enter OTP: ");
    expect(doneHits).toBeGreaterThan(0);
    expect(out).toContain(" + otp-pkg-5@5.5.5");
    expect(exitCode).toBe(0);
  });

  test("done url on a different origin is not polled and login falls back to the OTP prompt", async () => {
    const packageDir = tmpdirSync();
    const otpCode = "424242";

    let foreignDoneHits = 0;
    using foreign = Bun.serve({
      port: 0,
      fetch() {
        foreignDoneHits++;
        return new Response(JSON.stringify({ token: otpCode }), { status: 200 });
      },
    });

    let localDoneHits = 0;
    using mockRegistry = Bun.serve({
      port: 0,
      fetch(req: Request) {
        if (req.method === "PUT") {
          if (req.headers.get("npm-otp") === otpCode) {
            return new Response("OK", { status: 200 });
          }
          return new Response(
            JSON.stringify({
              authUrl: "customapp://login",
              doneUrl: `http://127.0.0.1:${foreign.port}/done`,
            }),
            { status: 401, headers: { "www-authenticate": "OTP" } },
          );
        }
        if (req.url.endsWith("done")) {
          localDoneHits++;
          return new Response(JSON.stringify({ token: otpCode }), { status: 200 });
        }
        return new Response("unexpected url", { status: 500 });
      },
    });

    await Promise.all([
      write(
        join(packageDir, "bunfig.toml"),
        Bun.TOML.stringify({
          install: {
            cache: false,
            registry: { url: `http://localhost:${mockRegistry.port}`, token: "unused" },
          },
        }),
      ),
      write(join(packageDir, "package.json"), JSON.stringify({ name: "otp-pkg-6", version: "6.6.6" })),
    ]);

    await using proc = spawn({
      cmd: [bunExe(), "publish"],
      cwd: packageDir,
      stdout: "pipe",
      stderr: "pipe",
      stdin: Buffer.from(otpCode + "\n"),
      env,
    });

    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(out).toContain("Enter OTP: ");
    expect(out).not.toContain("Authenticate your account at");
    expect(foreignDoneHits).toBe(0);
    expect(localDoneHits).toBe(0);
    expect(out).toContain(" + otp-pkg-6@6.6.6");
    expect(exitCode).toBe(0);
  });

  test.skipIf(!isLinux)(
    "web login opens the auth url with the opener found on PATH, not one in the package directory",
    async () => {
      const otpCode = "515151";

      using dir = tempDir("publish-web-login-opener", {
        "package.json": JSON.stringify({ name: "otp-pkg-7", version: "7.7.7" }),
      });
      const packageDir = String(dir);
      const openedMarker = join(packageDir, "opened.txt");
      const openerScript = (label: string) =>
        `#!/bin/sh\nprintf '%s %s' '${label}' "$1" > '${join(packageDir, label + ".tmp")}' && mv '${join(packageDir, label + ".tmp")}' '${openedMarker}'\n`;
      mkdirSync(join(packageDir, "opener-bin"));
      writeFileSync(join(packageDir, "xdg-open"), openerScript("package-dir"), { mode: 0o755 });
      writeFileSync(join(packageDir, "opener-bin", "xdg-open"), openerScript("path"), { mode: 0o755 });
      chmodSync(join(packageDir, "xdg-open"), 0o755);
      chmodSync(join(packageDir, "opener-bin", "xdg-open"), 0o755);

      let donePolls = 0;
      using mockRegistry = Bun.serve({
        port: 0,
        fetch(req: Request) {
          if (req.method === "PUT") {
            if (req.headers.get("npm-otp") === otpCode) {
              return new Response("OK", { status: 200 });
            }
            return new Response(
              JSON.stringify({
                authUrl: `http://localhost:${mockRegistry.port}/auth`,
                doneUrl: `http://localhost:${mockRegistry.port}/done`,
              }),
              { status: 401, headers: { "www-authenticate": "OTP" } },
            );
          }
          if (req.url.endsWith("done")) {
            donePolls++;
            if (!existsSync(openedMarker) && donePolls < 40) {
              return new Response("{}", { status: 202 });
            }
            return new Response(JSON.stringify({ token: otpCode }), { status: 200 });
          }
          return new Response("unexpected url", { status: 500 });
        },
      });

      await write(
        join(packageDir, "bunfig.toml"),
        Bun.TOML.stringify({
          install: {
            cache: false,
            registry: { url: `http://localhost:${mockRegistry.port}`, token: "unused" },
          },
        }),
      );

      await using proc = spawn({
        cmd: [bunExe(), "publish"],
        cwd: packageDir,
        stdout: "pipe",
        stderr: "pipe",
        stdin: Buffer.from("\n"),
        env: {
          ...env,
          PATH: [join(packageDir, "opener-bin"), env.PATH ?? ""].join(delimiter),
        },
      });

      const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(out).toContain("open in browser");
      expect(out).toContain(`http://localhost:${mockRegistry.port}/auth`);
      expect(existsSync(openedMarker)).toBe(true);
      expect(readFileSync(openedMarker, "utf8")).toBe(`path http://localhost:${mockRegistry.port}/auth`);
      expect(out).toContain(" + otp-pkg-7@7.7.7");
      expect(exitCode).toBe(0);
    },
    30_000,
  );

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

      const bunfig = Bun.TOML.stringify({
        install: {
          cache: false,
          registry: { url: `http://localhost:${mockRegistry.port}`, token },
        },
      });

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

      const bunfig = Bun.TOML.stringify({
        install: {
          cache: false,
          registry: { url: `http://localhost:${mockRegistry.port}`, token },
        },
      });

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
    const { packageDir, packageJson } = await registry.createTestDir({ bunfigOpts: { saveTextLockfile: false } });
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
  test("registry summary line does not print userinfo from the registry url", async () => {
    const packageDir = tmpdirSync();
    await write(join(packageDir, "package.json"), JSON.stringify({ name: "dry-run-3", version: "3.3.3" }));

    const { out, err, exitCode } = await publish(
      { ...env, npm_config_registry: "http://someuser:hunter2@127.0.0.1:1/" },
      packageDir,
      "--dry-run",
    );
    expect(out).toContain("Registry: http://127.0.0.1:1/\n");
    expect(out).not.toContain("someuser");
    expect(out).not.toContain("hunter2");
    expect(err).not.toContain("hunter2");
    expect(exitCode).toBe(0);
  });
});

describe.concurrent("credentials in the registry url", () => {
  // Records every request, so a test can assert exactly what `bun publish` sent (one authenticated PUT, or nothing).
  function registryMock() {
    const requests: { method: string; pathname: string; authorization: string | null }[] = [];
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        requests.push({
          method: req.method,
          pathname: new URL(req.url).pathname,
          authorization: req.headers.get("authorization"),
        });
        return new Response("OK", { status: 200 });
      },
    });
    return {
      requests,
      port: server.port,
      [Symbol.dispose]: () => server.stop(true),
    };
  }

  async function packageDirFor(name: string) {
    const packageDir = tmpdirSync();
    await write(join(packageDir, "package.json"), JSON.stringify({ name, version: "1.0.0" }));
    return packageDir;
  }

  const basicAuth = `Basic ${Buffer.from("pubuser:hunter2").toString("base64")}`;

  test("--registry with user:pass@ publishes with Basic auth", async () => {
    using mock = registryMock();
    const packageDir = await packageDirFor("userinfo-flag-pkg");

    const { out, err, exitCode } = await publish(
      env,
      packageDir,
      "--registry",
      `http://pubuser:hunter2@localhost:${mock.port}/`,
    );
    expect(err).not.toContain("error:");
    expect(out).toContain(`Registry: http://localhost:${mock.port}/\n`);
    expect(out).toContain(" + userinfo-flag-pkg@1.0.0");
    expect(out).not.toContain("hunter2");
    expect(err).not.toContain("hunter2");
    expect(mock.requests).toEqual([{ method: "PUT", pathname: "/userinfo-flag-pkg", authorization: basicAuth }]);
    expect(exitCode).toBe(0);
  });

  test("--registry with :token@ publishes with a Bearer token", async () => {
    using mock = registryMock();
    const packageDir = await packageDirFor("userinfo-token-pkg");

    const { out, err, exitCode } = await publish(
      env,
      packageDir,
      "--registry",
      `http://:publish-token@localhost:${mock.port}/`,
    );
    expect(err).not.toContain("error:");
    expect(out).toContain(" + userinfo-token-pkg@1.0.0");
    expect(out).not.toContain("publish-token");
    expect(mock.requests).toEqual([
      { method: "PUT", pathname: "/userinfo-token-pkg", authorization: "Bearer publish-token" },
    ]);
    expect(exitCode).toBe(0);
  });

  test.each(["npm_config_registry", "NPM_CONFIG_REGISTRY", "BUN_CONFIG_REGISTRY"])(
    "%s with user:pass@ publishes with Basic auth",
    async key => {
      using mock = registryMock();
      const packageDir = await packageDirFor("userinfo-env-pkg");

      const { out, err, exitCode } = await publish(
        { ...env, [key]: `http://pubuser:hunter2@localhost:${mock.port}/` },
        packageDir,
      );
      expect(err).not.toContain("error:");
      expect(out).toContain(`Registry: http://localhost:${mock.port}/\n`);
      expect(out).toContain(" + userinfo-env-pkg@1.0.0");
      expect(out).not.toContain("hunter2");
      expect(err).not.toContain("hunter2");
      expect(mock.requests).toEqual([{ method: "PUT", pathname: "/userinfo-env-pkg", authorization: basicAuth }]);
      expect(exitCode).toBe(0);
    },
  );

  test("no credentials at all fails before sending a request", async () => {
    using mock = registryMock();
    const packageDir = await packageDirFor("no-credentials-pkg");

    const { err, exitCode } = await publish(env, packageDir, "--registry", `http://localhost:${mock.port}/`);
    expect(err).toBe("error: missing authentication (run `bunx npm login`)\n");
    expect(mock.requests).toEqual([]);
    expect(exitCode).toBe(1);
  });

  test("no credentials at all fails before sending a request (tarball path)", async () => {
    using mock = registryMock();
    const packageDir = await packageDirFor("no-credentials-tarball-pkg");
    await pack(packageDir, env);

    const { err, exitCode } = await publish(
      env,
      packageDir,
      "./no-credentials-tarball-pkg-1.0.0.tgz",
      "--registry",
      `http://localhost:${mock.port}/`,
    );
    expect(err).toBe("error: missing authentication (run `bunx npm login`)\n");
    expect(mock.requests).toEqual([]);
    expect(exitCode).toBe(1);
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

test("prepublishOnly modifying version publishes correct version (#17195)", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  const bunfig = await registry.authBunfig("version-update");
  const updateScript = `const fs = require("fs");
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
    pkg.version = "9.9.9";
    fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2));`;

  await Promise.all([
    rm(join(registry.packagesPath, "publish-version-update"), { recursive: true, force: true }),
    write(
      packageJson,
      JSON.stringify({
        name: "publish-version-update",
        version: "1.0.0",
        scripts: {
          prepublishOnly: `${bunExe()} update-version.js`,
        },
        dependencies: {
          "publish-version-update": "9.9.9",
        },
      }),
    ),
    write(join(packageDir, "update-version.js"), updateScript),
    write(join(packageDir, "bunfig.toml"), bunfig),
  ]);

  const { out, err, exitCode } = await publish(env, packageDir);
  expect(err).not.toContain("error:");
  expect(exitCode).toBe(0);

  // Should be able to install the package at the UPDATED version (9.9.9), not the original (1.0.0)
  await runBunInstall(env, packageDir);
  const installedPkg = await file(join(packageDir, "node_modules", "publish-version-update", "package.json")).json();
  expect(installedPkg.version).toBe("9.9.9");
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
    `packed 107B package.json`,
    ``,
    `Total files: 1`,
    expect.stringContaining(`Shasum: `),
    expect.stringContaining(`Integrity: sha512-`),
    `Unpacked size: 107B`,
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

describe("readme", () => {
  // Regression for https://github.com/oven-sh/bun/issues/30255 — `bun publish`
  // packed the README into the tarball but never populated the version-level
  // `readme` / `readmeFilename` fields, so the registry stored an empty readme.

  test("workspace publish sends README contents as readme / readmeFilename", async () => {
    let captured: any = null;
    using mock = Bun.serve({
      port: 0,
      async fetch(req) {
        if (req.method === "PUT") captured = await req.json();
        return new Response("OK", { status: 200 });
      },
    });

    const packageDir = tmpdirSync();
    const readmeContents = "# readme-pkg-1\n\nA readme.";
    await Promise.all([
      write(
        join(packageDir, "bunfig.toml"),
        Bun.TOML.stringify({
          install: {
            cache: false,
            registry: { url: `http://localhost:${mock.port}`, token: "unused" },
          },
        }),
      ),
      write(join(packageDir, "package.json"), JSON.stringify({ name: "readme-pkg-1", version: "1.0.0" })),
      write(join(packageDir, "README.md"), readmeContents),
    ]);

    const { err, exitCode } = await publish(env, packageDir);
    expect(err).not.toContain("error:");
    expect(exitCode).toBe(0);

    expect(captured.versions["1.0.0"]).toMatchObject({
      readme: readmeContents,
      readmeFilename: "README.md",
    });
  });

  test("tarball publish sends README contents from inside the archive", async () => {
    let captured: any = null;
    using mock = Bun.serve({
      port: 0,
      async fetch(req) {
        if (req.method === "PUT") captured = await req.json();
        return new Response("OK", { status: 200 });
      },
    });

    const packageDir = tmpdirSync();
    const readmeContents = "# readme-pkg-2\n\nFrom inside the tarball.";
    await Promise.all([
      write(join(packageDir, "package.json"), JSON.stringify({ name: "readme-pkg-2", version: "2.0.0" })),
      write(join(packageDir, "README.md"), readmeContents),
    ]);

    await pack(packageDir, env);
    await write(
      join(packageDir, "bunfig.toml"),
      Bun.TOML.stringify({
        install: {
          cache: false,
          registry: { url: `http://localhost:${mock.port}`, token: "unused" },
        },
      }),
    );

    const { err, exitCode } = await publish(env, packageDir, "./readme-pkg-2-2.0.0.tgz");
    expect(err).not.toContain("error:");
    expect(exitCode).toBe(0);

    expect(captured.versions["2.0.0"]).toMatchObject({
      readme: readmeContents,
      readmeFilename: "README.md",
    });
  });
});

test("dist.tarball in the published manifest does not include userinfo from the registry url", async () => {
  let captured: any = null;
  using mock = Bun.serve({
    port: 0,
    async fetch(req) {
      if (req.method === "PUT") captured = await req.json();
      return new Response("OK", { status: 200 });
    },
  });

  const packageDir = tmpdirSync();
  await write(join(packageDir, "package.json"), JSON.stringify({ name: "tarball-url-pkg", version: "1.0.0" }));

  const { out, err, exitCode } = await publish(
    env,
    packageDir,
    "--registry",
    `http://pubuser:hunter2@localhost:${mock.port}/`,
  );
  expect(err).not.toContain("error:");
  expect(out).toContain(" + tarball-url-pkg@1.0.0");
  const tarball: string = captured.versions["1.0.0"].dist.tarball;
  expect(tarball).not.toContain("pubuser");
  expect(tarball).not.toContain("hunter2");
  expect(tarball).not.toContain("@");
  expect(tarball).toBe(`http://localhost:${mock.port}/tarball-url-pkg/-/tarball-url-pkg-1.0.0.tgz`);
  expect(exitCode).toBe(0);
});

describe.concurrent("basic auth", () => {
  // Every spelling below makes `bun install` send `Authorization: Basic`, and npm publishes with
  // all of them. `bun publish` used to stop with "missing authentication" unless a bearer token
  // was configured, before sending anything. https://github.com/oven-sh/bun/issues/18670
  const username = "alice";
  const password = "s3cret";
  const userPass = Buffer.from(`${username}:${password}`).toString("base64");

  const configs: [name: string, files: (host: string) => Record<string, string>][] = [
    [".npmrc _auth", host => ({ ".npmrc": `registry=http://${host}/\n//${host}/:_auth=${userPass}\n` })],
    [
      ".npmrc username and _password",
      host => ({
        ".npmrc": [
          `registry=http://${host}/`,
          `//${host}/:username=${username}`,
          `//${host}/:_password=${Buffer.from(password).toString("base64")}`,
          "",
        ].join("\n"),
      }),
    ],
    [".npmrc registry url with userinfo", host => ({ ".npmrc": `registry=http://${username}:${password}@${host}/\n` })],
    [
      "bunfig.toml registry username and password",
      host => ({
        "bunfig.toml": Bun.TOML.stringify({
          install: { cache: false, registry: { url: `http://${host}/`, username, password } },
        }),
      }),
    ],
  ];

  async function publishWith(files: (host: string) => Record<string, string>) {
    const requests: string[] = [];
    using mock = Bun.serve({
      port: 0,
      fetch(req) {
        requests.push(`${req.method} ${new URL(req.url).pathname} ${req.headers.get("authorization")}`);
        return new Response("OK", { status: 200 });
      },
    });

    using dir = tempDir("publish-basic-auth", {
      "package.json": JSON.stringify({ name: "basic-auth-pkg", version: "1.0.0" }),
      // Empty home directory so the machine's own .npmrc / bunfig.toml cannot supply credentials.
      "home/.keep": "",
      ...files(`localhost:${mock.port}`),
    });
    const home = join(String(dir), "home");

    const result = await publish({ ...env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: home }, String(dir));
    return { ...result, requests };
  }

  test.each(configs)("%s", async (_, files) => {
    const { out, err, exitCode, requests } = await publishWith(files);
    expect(err).not.toContain("error:");
    expect(out).toContain(" + basic-auth-pkg@1.0.0");
    expect(requests).toEqual([`PUT /basic-auth-pkg Basic ${userPass}`]);
    expect(exitCode).toBe(0);
  });

  test("still refuses to publish without any credentials", async () => {
    const { out, err, exitCode, requests } = await publishWith(host => ({ ".npmrc": `registry=http://${host}/\n` }));
    expect(err).toContain("error: missing authentication (run `bunx npm login`)");
    expect(out).not.toContain(" + basic-auth-pkg@1.0.0");
    expect(requests).toEqual([]);
    expect(exitCode).toBe(1);
  });
});

describe("--tolerate-republish", async () => {
  test("republishing normally fails", async () => {
    const { packageDir, packageJson } = await registry.createTestDir();
    const bunfig = await registry.authBunfig("republish-fail");
    const pkgJson = {
      name: "republish-test-1",
      version: "1.0.0",
    };

    await Promise.all([
      rm(join(registry.packagesPath, "republish-test-1"), { recursive: true, force: true }),
      write(join(packageDir, "bunfig.toml"), bunfig),
      write(packageJson, JSON.stringify(pkgJson)),
    ]);

    // First publish should succeed
    let { out, err, exitCode } = await publish(env, packageDir);
    expect(exitCode).toBe(0);
    expect(out).toContain("+ republish-test-1@1.0.0");

    // Second publish should fail
    ({ out, err, exitCode } = await publish(env, packageDir));
    expect(exitCode).toBe(1);
    expect(err).toMatch(/403|409|already exists|already present|cannot publish/);
  });

  test("republishing with --tolerate-republish skips when version exists", async () => {
    const { packageDir, packageJson } = await registry.createTestDir();
    const bunfig = await registry.authBunfig("republish-tolerate");
    const pkgJson = {
      name: "republish-test-2",
      version: "1.0.0",
    };

    await Promise.all([
      rm(join(registry.packagesPath, "republish-test-2"), { recursive: true, force: true }),
      write(join(packageDir, "bunfig.toml"), bunfig),
      write(packageJson, JSON.stringify(pkgJson)),
    ]);

    // First publish should succeed
    let { out, err, exitCode } = await publish(env, packageDir);
    expect(exitCode).toBe(0);
    expect(out).toContain("+ republish-test-2@1.0.0");

    // Second publish with --tolerate-republish should skip
    ({ out, err, exitCode } = await publish(env, packageDir, "--tolerate-republish"));
    expect(exitCode).toBe(0);
    expect(err).toBe("warn: Registry already knows about version 1.0.0; skipping.\n");
    expect(err).not.toContain("error:");
  });

  test("republishing tarball with --tolerate-republish skips when version exists", async () => {
    const { packageDir, packageJson } = await registry.createTestDir();
    const bunfig = await registry.authBunfig("republish-tarball");
    const pkgJson = {
      name: "republish-test-3",
      version: "1.0.0",
    };

    await Promise.all([
      rm(join(registry.packagesPath, "republish-test-3"), { recursive: true, force: true }),
      write(join(packageDir, "bunfig.toml"), bunfig),
      write(packageJson, JSON.stringify(pkgJson)),
    ]);

    // Create tarball
    await pack(packageDir, env);

    // First publish should succeed
    let { out, err, exitCode } = await publish(env, packageDir, "./republish-test-3-1.0.0.tgz");
    expect(exitCode).toBe(0);
    expect(out).toContain("+ republish-test-3@1.0.0");

    // Second publish with --tolerate-republish should skip
    ({ out, err, exitCode } = await publish(env, packageDir, "./republish-test-3-1.0.0.tgz", "--tolerate-republish"));
    expect(exitCode).toBe(0);
    expect(err).toBe("warn: Registry already knows about version 1.0.0; skipping.\n");
    expect(err).not.toContain("error:");
  });
});
