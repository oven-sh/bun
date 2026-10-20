import { file, spawn, write } from "bun";
import { describe, expect, test } from "bun:test";
import { exists, rm } from "fs/promises";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";

// bun.lock records no lifecycle scripts for a workspace member, and a member's package.json can
// change without every dependency in it changing. Neither is a reason to resolve again a
// dependency that the lockfile pins. Each test counts the manifests an install asks for.
describe("a workspace member keeps the versions its lockfile pins", () => {
  type Json = Record<string, unknown>;
  const installHooks = ["preinstall", "install", "postinstall", "preprepare", "prepare", "postprepare"] as const;
  const frozenError = "error: lockfile had changes, but lockfile is frozen";
  const token = "made-up-token";

  // Every name has version 1.0.0. `publish()` adds 1.1.0 and moves `latest` to it. Names under
  // `@private/` need the token.
  function serveRegistry() {
    let versions = ["1.0.0"];
    const manifests: string[] = [];
    const tarballs = new Map<string, Uint8Array>();
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const { origin, pathname } = new URL(request.url);
        const path = decodeURIComponent(pathname).slice(1);
        const tarball = path.match(/^(.+)\/-\/[^/]+-(\d+\.\d+\.\d+)\.tgz$/);
        const name = tarball ? tarball[1] : path;
        if (!tarball) manifests.push(name);
        if (name.startsWith("@private/") && request.headers.get("authorization") !== `Bearer ${token}`) {
          return Response.json({}, { status: 401 });
        }
        if (tarball) return new Response(await tarballOf(name, tarball[2]));
        return Response.json({
          name,
          "dist-tags": { latest: versions.at(-1) },
          versions: Object.fromEntries(
            versions.map(version => [
              version,
              { name, version, dist: { tarball: `${origin}/${name}/-/${name.split("/").at(-1)}-${version}.tgz` } },
            ]),
          ),
        });
      },
    });
    // The lockfile records the integrity of the bytes, so one name and version is always the same bytes.
    async function tarballOf(name: string, version: string) {
      const key = `${name}@${version}`;
      let bytes = tarballs.get(key);
      if (!bytes) {
        const archive = new Bun.Archive(
          { "package/package.json": JSON.stringify({ name, version }) },
          { compress: "gzip" },
        );
        tarballs.set(key, (bytes = await archive.bytes()));
      }
      return bytes;
    }
    return {
      url: server.url.href,
      manifests,
      tarballOf,
      publish() {
        versions = ["1.0.0", "1.1.0"];
      },
      [Symbol.dispose]() {
        server.stop(true);
      },
    };
  }

  type Project = {
    members: Record<string, Json>;
    root?: Json;
    // The `[install]` section of bunfig.toml, given the registry's URL.
    install?: (registry: string) => Json;
    files?: Record<string, string>;
  };

  // Installs the project once, with only 1.0.0 published.
  async function setup({ members, root = {}, install, files = {} }: Project) {
    const registry = serveRegistry();
    const memberJson = (name: string, json: Json) => JSON.stringify({ name, version: "1.0.0", ...json });
    const bunfig = (overrides: Json = {}) =>
      Bun.TOML.stringify({ install: { registry: registry.url, ...install?.(registry.url), ...overrides } });
    const dir = tempDir("member-rows-", {
      "package.json": JSON.stringify({ name: "root", private: true, workspaces: ["packages/*"], ...root }),
      "bunfig.toml": bunfig(),
      ...Object.fromEntries(
        Object.entries(members).map(([name, json]) => [`packages/${name}/package.json`, memberJson(name, json)]),
      ),
      ...files,
    });
    const cwd = String(dir);

    async function bun(args: string[], at = cwd) {
      await using proc = spawn({
        cmd: [bunExe(), ...args],
        cwd: at,
        env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(cwd, ".bun-cache") },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { out, err, exitCode };
    }

    const project = {
      cwd,
      registry,
      bun,
      bunfig: (overrides: Json) => write(join(cwd, "bunfig.toml"), bunfig(overrides)),
      lock: () => file(join(cwd, "bun.lock")).text(),
      // `name@version` of every registry package in bun.lock.
      pins: async () => [...(await project.lock()).matchAll(/"([^"\s]+@\d+\.\d+\.\d+)", "http/g)].map(m => m[1]),
      // The version of `name` that `member` runs, under either linker.
      installed: async (member: string, name: string) => {
        for (const from of [join(cwd, "packages", member), cwd]) {
          const path = join(from, "node_modules", name, "package.json");
          if (await exists(path)) return (await file(path).json()).version;
        }
        return undefined;
      },
      writeRoot: (json: Json) =>
        write(
          join(cwd, "package.json"),
          JSON.stringify({ name: "root", private: true, workspaces: ["packages/*"], ...root, ...json }),
        ),
      writeMember: (name: string, json: Json) =>
        write(join(cwd, "packages", name, "package.json"), memberJson(name, json)),
      // This is what another machine has after a clone: the lockfile, no node_modules and no cache. In the meantime,
      // the registry published 1.1.0 of every package.
      async freshCheckout() {
        registry.publish();
        await Promise.all([
          rm(join(cwd, "node_modules"), { recursive: true, force: true }),
          rm(join(cwd, ".bun-cache"), { recursive: true, force: true }),
          ...Object.keys(members).flatMap(name => [
            rm(join(cwd, "packages", name, "node_modules"), { recursive: true, force: true }),
            rm(join(cwd, "packages", name, "hook-ran.txt"), { force: true }),
          ]),
        ]);
        registry.manifests.length = 0;
      },
      [Symbol.dispose]() {
        registry[Symbol.dispose]();
        dir[Symbol.dispose]();
      },
    };

    try {
      const { err, exitCode } = await bun(["install"]);
      expect(err).not.toContain("error:");
      expect(err).toContain("Saved lockfile");
      expect(exitCode).toBe(0);
      registry.manifests.length = 0;
    } catch (e) {
      project[Symbol.dispose]();
      throw e;
    }
    return project;
  }

  const hook = (name: string = "postinstall") => ({ [name]: "echo ran > hook-ran.txt" });
  const hookRan = (cwd: string, member: string) => exists(join(cwd, "packages", member, "hook-ran.txt"));

  describe("when nothing in the project changed", () => {
    test.concurrent.each(installHooks)("bun ci passes with a %s script in a member", async name => {
      using project = await setup({
        members: { app: { scripts: hook(name), devDependencies: { "latest-dep": "latest" } } },
      });
      const locked = await project.lock();
      expect(await project.pins()).toEqual(["latest-dep@1.0.0"]);
      await project.freshCheckout();

      const { err, exitCode } = await project.bun(["ci"]);

      expect(err).not.toContain(frozenError);
      expect(project.registry.manifests).toEqual([]);
      expect(await project.lock()).toBe(locked);
      expect(await project.installed("app", "latest-dep")).toBe("1.0.0");
      // preprepare and postprepare do not run for a workspace member.
      expect(await hookRan(project.cwd, "app")).toBe(name !== "preprepare" && name !== "postprepare");
      expect(exitCode).toBe(0);
    });

    test.concurrent.each([
      "install",
      "install --linker hoisted",
      "install --frozen-lockfile",
      "install --production",
      "install --lockfile-only",
    ])("bun %s asks the registry for no manifest", async command => {
      using project = await setup({
        members: {
          app: {
            scripts: hook(),
            dependencies: { "latest-dep": "latest", "range-dep": "^1.0.0", "empty-dep": "" },
          },
        },
      });
      const locked = await project.lock();
      await project.freshCheckout();

      const { err, exitCode } = await project.bun(command.split(" "));

      expect(err).not.toContain("error:");
      expect(err).not.toContain("Saved lockfile");
      expect(project.registry.manifests).toEqual([]);
      expect(await project.lock()).toBe(locked);
      if (!command.includes("--lockfile-only")) {
        expect(await project.installed("app", "latest-dep")).toBe("1.0.0");
        expect(await hookRan(project.cwd, "app")).toBeTrue();
      }
      expect(exitCode).toBe(0);
    });

    test.concurrent("another member's range on the same package does not move", async () => {
      using project = await setup({
        members: {
          a: { dependencies: { "shared-dep": "^1.0.0" } },
          n: { scripts: hook(), devDependencies: { "shared-dep": "latest" } },
        },
      });
      const locked = await project.lock();
      await project.freshCheckout();

      const { err, exitCode } = await project.bun(["install"]);

      expect(err).not.toContain("error:");
      expect(project.registry.manifests).toEqual([]);
      expect(await project.lock()).toBe(locked);
      expect(await project.installed("a", "shared-dep")).toBe("1.0.0");
      expect(await project.installed("n", "shared-dep")).toBe("1.0.0");
      expect(exitCode).toBe(0);
    });

    // A Docker build of one service has no token for the registry of another team's package.
    test.concurrent.each(["install", "ci"])(
      "bun %s --filter does not ask the registry of a member it excludes",
      async command => {
        using project = await setup({
          members: {
            a: { dependencies: { "public-dep": "^1.0.0" } },
            n: { scripts: hook(), dependencies: { "@private/lib": "^1.0.0" } },
          },
          install: url => ({ scopes: { "@private": { url, token } } }),
        });
        expect((await project.pins()).sort()).toEqual(["@private/lib@1.0.0", "public-dep@1.0.0"]);
        await project.bunfig({ scopes: { "@private": { url: project.registry.url } } });
        await project.freshCheckout();

        const { err, exitCode } = await project.bun([command, "--filter", "./packages/a"]);

        expect(err).not.toContain("error:");
        expect(project.registry.manifests).toEqual([]);
        expect(await project.installed("a", "public-dep")).toBe("1.0.0");
        expect(await hookRan(project.cwd, "n")).toBeFalse();
        expect(exitCode).toBe(0);
      },
    );

    // A member of a lockfile migrated from npm has no recorded scripts either.
    test.concurrent("bun install over a package-lock.json keeps its pin", async () => {
      using project = await setup({ members: { seed: {} } });
      const { cwd, registry } = project;
      const tarball = await registry.tarballOf("latest-dep", "1.0.0");
      const integrity = `sha512-${new Bun.CryptoHasher("sha512").update(tarball).digest("base64")}`;
      await Promise.all([
        rm(join(cwd, "bun.lock")),
        rm(join(cwd, "packages", "seed"), { recursive: true }),
        project.writeMember("app", { scripts: hook(), devDependencies: { "latest-dep": "latest" } }),
        write(
          join(cwd, "package-lock.json"),
          JSON.stringify({
            name: "root",
            lockfileVersion: 3,
            requires: true,
            packages: {
              "": { name: "root", workspaces: ["packages/*"] },
              "node_modules/app": { resolved: "packages/app", link: true },
              "node_modules/latest-dep": {
                version: "1.0.0",
                resolved: `${registry.url}latest-dep/-/latest-dep-1.0.0.tgz`,
                integrity,
                dev: true,
              },
              "packages/app": { name: "app", version: "1.0.0", devDependencies: { "latest-dep": "latest" } },
            },
          }),
        ),
      ]);
      await project.freshCheckout();

      const { err, exitCode } = await project.bun(["install"]);

      expect(err).not.toContain("error:");
      expect(err).toContain("migrated lockfile from package-lock.json");
      expect(project.registry.manifests).toEqual([]);
      expect(await project.pins()).toEqual(["latest-dep@1.0.0"]);
      expect(exitCode).toBe(0);
    });
  });

  describe("when a member changed", () => {
    const twoRows = { "latest-dep": "latest", "range-dep": "^1.0.0" };

    test.concurrent("a dependency it gains is the only one resolved", async () => {
      using project = await setup({ members: { app: { dependencies: twoRows } } });
      await project.freshCheckout();
      await project.writeMember("app", { dependencies: { ...twoRows, "new-dep": "^1.0.0" } });

      const frozen = await project.bun(["ci"]);
      expect(frozen.err).toContain(frozenError);
      expect(project.registry.manifests).toEqual(["new-dep"]);
      expect(frozen.exitCode).toBe(1);

      // Without the manifest that `bun ci` cached, so that what `bun install` asks for is counted too.
      await project.freshCheckout();
      const { err, exitCode } = await project.bun(["install"]);

      expect(err).not.toContain("error:");
      expect(err).toContain("Saved lockfile");
      expect(project.registry.manifests).toEqual(["new-dep"]);
      expect((await project.pins()).sort()).toEqual(["latest-dep@1.0.0", "new-dep@1.1.0", "range-dep@1.0.0"]);
      expect(exitCode).toBe(0);
    });

    test.concurrent("bun add in a member resolves only the added package", async () => {
      using project = await setup({ members: { app: { dependencies: twoRows } } });
      await project.freshCheckout();

      const { err, exitCode } = await project.bun(["add", "new-dep"], join(project.cwd, "packages", "app"));

      expect(err).not.toContain("error:");
      expect(project.registry.manifests).toEqual(["new-dep"]);
      expect((await project.pins()).sort()).toEqual(["latest-dep@1.0.0", "new-dep@1.1.0", "range-dep@1.0.0"]);
      expect(exitCode).toBe(0);
    });

    test.concurrent("bun remove in a member resolves nothing", async () => {
      using project = await setup({ members: { app: { dependencies: twoRows } } });
      await project.freshCheckout();

      const { err, exitCode } = await project.bun(["remove", "range-dep"], join(project.cwd, "packages", "app"));

      expect(err).not.toContain("error:");
      expect(project.registry.manifests).toEqual([]);
      expect(await project.pins()).toEqual(["latest-dep@1.0.0"]);
      expect(exitCode).toBe(0);
    });

    test.concurrent("a range retyped to one the locked version still satisfies resolves nothing", async () => {
      using project = await setup({ members: { app: { dependencies: twoRows } } });
      const locked = await project.lock();
      await project.freshCheckout();
      await project.writeMember("app", { dependencies: { ...twoRows, "range-dep": ">=1.0.0" } });

      const frozen = await project.bun(["ci"]);
      expect(frozen.err).not.toContain("error:");
      expect(project.registry.manifests).toEqual([]);
      expect(await project.lock()).toBe(locked);
      expect(frozen.exitCode).toBe(0);

      const { err, exitCode } = await project.bun(["install"]);

      expect(err).toContain("Saved lockfile");
      expect(project.registry.manifests).toEqual([]);
      expect(await project.lock()).toBe(locked.replace('"range-dep": "^1.0.0"', '"range-dep": ">=1.0.0"'));
      expect(exitCode).toBe(0);
    });

    test.concurrent("the members it depends on are not resolved again", async () => {
      using project = await setup({
        members: {
          a: { dependencies: { b: "workspace:*" } },
          b: { dependencies: { "latest-dep": "latest" } },
        },
      });
      await project.freshCheckout();
      await project.writeMember("a", { dependencies: { b: "workspace:*", "new-dep": "^1.0.0" } });

      const { err, exitCode } = await project.bun(["install"]);

      expect(err).not.toContain("error:");
      expect(project.registry.manifests).toEqual(["new-dep"]);
      expect((await project.pins()).sort()).toEqual(["latest-dep@1.0.0", "new-dep@1.1.0"]);
      expect(exitCode).toBe(0);
    });

    test.concurrent("a bin added to a member with an install script is linked and recorded", async () => {
      using project = await setup({
        members: { app: { scripts: hook(), dependencies: { "range-dep": "^1.0.0" } } },
        install: () => ({ linker: "hoisted" }),
        files: { "packages/app/cli.js": "#!/usr/bin/env node\n" },
      });
      expect(await project.lock()).not.toContain("app-cli");
      await project.writeMember("app", {
        bin: { "app-cli": "./cli.js" },
        scripts: hook(),
        dependencies: { "range-dep": "^1.0.0" },
      });

      const { err, exitCode } = await project.bun(["install"]);

      expect(err).not.toContain("error:");
      expect(err).toContain("Saved lockfile");
      expect(project.registry.manifests).toEqual([]);
      expect(await project.lock()).toContain('"app-cli": "./cli.js"');
      expect(await exists(join(project.cwd, "node_modules", ".bin", isWindows ? "app-cli.exe" : "app-cli"))).toBeTrue();
      expect(exitCode).toBe(0);
    });

    test.concurrent.each([
      ["with", hook()],
      ["without", {}],
    ])("trustedDependencies added to a member %s an install script are recorded", async (_, scripts) => {
      const app = { scripts, dependencies: { "range-dep": "^1.0.0" } };
      using project = await setup({ members: { app } });
      expect(await project.lock()).not.toContain("trustedDependencies");
      await project.writeMember("app", { ...app, trustedDependencies: ["range-dep"] });

      const { err, exitCode } = await project.bun(["install"]);

      expect(err).not.toContain("error:");
      expect(err).toContain("Saved lockfile");
      expect(await project.lock()).toContain('"trustedDependencies": [\n    "range-dep",\n  ],');
      expect(exitCode).toBe(0);
    });
  });

  test.concurrent("an override added for another package moves no pin", async () => {
    using project = await setup({
      members: {
        a: { dependencies: { "latest-dep": "latest" } },
        n: { dependencies: { "other-dep": "^1.0.0" } },
      },
    });
    await project.freshCheckout();
    await project.writeRoot({ overrides: { "other-dep": "1.0.0" } });

    const { err, exitCode } = await project.bun(["install"]);

    expect(err).not.toContain("error:");
    expect(project.registry.manifests).toEqual(["other-dep"]);
    expect((await project.pins()).sort()).toEqual(["latest-dep@1.0.0", "other-dep@1.0.0"]);
    expect(exitCode).toBe(0);
  });

  describe("bun.lockb records the scripts", () => {
    const app = (script: string) => ({ scripts: { postinstall: script }, devDependencies: { "latest-dep": "latest" } });

    test.concurrent("an edited script is saved and resolves nothing", async () => {
      using project = await setup({ members: { app: app("echo one") }, install: () => ({ saveTextLockfile: false }) });
      expect(await exists(join(project.cwd, "bun.lockb"))).toBeTrue();
      await project.freshCheckout();
      await project.writeMember("app", app("echo two"));

      const frozen = await project.bun(["ci"]);
      expect(frozen.err).toContain(frozenError);
      expect(project.registry.manifests).toEqual([]);
      expect(frozen.exitCode).toBe(1);

      const { err, exitCode } = await project.bun(["install"]);

      expect(err).not.toContain("error:");
      expect(err).toContain("Saved lockfile");
      expect(project.registry.manifests).toEqual([]);
      expect(await project.installed("app", "latest-dep")).toBe("1.0.0");
      expect(exitCode).toBe(0);

      await project.freshCheckout();
      const again = await project.bun(["ci"]);
      expect(again.err).not.toContain(frozenError);
      expect(again.exitCode).toBe(0);
    });

    test.concurrent.each(["prune", "dedupe --check"])(
      "an edited script is not a dependency change for bun %s",
      async command => {
        using project = await setup({
          members: { app: app("echo one") },
          install: () => ({ saveTextLockfile: false }),
        });
        await project.writeMember("app", app("echo two"));

        const { err, exitCode } = await project.bun(command.split(" "));

        expect(err).not.toContain("does not match package.json");
        expect(exitCode).toBe(0);
      },
    );
  });
});
