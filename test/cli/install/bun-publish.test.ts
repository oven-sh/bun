import { file, spawn, write } from "bun";
import { afterAll, beforeAll, describe, expect, it, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { exists, rm, symlink } from "fs/promises";
import {
  VerdaccioRegistry,
  bunExe,
  bunEnv as env,
  isLinux,
  isWindows,
  pack,
  runBunInstall,
  tempDir,
  tls,
  tmpdirSync,
  unprivilegedSpawnOptions,
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
describe("relative tarball path", () => {
  // `bun publish` chdirs to the package root (or the workspace root) before it reads the tarball.
  // The path on the command line still has to be resolved against the directory the command ran from.
  // --dry-run never talks to the registry, so a bogus one with auth in the url is enough.
  const dryRunEnv = { ...env, npm_config_registry: "http://someuser:hunter2@127.0.0.1:1/" };

  test.concurrent("is resolved against the cwd, not the package root above it", async () => {
    using dir = tempDir("publish-tarball-cwd", {
      "package.json": JSON.stringify({ name: "publish-tarball-cwd-root", version: "0.0.0" }),
      "stale-src/package.json": JSON.stringify({ name: "publish-tarball-cwd-stale", version: "0.0.1" }),
      "dist-src/package.json": JSON.stringify({ name: "publish-tarball-cwd-dist", version: "9.9.9" }),
      "dist": {},
    });
    // a same-named tarball in the package root, and the one we actually mean in ./dist
    await pack(join(String(dir), "stale-src"), env, "--filename", join(String(dir), "rel.tgz"));
    await pack(join(String(dir), "dist-src"), env, "--filename", join(String(dir), "dist", "rel.tgz"));

    const { out, err, exitCode } = await publish(dryRunEnv, join(String(dir), "dist"), "./rel.tgz", "--dry-run");
    expect(err).not.toContain("error:");
    expect(out).toContain(" + publish-tarball-cwd-dist@9.9.9");
    expect(out).not.toContain("publish-tarball-cwd-stale");
    expect(exitCode).toBe(0);
  });

  test.concurrent("is found when the cwd is a subdirectory of the package root", async () => {
    using dir = tempDir("publish-tarball-subdir", {
      "package.json": JSON.stringify({ name: "publish-tarball-subdir-root", version: "0.0.0" }),
      "dist-src/package.json": JSON.stringify({ name: "publish-tarball-subdir-dist", version: "1.0.0" }),
      "dist": {},
    });
    await pack(join(String(dir), "dist-src"), env, "--filename", join(String(dir), "dist", "pkg.tgz"));

    const { out, err, exitCode } = await publish(dryRunEnv, join(String(dir), "dist"), "pkg.tgz", "--dry-run");
    expect(err).not.toContain("ENOENT");
    expect(out).toContain(" + publish-tarball-subdir-dist@1.0.0");
    expect(exitCode).toBe(0);
  });

  test.concurrent("is found when the cwd is a workspace package", async () => {
    using dir = tempDir("publish-tarball-workspace", {
      "package.json": JSON.stringify({
        name: "publish-tarball-workspace-root",
        version: "0.0.0",
        workspaces: ["packages/*"],
      }),
      "packages/member/package.json": JSON.stringify({ name: "publish-tarball-workspace-member", version: "1.2.3" }),
    });
    const memberDir = join(String(dir), "packages", "member");
    await pack(memberDir, env);
    expect(await exists(join(memberDir, "publish-tarball-workspace-member-1.2.3.tgz"))).toBeTrue();

    const { out, err, exitCode } = await publish(
      dryRunEnv,
      memberDir,
      "./publish-tarball-workspace-member-1.2.3.tgz",
      "--dry-run",
    );
    expect(err).not.toContain("ENOENT");
    expect(out).toContain(" + publish-tarball-workspace-member@1.2.3");
    expect(exitCode).toBe(0);
  });
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

describe("bin longer than the path buffer", () => {
  // Longer than the path buffer on every platform (98302 bytes on Windows), so
  // nothing on disk can have this name.
  const long = Buffer.alloc(100_000, "b").toString();
  // The registry is never contacted with --dry-run; the userinfo only satisfies the auth check.
  const dryRunEnv = { ...env, npm_config_registry: "http://user:pass@127.0.0.1:1/" };

  test.each([
    ["bin", { bin: long }, "warn: bin '<long>' does not exist"],
    ["bin object value", { bin: { cli: long } }, "warn: bin '<long>' does not exist"],
    ["bin object key", { bin: { [long]: "cli.js" } }, null],
    ["directories.bin", { directories: { bin: long } }, "warn: bin directory '<long>' does not exist"],
  ])("tarball with a long %s", async (_, fields, warning) => {
    const packageDir = tmpdirSync();
    const packageJson = JSON.stringify({ name: "publish-long-bin", version: "1.0.0", ...fields });
    await Promise.all([
      write(join(packageDir, "package.json"), packageJson),
      write(join(packageDir, "cli.js"), ""),
      Bun.Archive.write(
        join(packageDir, "publish-long-bin-1.0.0.tgz"),
        { "package/package.json": packageJson },
        { compress: "gzip" },
      ),
    ]);

    const { out, err, exitCode } = await publish(dryRunEnv, packageDir, "./publish-long-bin-1.0.0.tgz", "--dry-run");
    const stderr = err.replaceAll(long, "<long>");
    expect(stderr.split("\n").filter(line => line.startsWith("warn:"))).toEqual(warning === null ? [] : [warning]);
    expect(stderr).not.toContain("error:");
    expect(out).toContain("+ publish-long-bin@1.0.0 (dry-run)");
    expect(exitCode).toBe(0);
  });

  test("directory with a long bin", async () => {
    const packageDir = tmpdirSync();
    await write(
      join(packageDir, "package.json"),
      JSON.stringify({ name: "publish-long-bin", version: "1.0.0", bin: long }),
    );

    const { out, err, exitCode } = await publish(dryRunEnv, packageDir, "--dry-run");
    expect(err).not.toContain("error:");
    expect(out).toContain("+ publish-long-bin@1.0.0 (dry-run)");
    expect(exitCode).toBe(0);
  });
});

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

// https://github.com/oven-sh/bun/issues/20477: releases bump the versions after the last `bun install`,
// so the manifest sent to the registry has to use the package.json files, not bun.lock.
test("publishes the workspace versions and catalog ranges currently in package.json", async () => {
  let captured: any = null;
  using mock = Bun.serve({
    port: 0,
    async fetch(req) {
      if (req.method === "PUT") captured = await req.json();
      return new Response("OK", { status: 200 });
    },
  });

  const packageDir = tmpdirSync();
  const coreDir = join(packageDir, "packages", "core");
  const utilsDir = join(packageDir, "packages", "utils");
  const rootPackageJson = (react: string) =>
    JSON.stringify({ name: "mono", private: true, workspaces: { packages: ["packages/*"], catalog: { react } } });
  const corePackageJson = (version: string) => JSON.stringify({ name: "@acme/core", version });
  const utilsPackageJson = (version: string) =>
    JSON.stringify({
      name: "@acme/utils",
      version,
      dependencies: { "@acme/core": "workspace:*" },
      peerDependencies: { "@acme/core": "workspace:^", "react": "catalog:" },
      // optional so that `bun install` does not ask the mock registry for react
      peerDependenciesMeta: { react: { optional: true } },
    });

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
    write(join(packageDir, "package.json"), rootPackageJson("^18.3.1")),
    write(join(coreDir, "package.json"), corePackageJson("1.2.3")),
    write(join(utilsDir, "package.json"), utilsPackageJson("0.4.0")),
  ]);
  await runBunInstall(env, packageDir);

  // the release bump, without another install
  await Promise.all([
    write(join(packageDir, "package.json"), rootPackageJson("^19.1.0")),
    write(join(coreDir, "package.json"), corePackageJson("1.3.0")),
    write(join(utilsDir, "package.json"), utilsPackageJson("0.4.1")),
  ]);

  const { err, exitCode } = await publish(env, utilsDir);
  expect(err).not.toContain("error:");
  expect(exitCode).toBe(0);

  expect(captured.versions["0.4.1"]).toMatchObject({
    name: "@acme/utils",
    version: "0.4.1",
    dependencies: { "@acme/core": "1.3.0" },
    peerDependencies: { "@acme/core": "^1.3.0", "react": "^19.1.0" },
  });
});

test("publishes a workspace package next to a bun.lock that does not parse", async () => {
  let captured: any = null;
  using mock = Bun.serve({
    port: 0,
    async fetch(req) {
      if (req.method === "PUT") captured = await req.json();
      return new Response("OK", { status: 200 });
    },
  });

  const packageDir = tmpdirSync();
  const utilsDir = join(packageDir, "packages", "utils");
  await Promise.all([
    write(
      join(packageDir, "bunfig.toml"),
      Bun.TOML.stringify({
        install: { registry: { url: `http://localhost:${mock.port}`, token: "unused" } },
      }),
    ),
    write(
      join(packageDir, "package.json"),
      JSON.stringify({ name: "mono", private: true, workspaces: ["packages/*"] }),
    ),
    write(join(packageDir, "bun.lock"), "<<<<<<< HEAD\n"),
    write(
      join(packageDir, "packages", "core", "package.json"),
      JSON.stringify({ name: "@acme/core", version: "1.3.0" }),
    ),
    write(
      join(utilsDir, "package.json"),
      JSON.stringify({ name: "@acme/utils", version: "0.4.1", dependencies: { "@acme/core": "workspace:^" } }),
    ),
  ]);

  const { err, exitCode } = await publish(env, utilsDir);
  expect(err).toBe("");
  expect(exitCode).toBe(0);

  expect(captured.versions["0.4.1"]).toMatchObject({
    name: "@acme/utils",
    version: "0.4.1",
    dependencies: { "@acme/core": "^1.3.0" },
  });
});

test("a published package can depend on another workspace by its directory", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  const bunfig = await registry.authBunfig("workspacepath");
  const corePkgJson = { name: "publish-pkg-path-core", version: "1.2.3" };
  await Promise.all([
    rm(join(registry.packagesPath, "publish-pkg-path-core"), { recursive: true, force: true }),
    rm(join(registry.packagesPath, "publish-pkg-path-ui"), { recursive: true, force: true }),
    write(join(packageDir, "bunfig.toml"), bunfig),
    write(packageJson, JSON.stringify({ name: "root", workspaces: ["packages/*"] })),
    write(join(packageDir, "packages", "core", "package.json"), JSON.stringify(corePkgJson)),
    write(
      join(packageDir, "packages", "ui", "package.json"),
      JSON.stringify({
        name: "publish-pkg-path-ui",
        version: "2.0.0",
        dependencies: {
          "core-alias": "workspace:../core",
          "publish-pkg-path-core": "workspace:../core",
        },
      }),
    ),
  ]);

  for (const pkg of ["core", "ui"]) {
    const { out, err, exitCode } = await publish(env, join(packageDir, "packages", pkg));
    expect(err).not.toContain("error:");
    expect(out).toContain(`+ publish-pkg-path-${pkg}@`);
    expect(exitCode).toBe(0);
  }

  // consume the published package from the registry
  await Promise.all([
    rm(join(packageDir, "packages"), { recursive: true, force: true }),
    write(packageJson, JSON.stringify({ name: "root", dependencies: { "publish-pkg-path-ui": "2.0.0" } })),
  ]);
  await runBunInstall(env, packageDir);

  expect(await file(join(packageDir, "node_modules", "publish-pkg-path-ui", "package.json")).json()).toEqual({
    name: "publish-pkg-path-ui",
    version: "2.0.0",
    dependencies: {
      "core-alias": "npm:publish-pkg-path-core@1.2.3",
      "publish-pkg-path-core": "1.2.3",
    },
  });
  expect(
    await Promise.all([
      file(join(packageDir, "node_modules", "core-alias", "package.json")).json(),
      file(join(packageDir, "node_modules", "publish-pkg-path-core", "package.json")).json(),
    ]),
  ).toEqual([corePkgJson, corePkgJson]);
});

test("a published package can depend on another workspace through a workspace: alias", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  const bunfig = await registry.authBunfig("workspacealias");
  const corePkgJson = { name: "publish-pkg-alias-core", version: "1.2.3" };
  await Promise.all([
    rm(join(registry.packagesPath, "publish-pkg-alias-core"), { recursive: true, force: true }),
    rm(join(registry.packagesPath, "publish-pkg-alias-ui"), { recursive: true, force: true }),
    write(join(packageDir, "bunfig.toml"), bunfig),
    write(packageJson, JSON.stringify({ name: "root", workspaces: ["packages/*"] })),
    write(join(packageDir, "packages", "core", "package.json"), JSON.stringify(corePkgJson)),
    write(
      join(packageDir, "packages", "ui", "package.json"),
      JSON.stringify({
        name: "publish-pkg-alias-ui",
        version: "2.0.0",
        dependencies: {
          "core-alias": "workspace:publish-pkg-alias-core@*",
          "core-compatible": "workspace:publish-pkg-alias-core@^",
          "publish-pkg-alias-core": "workspace:publish-pkg-alias-core@*",
        },
      }),
    ),
  ]);

  for (const pkg of ["core", "ui"]) {
    const { out, err, exitCode } = await publish(env, join(packageDir, "packages", pkg));
    expect(err).not.toContain("error:");
    expect(out).toContain(`+ publish-pkg-alias-${pkg}@`);
    expect(exitCode).toBe(0);
  }

  // consume the published package from the registry
  await Promise.all([
    rm(join(packageDir, "packages"), { recursive: true, force: true }),
    write(packageJson, JSON.stringify({ name: "root", dependencies: { "publish-pkg-alias-ui": "2.0.0" } })),
  ]);
  await runBunInstall(env, packageDir);

  expect(await file(join(packageDir, "node_modules", "publish-pkg-alias-ui", "package.json")).json()).toEqual({
    name: "publish-pkg-alias-ui",
    version: "2.0.0",
    dependencies: {
      "core-alias": "npm:publish-pkg-alias-core@1.2.3",
      "core-compatible": "npm:publish-pkg-alias-core@^1.2.3",
      "publish-pkg-alias-core": "1.2.3",
    },
  });
  expect(
    await Promise.all([
      file(join(packageDir, "node_modules", "core-alias", "package.json")).json(),
      file(join(packageDir, "node_modules", "core-compatible", "package.json")).json(),
      file(join(packageDir, "node_modules", "publish-pkg-alias-core", "package.json")).json(),
    ]),
  ).toEqual([corePkgJson, corePkgJson, corePkgJson]);
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
  // Publishing from a directory used to unlink `<name>-<version>.tgz` in the package directory
  // (where it packed to), also with --dry-run, where nothing had been packed and the file was
  // whatever the user had put there.
  test("leaves a tarball that is already in the package directory alone", async () => {
    const { packageDir, packageJson } = await registry.createTestDir();
    const bunfig = await registry.authBunfig("dryrunexisting");
    await Promise.all([
      rm(join(registry.packagesPath, "dry-run-3"), { recursive: true, force: true }),
      write(join(packageDir, "bunfig.toml"), bunfig),
      write(packageJson, JSON.stringify({ name: "dry-run-3", version: "3.3.3" })),
    ]);
    await pack(packageDir, env);
    const tarball = join(packageDir, "dry-run-3-3.3.3.tgz");
    const packed = await file(tarball).bytes();

    const { exitCode } = await publish(env, packageDir, "--dry-run");

    expect({ exitCode, tarballExists: await exists(tarball) }).toEqual({ exitCode: 0, tarballExists: true });
    expect(await file(tarball).bytes()).toEqual(packed);
    expect(await exists(join(registry.packagesPath, "dry-run-3"))).toBeFalse();
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
  // publish only reads package.json, so a file that is readable but not writable (a
  // read-only checkout, a file owned by another user) must not stop it.
  test.skipIf(isWindows)("read-only package.json", async () => {
    using dir = tempDir("publish-read-only", {
      "package.json": JSON.stringify({ name: "dry-run-read-only", version: "4.4.4" }),
      "index.js": "",
    });
    chmodSync(join(String(dir), "package.json"), 0o444);
    using unprivileged = unprivilegedSpawnOptions(String(dir));

    await using proc = spawn({
      cmd: [bunExe(), "publish", "--dry-run"],
      cwd: String(dir),
      // Credentials in the URL satisfy the auth check; --dry-run stops before any request.
      env: { ...env, npm_config_registry: "http://someuser:hunter2@127.0.0.1:1/" },
      stdout: "pipe",
      stderr: "pipe",
      ...unprivileged,
    });
    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(err).toBe("");
    expect(out).toContain(" + dry-run-read-only@4.4.4 (dry-run)");
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

  // `http://user@host/` is `user` with an empty password (npm publishes with `Basic base64("user:")`);
  // bun used to stop with "missing authentication". Spelled `user:@` because `user@host:port` does not
  // get through bun's URL parser yet (#16181); both reach the registry config as a username without a password.
  test("--registry with user:@ publishes with Basic auth and an empty password", async () => {
    using mock = registryMock();
    const packageDir = await packageDirFor("userinfo-no-password-pkg");

    const { out, err, exitCode } = await publish(
      env,
      packageDir,
      "--registry",
      `http://pubuser:@localhost:${mock.port}/`,
    );
    expect(err).not.toContain("error:");
    expect(out).toContain(`Registry: http://localhost:${mock.port}/\n`);
    expect(out).toContain(" + userinfo-no-password-pkg@1.0.0");
    expect(mock.requests).toEqual([
      {
        method: "PUT",
        pathname: "/userinfo-no-password-pkg",
        authorization: `Basic ${Buffer.from("pubuser:").toString("base64")}`,
      },
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

describe.concurrent("tarball path", () => {
  // --dry-run stops before the first request, so credentials in the registry url are enough
  // for the auth check and the closed port guarantees nothing is contacted.
  const dryRunEnv = { ...env, npm_config_registry: "http://someuser:hunter2@127.0.0.1:1/" };

  function packageDir(dirName: string, packageName: string) {
    return tempDir(dirName, { "package.json": JSON.stringify({ name: packageName, version: "1.0.0" }) });
  }

  // The tarball path is resolved against the package directory (`${dir}/${tarballPath}`) into a
  // buffer of MAX_PATH_BYTES (src/bun_core/util.rs): 4096 bytes on Linux, 1024 on macOS and, on
  // Windows, the longest possible command line (32767 UTF-16 units) at three UTF-8 bytes per unit.
  const PATH_BUFFER_BYTES = isWindows ? 32767 * 3 + 1 : isLinux ? 4096 : 1024;

  // So on Windows the resolved path only gets that long when it is made of three byte characters.
  // That goes for the directory too: the argument shares the command line with bun.exe and the
  // other arguments, and every byte the directory contributes is one the argument does not need.
  // 150 characters keep the directory within MAX_PATH (260 units), the longest a process can be
  // started in, and leave about 140 units of the command line for the path of bun.exe.
  const FILLER = isWindows ? "\u4e00" : "d";
  const TOO_LONG_DIR = isWindows ? Buffer.alloc(150 * 3, FILLER).toString() : "publish-tarball-path-too-long";

  function nameOfBytes(bytes: number) {
    const remainder = bytes % Buffer.byteLength(FILLER);
    return Buffer.alloc(bytes - remainder, FILLER).toString() + Buffer.alloc(remainder, "d").toString();
  }

  function nameResolvingTo(resolvedBytes: number, dir: string) {
    return nameOfBytes(resolvedBytes - Buffer.byteLength(dir) - 1);
  }

  async function expectTooLong(tarballPathFor: (dir: string) => string) {
    using dir = packageDir(TOO_LONG_DIR, "publish-tarball-path-too-long");
    const tarballPath = tarballPathFor(String(dir));
    if (isWindows) {
      // CreateProcess takes command lines of up to 32767 units, terminating NUL included.
      expect(`"${bunExe()}" publish ${tarballPath} --dry-run\0`.length).toBeLessThanOrEqual(32767);
    }

    const { err, exitCode } = await publish(dryRunEnv, String(dir), tarballPath, "--dry-run");

    expect(err).toContain(`ENAMETOOLONG: File name too long: failed to read tarball: '${tarballPath}'`);
    expect(exitCode).toBe(1);
  }

  test("one byte longer than the path buffer once resolved fails with ENAMETOOLONG", () =>
    expectTooLong(dir => nameResolvingTo(PATH_BUFFER_BYTES + 1, dir)));

  // Neither of these works on Windows: an argument longer than the whole buffer does not fit in a
  // command line, and a path that fills the buffer exactly is refused by the open rather than the
  // join, which on Windows currently reports it as ENOSYS (it takes ENAMETOOLONG's number from the
  // C runtime, where it is a different one than in bun's errno table).
  test.skipIf(isWindows).each([
    ["longer than the path buffer", () => nameOfBytes(5000)],
    // Leaves no room for the terminating NUL.
    ["as long as the path buffer once resolved", (dir: string) => nameResolvingTo(PATH_BUFFER_BYTES, dir)],
  ])("%s fails with ENAMETOOLONG", (_, tarballPathFor) => expectTooLong(tarballPathFor));

  // What has to fit the buffer is the resolved path, not the argument as written.
  test("that only fits the path buffer once resolved is read", async () => {
    using dir = packageDir("publish-tarball-path-resolved", "publish-tarball-path-resolved");
    await pack(String(dir), env);
    const tarballPath = Buffer.alloc(5000, "x/../").toString() + "publish-tarball-path-resolved-1.0.0.tgz";

    const { out, err, exitCode } = await publish(dryRunEnv, String(dir), tarballPath, "--dry-run");

    expect(err).not.toContain("error:");
    expect(out).toContain(" + publish-tarball-path-resolved@1.0.0 (dry-run)");
    expect(exitCode).toBe(0);
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

// Publishing from a directory used to pack into that directory and delete the file again after
// publishing, so any failure in between (here: postpack) left the tarball behind.
test("a failed publish does not leave a tarball in the package directory", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  await Promise.all([
    write(
      packageJson,
      JSON.stringify({
        name: "publish-postpack-failed",
        version: "1.0.0",
        scripts: { postpack: "exit 3" },
      }),
    ),
    write(join(packageDir, "index.js"), "module.exports = 1;"),
    write(join(packageDir, "bunfig.toml"), await registry.authBunfig("postpackfailed")),
  ]);

  const { err, exitCode } = await publish(env, packageDir);

  expect(err).toContain('script "postpack" exited with code 3');
  expect({ exitCode, tarballExists: await exists(join(packageDir, "publish-postpack-failed-1.0.0.tgz")) }).toEqual({
    exitCode: 3,
    tarballExists: false,
  });
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

describe("publishConfig registry", () => {
  // Every request a registry receives, so a test can assert that a registry
  // received exactly one PUT carrying its own token, or nothing at all.
  function mockRegistry() {
    const requests: { method: string; path: string; authorization: string | null }[] = [];
    let manifest: any;
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        requests.push({
          method: req.method,
          path: new URL(req.url).pathname,
          authorization: req.headers.get("authorization"),
        });
        if (req.method === "PUT") manifest = await req.json();
        return new Response("OK");
      },
    });
    return {
      url: `http://127.0.0.1:${server.port}/`,
      // What `//host/path/:_authToken=` lines in .npmrc key on.
      npmrcToken: `//127.0.0.1:${server.port}/:_authToken=token-for-${server.port}`,
      token: `token-for-${server.port}`,
      requests,
      get manifest() {
        return manifest;
      },
      [Symbol.dispose]() {
        server.stop(true);
      },
    };
  }

  const put = (path: string, token: string) => [{ method: "PUT", path, authorization: `Bearer ${token}` }];

  test.concurrent("is published to, with the credentials .npmrc configures for it", async () => {
    using configured = mockRegistry();
    using pinned = mockRegistry();
    using dir = tempDir("publish-config-registry", {
      ".npmrc": `registry=${configured.url}\n${configured.npmrcToken}\n${pinned.npmrcToken}\n`,
      "package.json": JSON.stringify({
        name: "@corp/secretpkg",
        version: "1.0.0",
        publishConfig: { registry: pinned.url, access: "restricted", tag: "internal" },
      }),
    });

    const { out, err, exitCode } = await publish(env, String(dir));
    expect(err).not.toContain("error:");
    expect(out).toContain(`Tag: internal\nAccess: restricted\nRegistry: ${pinned.url}\n`);
    expect(out).toContain(" + @corp/secretpkg@1.0.0");
    expect(exitCode).toBe(0);

    expect(configured.requests).toEqual([]);
    expect(pinned.requests).toEqual(put("/@corp%2fsecretpkg", pinned.token));
    expect(pinned.manifest).toMatchObject({
      "dist-tags": { internal: "1.0.0" },
      access: "restricted",
      versions: { "1.0.0": { dist: { tarball: `${pinned.url}@corp/secretpkg/-/@corp/secretpkg-1.0.0.tgz` } } },
    });
  });

  test.concurrent("is published to when publishing a tarball", async () => {
    using configured = mockRegistry();
    using pinned = mockRegistry();
    using dir = tempDir("publish-config-registry-tarball", {
      ".npmrc": `registry=${configured.url}\n${configured.npmrcToken}\n${pinned.npmrcToken}\n`,
      "package.json": JSON.stringify({
        name: "@corp/secretpkg",
        version: "1.0.0",
        publishConfig: { registry: pinned.url, access: "restricted", tag: "internal" },
      }),
    });
    await pack(String(dir), env);

    const { out, err, exitCode } = await publish(env, String(dir), "./corp-secretpkg-1.0.0.tgz");
    expect(err).not.toContain("error:");
    expect(out).toContain(`Tag: internal\nAccess: restricted\nRegistry: ${pinned.url}\n`);
    expect(out).toContain(" + @corp/secretpkg@1.0.0");
    expect(exitCode).toBe(0);

    expect(configured.requests).toEqual([]);
    expect(pinned.requests).toEqual(put("/@corp%2fsecretpkg", pinned.token));
    expect(pinned.manifest).toMatchObject({
      "dist-tags": { internal: "1.0.0" },
      access: "restricted",
      versions: { "1.0.0": { dist: { tarball: `${pinned.url}@corp/secretpkg/-/@corp/secretpkg-1.0.0.tgz` } } },
    });
  });

  test.concurrent("is what --dry-run reports", async () => {
    using configured = mockRegistry();
    using pinned = mockRegistry();
    using dir = tempDir("publish-config-registry-dry-run", {
      ".npmrc": `registry=${configured.url}\n${configured.npmrcToken}\n${pinned.npmrcToken}\n`,
      "package.json": JSON.stringify({
        name: "dry-run-pinned",
        version: "1.0.0",
        publishConfig: { registry: pinned.url },
      }),
    });

    const { out, err, exitCode } = await publish(env, String(dir), "--dry-run");
    expect(err).not.toContain("error:");
    expect(out).toContain(`Registry: ${pinned.url}\n`);
    expect(exitCode).toBe(0);
    expect(configured.requests).toEqual([]);
    expect(pinned.requests).toEqual([]);
  });

  test.concurrent("without credentials of its own, nothing is sent to the configured registry", async () => {
    using configured = mockRegistry();
    using pinned = mockRegistry();
    using dir = tempDir("publish-config-registry-no-auth", {
      ".npmrc": `registry=${configured.url}\n${configured.npmrcToken}\n`,
      "package.json": JSON.stringify({
        name: "@corp/secretpkg",
        version: "1.0.0",
        publishConfig: { registry: pinned.url },
      }),
    });

    const { err, exitCode } = await publish(env, String(dir));
    expect(err).toContain("error: missing authentication");
    expect(exitCode).toBe(1);
    expect(configured.requests).toEqual([]);
    expect(pinned.requests).toEqual([]);
  });

  test.concurrent("keeps the credentials of the configured registry when it pins that same registry", async () => {
    using configured = mockRegistry();
    using dir = tempDir("publish-config-registry-same", {
      "bunfig.toml": `[install]\nregistry = { url = "${configured.url}", token = "${configured.token}" }\n`,
      "package.json": JSON.stringify({
        name: "pinned-to-configured",
        version: "1.0.0",
        // No trailing slash, unlike the bunfig.toml url: still the same registry.
        publishConfig: { registry: configured.url.slice(0, -1) },
      }),
    });

    const { out, err, exitCode } = await publish(env, String(dir));
    expect(err).not.toContain("error:");
    expect(out).toContain(" + pinned-to-configured@1.0.0");
    expect(exitCode).toBe(0);
    expect(configured.requests).toEqual(put("/pinned-to-configured", configured.token));
  });

  test.concurrent("on the same origin as the configured registry, its credentials carry over", async () => {
    using configured = mockRegistry();
    using dir = tempDir("publish-config-registry-same-origin", {
      "bunfig.toml": `[install]\nregistry = { url = "${configured.url}", token = "${configured.token}" }\n`,
      "package.json": JSON.stringify({
        name: "pinned-to-path",
        version: "1.0.0",
        publishConfig: { registry: `${configured.url}publish/` },
      }),
    });

    const { out, err, exitCode } = await publish(env, String(dir));
    expect(err).not.toContain("error:");
    expect(out).toContain(`Registry: ${configured.url}publish/\n`);
    expect(exitCode).toBe(0);
    expect(configured.requests).toEqual(put("/publish/pinned-to-path", configured.token));
  });

  test.concurrent("loses to --registry", async () => {
    using flag = mockRegistry();
    using pinned = mockRegistry();
    using dir = tempDir("publish-config-registry-flag", {
      ".npmrc": `registry=${flag.url}\n${flag.npmrcToken}\n${pinned.npmrcToken}\n`,
      "package.json": JSON.stringify({
        name: "flag-wins",
        version: "1.0.0",
        publishConfig: { registry: pinned.url },
      }),
    });

    const { out, err, exitCode } = await publish(env, String(dir), "--registry", flag.url);
    expect(err).not.toContain("error:");
    expect(out).toContain(`Registry: ${flag.url}\n`);
    expect(exitCode).toBe(0);
    expect(flag.requests).toEqual(put("/flag-wins", flag.token));
    expect(pinned.requests).toEqual([]);
  });

  test.concurrent("--registry is given the credentials .npmrc configures for it", async () => {
    using flag = mockRegistry();
    using dir = tempDir("registry-flag-npmrc-auth", {
      ".npmrc": `${flag.npmrcToken}\n`,
      "package.json": JSON.stringify({ name: "flag-auth", version: "1.0.0" }),
    });

    const { out, err, exitCode } = await publish(env, String(dir), "--registry", flag.url);
    expect(err).not.toContain("error:");
    expect(out).toContain(" + flag-auth@1.0.0");
    expect(exitCode).toBe(0);
    expect(flag.requests).toEqual(put("/flag-auth", flag.token));
  });

  test.concurrent("does not override a registry configured for the package's scope", async () => {
    using configured = mockRegistry();
    using scoped = mockRegistry();
    using pinned = mockRegistry();
    using dir = tempDir("publish-config-registry-scoped", {
      ".npmrc": [
        `registry=${configured.url}`,
        `@corp:registry=${scoped.url}`,
        configured.npmrcToken,
        scoped.npmrcToken,
        pinned.npmrcToken,
        "",
      ].join("\n"),
      "package.json": JSON.stringify({
        name: "@corp/scoped-wins",
        version: "1.0.0",
        publishConfig: { registry: pinned.url },
      }),
    });

    const { out, err, exitCode } = await publish(env, String(dir));
    expect(err).not.toContain("error:");
    expect(out).toContain(`Registry: ${scoped.url}\n`);
    expect(exitCode).toBe(0);
    expect(configured.requests).toEqual([]);
    expect(scoped.requests).toEqual(put("/@corp%2fscoped-wins", scoped.token));
    expect(pinned.requests).toEqual([]);
  });

  test.concurrent("@scope:registry overrides the registry configured for the scope", async () => {
    using scoped = mockRegistry();
    using pinned = mockRegistry();
    using dir = tempDir("publish-config-scope-registry", {
      ".npmrc": `@corp:registry=${scoped.url}\n${scoped.npmrcToken}\n${pinned.npmrcToken}\n`,
      "package.json": JSON.stringify({
        name: "@corp/pinned-scope",
        version: "1.0.0",
        publishConfig: { "@corp:registry": pinned.url },
      }),
    });

    const { out, err, exitCode } = await publish(env, String(dir));
    expect(err).not.toContain("error:");
    expect(out).toContain(`Registry: ${pinned.url}\n`);
    expect(exitCode).toBe(0);
    expect(scoped.requests).toEqual([]);
    expect(pinned.requests).toEqual(put("/@corp%2fpinned-scope", pinned.token));
  });

  const expected = "expected a URL starting with 'https://' or 'http://'";
  test.concurrent.each([
    [
      "registry",
      "ftp://127.0.0.1:1/",
      `error: invalid \`registry\` value in \`publishConfig\`: "ftp://127.0.0.1:1/", ${expected}\n`,
    ],
    ["registry", ["http://127.0.0.1:1/"], `error: invalid \`registry\` value in \`publishConfig\`, ${expected}\n`],
    ["registry", "", `error: invalid \`registry\` value in \`publishConfig\`: "", ${expected}\n`],
    [
      "@corp:registry",
      "127.0.0.1:1",
      `error: invalid \`@corp:registry\` value in \`publishConfig\`: "127.0.0.1:1", ${expected}\n`,
    ],
  ])("%s set to %j is an error, and nothing is published anywhere", async (key, value, message) => {
    using configured = mockRegistry();
    using dir = tempDir("publish-config-registry-invalid", {
      ".npmrc": `registry=${configured.url}\n${configured.npmrcToken}\n`,
      "package.json": JSON.stringify({
        name: "@corp/invalid-registry",
        version: "1.0.0",
        publishConfig: { [key]: value },
      }),
    });

    const { err, exitCode } = await publish(env, String(dir));
    expect(err).toContain(message);
    expect(exitCode).toBe(1);
    expect(configured.requests).toEqual([]);
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

it("lifecycle scripts get the workspace member's npm_package_* when publishing a member", async () => {
  const { packageDir, packageJson } = await registry.createTestDir();
  const memberDir = join(packageDir, "packages", "publish-pkg-12");
  const echoPackageEnv = "$npm_package_name $npm_package_version $npm_package_json $npm_config_local_prefix";
  const events = ["prepublishOnly", "prepack", "postpack", "publish", "postpublish"];
  await Promise.all([
    write(join(packageDir, "bunfig.toml"), await registry.authBunfig("npm_package_env")),
    write(packageJson, JSON.stringify({ name: "root", version: "0.0.1", workspaces: ["packages/*"] })),
    write(
      join(memberDir, "package.json"),
      JSON.stringify({
        name: "publish-pkg-12",
        version: "12.0.0",
        scripts: Object.fromEntries(events.map(event => [event, `echo ${event} ${echoPackageEnv}`])),
      }),
    ),
  ]);

  const { out, err, exitCode } = await publish(env, memberDir, "--dry-run");
  // npm_config_local_prefix is the workspace root, as with npm.
  const memberEnv = `publish-pkg-12 12.0.0 ${join(memberDir, "package.json")} ${packageDir}`;
  expect(out.split("\n").filter(line => events.some(event => line.startsWith(`${event} `)))).toEqual(
    events.map(event => `${event} ${memberEnv}`),
  );
  expect(err).not.toContain("error:");
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

  // A README that is a symlink is not packed (symlinks never are), so its
  // target must not be published as the readme either.
  test("a README that is a symlink is not sent as readme", async () => {
    let captured: any = null;
    using mock = Bun.serve({
      port: 0,
      async fetch(req) {
        if (req.method === "PUT") captured = await req.json();
        return new Response("OK", { status: 200 });
      },
    });

    const dir = tmpdirSync();
    const packageDir = join(dir, "pkg");
    await Promise.all([
      write(join(dir, "outside", "README.md"), "# outside the package"),
      write(
        join(packageDir, "bunfig.toml"),
        Bun.TOML.stringify({
          install: {
            cache: false,
            registry: { url: `http://localhost:${mock.port}`, token: "unused" },
          },
        }),
      ),
      write(join(packageDir, "package.json"), JSON.stringify({ name: "readme-pkg-3", version: "3.0.0" })),
      write(join(packageDir, "index.js"), "module.exports = 3;"),
    ]);
    await symlink(join("..", "outside", "README.md"), join(packageDir, "README.md"), "file");

    const { err, exitCode } = await publish(env, packageDir);
    expect(err).not.toContain("error:");
    expect(exitCode).toBe(0);

    expect(captured.versions["3.0.0"]).not.toContainAnyKeys(["readme", "readmeFilename"]);
    expect(JSON.stringify(captured)).not.toContain("outside the package");
  });
});

// The manifest "bin" that reaches the registry. Paths are resolved against the
// package root the way npm does it ("../cli.js" is "cli.js"), a value that
// resolves to the root itself is dropped, other values are kept as written (npm
// keeps "lib/" as well), and "directories.bin" is expanded with the same rule
// the tarball uses.
describe("bin in the published manifest", () => {
  test.each([
    [{ bin: "cli.js" }, { "bin-pkg": "cli.js" }],
    [{ bin: "../cli.js" }, { "bin-pkg": "cli.js" }],
    [{ bin: "" }, {}],
    [{ bin: "." }, {}],
    [{ bin: { x: "lib/", y: "./cli.js", z: "", w: ".", v: "../../cli.js" } }, { x: "lib/", y: "cli.js", v: "cli.js" }],
    [{ directories: { bin: "bins/" } }, { "a.js": "bins/a.js" }],
    [{ directories: { bin: "" } }, undefined],
    [{ directories: { bin: "." } }, undefined],
  ])("%j", async (fields, expected) => {
    let captured: any = null;
    using mock = Bun.serve({
      port: 0,
      async fetch(req) {
        if (req.method === "PUT") captured = await req.json();
        return new Response("OK", { status: 200 });
      },
    });

    const packageDir = tmpdirSync();
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
      write(join(packageDir, "package.json"), JSON.stringify({ name: "bin-pkg", version: "1.0.0", ...fields })),
      write(join(packageDir, "cli.js"), "#!/usr/bin/env node\n"),
      write(join(packageDir, "lib", "a.js"), "module.exports = 1;"),
      write(join(packageDir, "bins", "a.js"), "#!/usr/bin/env node\n"),
    ]);

    const { err, exitCode } = await publish(env, packageDir);
    expect(err).not.toContain("error:");
    expect(exitCode).toBe(0);

    expect(captured.versions["1.0.0"].bin).toEqual(expected);
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

test("user:pass@ in a registry url taken from an env var is sent as Basic auth", async () => {
  const requests: { method: string; pathname: string; authorization: string | null }[] = [];
  using mock = Bun.serve({
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

  using packageDir = tempDir("publish-env-registry-userinfo", {
    "package.json": JSON.stringify({ name: "env-userinfo-pkg", version: "1.0.0" }),
    "bunfig.toml": `[install]\nregistry = "$PUBLISH_REGISTRY"\n`,
  });

  const { out, err, exitCode } = await publish(
    { ...env, PUBLISH_REGISTRY: `http://pubuser:hunter2@localhost:${mock.port}/` },
    String(packageDir),
  );
  expect({ requests, err }).toEqual({
    requests: [
      {
        method: "PUT",
        pathname: "/env-userinfo-pkg",
        authorization: `Basic ${Buffer.from("pubuser:hunter2").toString("base64")}`,
      },
    ],
    err: expect.not.stringContaining("error:"),
  });
  expect(out).toContain(`Registry: http://localhost:${mock.port}/\n`);
  expect(out).toContain(" + env-userinfo-pkg@1.0.0");
  expect(out).not.toContain("hunter2");
  expect(exitCode).toBe(0);
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

describe.concurrent("NODE_TLS_REJECT_UNAUTHORIZED=0", () => {
  const rejectUnauthorizedOff = { ...env, NODE_TLS_REJECT_UNAUTHORIZED: "0" };
  const rejectUnauthorizedOn = { ...env, NODE_TLS_REJECT_UNAUTHORIZED: undefined };

  // The harness certificate is self-signed, so every request to this registry
  // fails verification unless the client has turned it off.
  function selfSignedRegistry(name: string, opts: { otp?: string } = {}) {
    const requests: string[] = [];
    const server = Bun.serve({
      port: 0,
      tls,
      fetch(req) {
        const { pathname } = new URL(req.url);
        requests.push(`${req.method} ${pathname}`);
        if (req.method === "PUT") {
          if (opts.otp !== undefined && req.headers.get("npm-otp") !== opts.otp) {
            return Response.json(
              { authUrl: "customapp://login", doneUrl: `https://localhost:${server.port}/-/done` },
              { status: 401, headers: { "www-authenticate": "OTP" } },
            );
          }
          return new Response("OK");
        }
        if (pathname === "/-/done") {
          return Response.json({ token: opts.otp });
        }
        // the --tolerate-republish manifest GET
        return Response.json({ name, versions: { "1.0.0": {} } });
      },
    });
    const dir = tempDir(`publish-self-signed-${name}`, {
      "package.json": JSON.stringify({ name, version: "1.0.0" }),
      "bunfig.toml": Bun.TOML.stringify({
        install: {
          cache: false,
          registry: { url: `https://localhost:${server.port}`, token: "self-signed-token" },
        },
      }),
    });
    return {
      requests,
      packageDir: String(dir),
      [Symbol.dispose]() {
        server.stop(true);
        dir[Symbol.dispose]();
      },
    };
  }

  test("publishes to a registry with a self-signed certificate", async () => {
    using registry = selfSignedRegistry("tls-publish");

    const { out, err, exitCode } = await publish(rejectUnauthorizedOff, registry.packageDir);

    expect(err).not.toContain("DEPTH_ZERO_SELF_SIGNED_CERT");
    expect(out).toContain(" + tls-publish@1.0.0");
    expect(registry.requests).toEqual(["PUT /tls-publish"]);
    expect(exitCode).toBe(0);
  });

  test("--tolerate-republish reads the manifest from a registry with a self-signed certificate", async () => {
    using registry = selfSignedRegistry("tls-republish");

    const { err, exitCode } = await publish(rejectUnauthorizedOff, registry.packageDir, "--tolerate-republish");

    expect(err).toBe("warn: Registry already knows about version 1.0.0; skipping.\n");
    expect(registry.requests).toEqual(["GET /tls-republish"]);
    expect(exitCode).toBe(0);
  });

  test("web login polls the done url and retries with the OTP on a registry with a self-signed certificate", async () => {
    using registry = selfSignedRegistry("tls-web-login", { otp: "123456" });

    const { out, err, exitCode } = await publish(rejectUnauthorizedOff, registry.packageDir);

    expect(err).not.toContain("DEPTH_ZERO_SELF_SIGNED_CERT");
    expect(out).toContain("Authenticate your account at:");
    expect(out).toContain(" + tls-web-login@1.0.0");
    expect(registry.requests).toEqual(["PUT /tls-web-login", "GET /-/done", "PUT /tls-web-login"]);
    expect(exitCode).toBe(0);
  });

  test("certificate verification stays on when the variable is unset", async () => {
    using registry = selfSignedRegistry("tls-verified");

    const { err, exitCode } = await publish(rejectUnauthorizedOn, registry.packageDir);

    expect(err).toContain("DEPTH_ZERO_SELF_SIGNED_CERT");
    expect(registry.requests).toEqual([]);
    expect(exitCode).toBe(1);
  });
});
