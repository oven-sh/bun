// The hoisted counterpart of isolated-relink.test.ts.
//
// The hoisted linker keeps the node_modules entry of a registry package or a workspace when its
// package.json has the name and version of its lockfile row. A dependency that changes source can
// keep both (a tarball of `dep-c@1.0.1` replaced by the registry's `dep-c@1.0.1`), so the install
// that gives the entry another row has to replace what the old row left there.
import { file, spawn, write } from "bun";
import { describe, expect, it } from "bun:test";
import { chmodSync, existsSync, lstatSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { rm } from "fs/promises";
import { bunEnv, bunExe, gunzipJsonRequest, isRoot, isWindows, readdirSorted, tempDir } from "harness";
import { basename, join } from "path";
import { pathToFileURL } from "url";

const gitEnv = {
  ...bunEnv,
  GIT_AUTHOR_NAME: "bun-test",
  GIT_AUTHOR_EMAIL: "bun-test@example.com",
  GIT_COMMITTER_NAME: "bun-test",
  GIT_COMMITTER_EMAIL: "bun-test@example.com",
  GIT_CONFIG_NOSYSTEM: "1",
};

async function git(cwd: string, args: string[]) {
  await using proc = spawn({ cmd: ["git", ...args], cwd, env: gitEnv, stdout: "pipe", stderr: "pipe" });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) throw new Error(`git ${args.join(" ")} exited with ${exitCode}: ${stderr}`);
}

describe.concurrent("a dependency that changes source at the same name and version", () => {
  type Manifest = {
    name: string;
    version: string;
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  };

  const depC = { name: "dep-c", version: "1.0.1" };
  const pack = (manifest: Manifest, marker: string) =>
    new Bun.Archive(
      { "package/package.json": JSON.stringify(manifest), "package/marker.txt": marker },
      { compress: "gzip" },
    ).bytes();

  /**
   * A project that uses the hoisted linker and its own registry. The registry publishes
   * `dep-c@1.0.1`, `p@1.0.0` (depends on `dep-c@^1.0.0`) and `no-deps@1.0.0`. Six more copies of
   * `dep-c@1.0.1` exist outside the registry: a tarball on the same host (`tarballUrl`),
   * `./dep-c-1.0.1.tgz`, the folder `./dep-c-folder`, the workspace `./packages/dep-c`, the linked
   * folder `./linked` and the git repository `./git-dep-c`. Every copy has a `marker.txt` that
   * names its source.
   */
  async function sourceSwitchProject() {
    const published: Manifest[] = [];
    const tarballs = new Map<string, Uint8Array>();
    const requests: string[] = [];
    // Package name -> the version range `bun audit` reports as vulnerable.
    const vulnerable: Record<string, string> = {};
    let registryTarballsFail = false;
    const publish = async (manifest: Manifest) => {
      published.push(manifest);
      tarballs.set(`${manifest.name}-${manifest.version}.tgz`, await pack(manifest, "registry"));
    };
    await publish(depC);
    await publish({ name: "p", version: "1.0.0", dependencies: { "dep-c": "^1.0.0" } });
    await publish({ name: "no-deps", version: "1.0.0" });
    const urlTarball = await pack(depC, "tarball");

    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req, server) {
        const { pathname } = new URL(req.url);
        requests.push(pathname);
        if (pathname === "/-/npm/v1/security/advisories/bulk") {
          const installed: Record<string, string[]> = await gunzipJsonRequest(req);
          const advisories: Record<string, object[]> = {};
          for (const [name, versions] of Object.entries(installed)) {
            const range = vulnerable[name];
            if (range && versions.some(version => Bun.semver.satisfies(version, range))) {
              advisories[name] = [{ id: 1, title: name, severity: "high", url: "", vulnerable_versions: range }];
            }
          }
          return Response.json(advisories);
        }
        if (pathname === "/tarballs/dep-c-1.0.1.tgz") return new Response(urlTarball);
        if (pathname.includes("/-/")) {
          const tarball = registryTarballsFail ? undefined : tarballs.get(basename(pathname));
          return tarball ? new Response(tarball) : new Response(null, { status: 404 });
        }
        const name = pathname.slice(1);
        const versions = published.filter(manifest => manifest.name === name);
        if (versions.length === 0) return new Response(null, { status: 404 });
        return Response.json({
          name,
          "dist-tags": { latest: versions.at(-1)!.version },
          versions: Object.fromEntries(
            versions.map(manifest => [
              manifest.version,
              {
                ...manifest,
                dist: { tarball: `http://127.0.0.1:${server.port}/${name}/-/${name}-${manifest.version}.tgz` },
              },
            ]),
          ),
        });
      },
    });
    const origin = `http://127.0.0.1:${server.port}`;
    const copy = (marker: string) => ({ "package.json": JSON.stringify(depC), "marker.txt": marker });
    const dir = tempDir("hoisted-relink", {
      "bunfig.toml": Bun.TOML.stringify({ install: { registry: `${origin}/`, linker: "hoisted" } }),
      "dep-c-1.0.1.tgz": Buffer.from(await pack(depC, "local tarball")),
      "dep-c-folder": copy("folder"),
      "packages": { "dep-c": copy("workspace") },
      "linked": copy("link"),
      "git-dep-c": copy("git"),
    });
    const root = String(dir);
    const cache = join(root, ".bun-cache");
    const env = {
      ...gitEnv,
      BUN_INSTALL_CACHE_DIR: cache,
      BUN_INSTALL_GLOBAL_DIR: join(root, ".bun-global"),
      BUN_INSTALL_BIN: join(root, ".bun-bin"),
      BUN_CONFIG_REGISTRY: `${origin}/`,
    };

    /** Runs `bun <args>` in `cwd`. `out` is stdout without the version header and the timing. */
    async function runIn(cwd: string, ...args: string[]) {
      await using proc = spawn({ cmd: [bunExe(), ...args], cwd, env, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const out = stdout
        .replaceAll("\r\n", "\n")
        .replace(/^bun [\w ]+ v\d.*\n/, "")
        .replace(/ ?\[[\d.]+m?s\] ?/g, "")
        .replaceAll(origin, "<registry>")
        .trim();
      return { out, stderr: stderr.replaceAll(origin, "<registry>"), exitCode };
    }

    return {
      tarballUrl: `${origin}/tarballs/dep-c-1.0.1.tgz`,
      requests,
      publish,
      vulnerable,
      failRegistryTarballs: () => void (registryTarballsFail = true),
      manifest: (fields: object) =>
        writeFileSync(join(root, "package.json"), JSON.stringify({ name: "app", version: "1.0.0", ...fields })),
      /** Writes the package.json of the workspace in `folder`, which is named after the folder. */
      workspace: (folder: string, fields: object) =>
        write(
          join(root, folder, "package.json"),
          JSON.stringify({ name: basename(folder), version: "1.0.0", ...fields }),
        ),
      path: (...parts: string[]) => join(root, ...parts),
      run: (...args: string[]) => runIn(root, ...args),
      lockfile: () => file(join(root, "bun.lock")).text(),
      /** Registers `./linked` so that `link:dep-c` resolves to it. */
      link: () => runIn(join(root, "linked"), "link"),
      /** Commits `./git-dep-c` and returns the dependency spec for it. */
      async gitUrl() {
        const repo = join(root, "git-dep-c");
        await git(repo, ["-c", "init.defaultBranch=main", "init", "--quiet"]);
        await git(repo, ["add", "-A"]);
        await git(repo, ["-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "init"]);
        return `git+${pathToFileURL(repo)}`;
      },
      /** Makes the next resolve ask the registry again for versions published since the last one. */
      async forgetManifests() {
        for (const entry of await readdirSorted(cache)) {
          if (entry.endsWith(".npm")) await rm(join(cache, entry));
        }
      },
      /** Removes what the cache holds of one registry package. Its manifest stays. */
      async forget(nameAndVersion = "dep-c@1.0.1") {
        for (const entry of await readdirSorted(cache)) {
          if (entry.startsWith(nameAndVersion)) await rm(join(cache, entry), { recursive: true });
        }
      },
      /** What `path` is and which copy of the package it holds. */
      slot(path = "node_modules/dep-c"): { kind: string; marker?: string } {
        const full = join(root, path);
        const stats = lstatSync(full, { throwIfNoEntry: false });
        if (!stats) return { kind: "missing" };
        return {
          kind: stats.isSymbolicLink() ? "link" : "directory",
          marker: readFileSync(join(full, "marker.txt"), "utf8"),
        };
      },
      /**
       * Every package below `<folder>/node_modules`: "<path>: <marker>" for a copy and
       * "<path> -> <marker>" for a link.
       */
      tree(folder = ""): string[] {
        const entries: string[] = [];
        const walk = (dir: string, prefix: string) => {
          for (const name of readdirSync(dir).sort()) {
            if (name.startsWith(".")) continue;
            const full = join(dir, name);
            const link = lstatSync(full).isSymbolicLink();
            const marker = join(full, "marker.txt");
            // A workspace of a test has no marker. It is named by its package.json.
            const { name: packageName, version } = JSON.parse(readFileSync(join(full, "package.json"), "utf8"));
            const holds = existsSync(marker) ? readFileSync(marker, "utf8") : `${packageName}@${version}`;
            entries.push(`${prefix}${name}${link ? " -> " : ": "}${holds}`);
            const nested = join(full, "node_modules");
            if (!link && existsSync(nested)) walk(nested, `${prefix}${name}/node_modules/`);
          }
        };
        const top = join(root, folder, "node_modules");
        if (existsSync(top)) walk(top, "");
        return entries;
      },
      /** Puts a file the linker did not write into the package at `path`. It is gone if the directory is replaced. */
      mark: (path: string) => writeFileSync(join(root, path, ".kept"), ""),
      kept: (path: string) => existsSync(join(root, path, ".kept")),
      async [Symbol.asyncDispose]() {
        await server.stop(true);
        await dir[Symbol.asyncDispose]();
      },
    };
  }

  type Project = Awaited<ReturnType<typeof sourceSwitchProject>>;
  type Run = Awaited<ReturnType<Project["run"]>>;
  const fromRegistry = { kind: "directory", marker: "registry" };
  const fromTarball = { kind: "directory", marker: "tarball" };
  // A run that links what it has to and reports no problem.
  const relinked = { stderr: expect.not.stringMatching(/error|warn/), exitCode: 0 };

  /**
   * node_modules holds `tree`, and a repeat install has nothing to do there. `checked` is the
   * "N installs across M packages" of its summary.
   */
  async function expectSettled(app: Project, checked: string, tree: string[], folder?: string) {
    expect(app.tree(folder)).toEqual(tree);
    expect(await app.run("install", "--frozen-lockfile")).toMatchObject({
      out: `Checked ${checked} (no changes)`,
      exitCode: 0,
    });
    expect(app.tree(folder)).toEqual(tree);
  }

  /** The folders that an entry linked or copied are as they were. */
  function expectSourceFoldersKept(app: Project) {
    expect(["dep-c-folder", "packages/dep-c", "linked"].map(folder => app.slot(folder).marker)).toEqual([
      "folder",
      "workspace",
      "link",
    ]);
  }

  type SourceManifest = { workspaces?: string[]; dependencies: Record<string, string> };
  type Source = {
    name: string;
    installed: object;
    manifest: (app: Project) => SourceManifest | Promise<SourceManifest>;
  };
  const sources: Source[] = [
    {
      name: "a tarball URL",
      installed: fromTarball,
      manifest: app => ({ dependencies: { "dep-c": app.tarballUrl } }),
    },
    {
      name: "a local tarball",
      installed: { kind: "directory", marker: "local tarball" },
      manifest: () => ({ dependencies: { "dep-c": "file:./dep-c-1.0.1.tgz" } }),
    },
    {
      name: "a file: folder",
      installed: { kind: "directory", marker: "folder" },
      manifest: () => ({ dependencies: { "dep-c": "file:./dep-c-folder" } }),
    },
    {
      name: "a workspace",
      installed: { kind: "link", marker: "workspace" },
      manifest: () => ({ workspaces: ["packages/*"], dependencies: { "dep-c": "workspace:*" } }),
    },
    {
      name: "a link: dependency",
      installed: { kind: "link", marker: "link" },
      manifest: async app => (await app.link(), { dependencies: { "dep-c": "link:dep-c" } }),
    },
    {
      name: "a git repository",
      installed: { kind: "directory", marker: "git" },
      manifest: async app => ({ dependencies: { "dep-c": await app.gitUrl() } }),
    },
  ];

  type Order = {
    name: string;
    dependent: boolean;
    switch: (app: Project, manifest: SourceManifest) => Promise<Run>;
    out: string;
  };
  const orders: Order[] = [
    {
      name: "a spec edit",
      dependent: false,
      switch: async app => (app.manifest({ dependencies: { "dep-c": "^1.0.0" } }), app.run("install")),
      out: "+ dep-c@1.0.1\n\n1 package installed",
    },
    {
      // The edited edge moves onto the row `p` already uses: no lockfile row is added.
      name: "a spec edit while another dependent resolves the registry package",
      dependent: true,
      switch: async app => (app.manifest({ dependencies: { "dep-c": "^1.0.0", p: "1.0.0" } }), app.run("install")),
      out: "+ dep-c@1.0.1\n\n1 package installed",
    },
    {
      name: "bun add",
      dependent: false,
      // `bun add` writes the registry range over the old spec. A workspace of that name would
      // satisfy the range, so `workspaces` goes first.
      switch: async (app, { workspaces, ...manifest }) => (app.manifest(manifest), app.run("add", "dep-c")),
      out: "installed dep-c@1.0.1\n\n1 package installed",
    },
  ];

  describe.each(sources)("$name replaced by the registry package", source => {
    // A workspace satisfies the range of `p`, so no registry row exists before that switch.
    const applicable = orders.filter(order => !(order.dependent && source.name === "a workspace"));

    it.each(applicable)("through $name", async order => {
      await using app = await sourceSwitchProject();
      const manifest = await source.manifest(app);
      if (order.dependent) manifest.dependencies.p = "1.0.0";
      app.manifest(manifest);
      await app.run("install");
      expect(app.slot()).toEqual(source.installed);

      // The workspace leaves bun.lock with its `workspaces` entry.
      const out = order.out + (manifest.workspaces ? "\nRemoved: 1" : "");
      expect(await order.switch(app, manifest)).toMatchObject({ ...relinked, out });
      if (order.dependent) {
        // `p` had its own registry copy. It now uses the one in the root slot.
        await expectSettled(app, "2 installs across 3 packages", ["dep-c: registry", "p: registry"]);
      } else {
        await expectSettled(app, "1 install across 2 packages", ["dep-c: registry"]);
      }
      expectSourceFoldersKept(app);
    });
  });

  describe("replaced by a workspace", () => {
    it.each(sources.filter(source => source.name !== "a workspace"))("$name", async source => {
      await using app = await sourceSwitchProject();
      app.manifest(await source.manifest(app));
      await app.run("install");
      expect(app.slot()).toEqual(source.installed);

      app.manifest({ workspaces: ["packages/*"], dependencies: { "dep-c": "workspace:*" } });
      const out = "+ dep-c@workspace:packages/dep-c\n\n1 package installed";
      expect(await app.run("install")).toMatchObject({ ...relinked, out });
      await expectSettled(app, "1 install across 2 packages", ["dep-c -> workspace"]);
      expectSourceFoldersKept(app);
    });

    // The range stays the same. Only the workspace list says which `dep-c@1.0.1` it resolves to.
    it("the registry package, and by the registry package again, while the range stays the same", async () => {
      await using app = await sourceSwitchProject();
      const dependencies = { "dep-c": "^1.0.0" };
      app.manifest({ dependencies });
      await app.run("install");
      expect(app.tree()).toEqual(["dep-c: registry"]);

      app.manifest({ workspaces: ["packages/*"], dependencies });
      const out = "+ dep-c@workspace:packages/dep-c\n\n1 package installed";
      expect(await app.run("install")).toMatchObject({ ...relinked, out });
      expect(app.tree()).toEqual(["dep-c -> workspace"]);

      app.manifest({ dependencies });
      expect(await app.run("install")).toMatchObject({
        ...relinked,
        out: "+ dep-c@1.0.1\n\n1 package installed\nRemoved: 1",
      });
      expect(app.tree()).toEqual(["dep-c: registry"]);
    });

    // Both folders hold `dep-c@1.0.1`, so only the lockfile row says which one the link points to.
    it("a workspace of the same name in another folder", async () => {
      await using app = await sourceSwitchProject();
      await write(app.path("libs", "dep-c", "package.json"), JSON.stringify(depC));
      await write(app.path("libs", "dep-c", "marker.txt"), "moved workspace");
      app.manifest({ workspaces: ["packages/*"], dependencies: { "dep-c": "workspace:*" } });
      await app.run("install");
      expect(app.tree()).toEqual(["dep-c -> workspace"]);

      app.manifest({ workspaces: ["libs/*"], dependencies: { "dep-c": "workspace:*" } });
      const out = "+ dep-c@workspace:libs/dep-c\n\n1 package installed";
      expect(await app.run("install")).toMatchObject({ ...relinked, out });
      expect(app.tree()).toEqual(["dep-c -> moved workspace"]);
      expectSourceFoldersKept(app);
    });
  });

  describe("a tarball URL replaced by the registry package", () => {
    it("without a request to the registry when the cache has the package", async () => {
      await using app = await sourceSwitchProject();
      app.manifest({ dependencies: { "dep-c": app.tarballUrl, p: "1.0.0" } });
      await app.run("install");
      expect(app.tree()).toEqual(["dep-c: tarball", "p: registry", "p/node_modules/dep-c: registry"]);

      app.manifest({ dependencies: { "dep-c": "^1.0.0", p: "1.0.0" } });
      app.requests.length = 0;
      expect(await app.run("install")).toMatchObject({ ...relinked, out: "+ dep-c@1.0.1\n\n1 package installed" });
      expect(app.requests).toEqual([]);
      expect(app.slot()).toEqual(fromRegistry);
    });

    it("through `bun add -g`", async () => {
      await using app = await sourceSwitchProject();
      await app.run("add", "-g", app.tarballUrl);
      expect(app.tree(".bun-global")).toEqual(["dep-c: tarball"]);

      const out = "installed dep-c@1.0.1\n\n1 package installed";
      expect(await app.run("add", "-g", "dep-c")).toMatchObject({ ...relinked, out });
      expect(app.tree(".bun-global")).toEqual(["dep-c: registry"]);
    });

    it("when the override that names it is removed", async () => {
      await using app = await sourceSwitchProject();
      app.manifest({ dependencies: { p: "1.0.0" }, overrides: { "dep-c": app.tarballUrl } });
      await app.run("install");
      expect(app.slot()).toEqual(fromTarball);

      app.manifest({ dependencies: { p: "1.0.0" } });
      expect(await app.run("install")).toMatchObject({ ...relinked, out: "1 package installed" });
      await expectSettled(app, "2 installs across 3 packages", ["dep-c: registry", "p: registry"]);
    });

    it("when `bun remove` lets the registry copy of a dependent take the root slot", async () => {
      await using app = await sourceSwitchProject();
      app.manifest({ dependencies: { "dep-c": app.tarballUrl, p: "1.0.0" } });
      await app.run("install");
      expect(app.slot()).toEqual(fromTarball);

      expect(await app.run("remove", "dep-c")).toMatchObject({ ...relinked, out: "1 package installed" });
      await expectSettled(app, "2 installs across 3 packages", ["dep-c: registry", "p: registry"]);
    });

    // The install skips the root's own row. It links the slot for `p`, which resolves to the same package.
    it("when the install that saves the edit omits the dependency group", async () => {
      await using app = await sourceSwitchProject();
      const manifest = (spec: string) => ({ dependencies: { p: "1.0.0" }, devDependencies: { "dep-c": spec } });
      app.manifest(manifest(app.tarballUrl));
      await app.run("install");
      expect(app.slot()).toEqual(fromTarball);

      app.manifest(manifest("^1.0.0"));
      expect(await app.run("install", "--omit=dev")).toMatchObject({ ...relinked, out: "1 package installed" });
      await expectSettled(app, "2 installs across 3 packages", ["dep-c: registry", "p: registry"]);
    });
  });

  // The spec stays `catalog:`. Only the catalog entry says which `dep-c@1.0.1` the edge resolves
  // to, and the differ reports a changed catalog and nothing added, removed or updated.
  describe("a catalog entry for a tarball URL replaced by a registry range", () => {
    it.each<[string, (app: Project, spec: string) => Promise<unknown> | void, string, string[]]>([
      [
        "a workspace's `catalog:` dependency",
        async (app, spec) => {
          await app.workspace("libs/lib", { dependencies: { "dep-c": "catalog:" } });
          app.manifest({ workspaces: { packages: ["libs/*"], catalog: { "dep-c": spec } } });
        },
        "1 package installed",
        ["dep-c: registry", "lib -> lib@1.0.0"],
      ],
      [
        "the root's dependency on a named catalog",
        (app, spec) =>
          app.manifest({
            workspaces: { catalogs: { tools: { "dep-c": spec } } },
            dependencies: { "dep-c": "catalog:tools" },
          }),
        "+ dep-c@1.0.1\n\n1 package installed",
        ["dep-c: registry"],
      ],
      [
        "an override valued `catalog:`",
        (app, spec) =>
          app.manifest({
            workspaces: { catalog: { "dep-c": spec } },
            overrides: { "dep-c": "catalog:" },
            dependencies: { p: "1.0.0" },
          }),
        "1 package installed",
        ["dep-c: registry", "p: registry"],
      ],
    ])("used by %s", async (_, manifest, out, tree) => {
      await using app = await sourceSwitchProject();
      await manifest(app, app.tarballUrl);
      await app.run("install");
      expect(app.slot()).toEqual(fromTarball);

      await manifest(app, "^1.0.0");
      expect(await app.run("install")).toMatchObject({ ...relinked, out });
      expect(app.tree()).toEqual(tree);
    });
  });

  describe("a transitive tarball URL", () => {
    // `t` keeps its tarball copy, which moves into `t`'s own node_modules when the root takes the
    // registry package. Only the slot tells the two rows apart: both stay in bun.lock.
    it("that moves under its dependent when the root adds the registry package", async () => {
      await using app = await sourceSwitchProject();
      await app.publish({ name: "t", version: "1.0.0", dependencies: { "dep-c": app.tarballUrl } });
      app.manifest({ dependencies: { t: "1.0.0" } });
      await app.run("install");
      expect(app.tree()).toEqual(["dep-c: tarball", "t: registry"]);

      const out = "installed dep-c@1.0.1\n\n2 packages installed";
      expect(await app.run("add", "dep-c")).toMatchObject({ ...relinked, out });
      const tree = ["dep-c: registry", "t: registry", "t/node_modules/dep-c: tarball"];
      await expectSettled(app, "3 installs across 4 packages", tree);
    });

    it("replaced by a registry range in the dependent's next version", async () => {
      await using app = await sourceSwitchProject();
      await app.publish({ name: "q", version: "1.0.0", dependencies: { "dep-c": app.tarballUrl } });
      await app.publish({ name: "q", version: "1.0.1", dependencies: { "dep-c": "^1.0.0" } });
      app.manifest({ dependencies: { q: "1.0.0" } });
      await app.run("install");
      expect(app.slot()).toEqual(fromTarball);

      app.manifest({ dependencies: { q: "1.0.1" } });
      expect(await app.run("install")).toMatchObject({ ...relinked, out: "+ q@1.0.1\n\n2 packages installed" });
      await expectSettled(app, "2 installs across 3 packages", ["dep-c: registry", "q: registry"]);
    });

    // The root pins `r`, so the differ reports no change for any of these commands. Only the
    // re-resolution of `q` moves `dep-c` to the registry.
    it.each([
      ["update", "^ q 1.0.0 -> 1.0.1\n\n2 packages installed"],
      ["update q", "^ q 1.0.0 -> 1.0.1\n\n2 packages installed"],
      ["audit fix", "fixing:\n  ^ q 1.0.0 -> 1.0.1\n\nFixed 1 vulnerability in 1 package (checked 2)"],
    ])("replaced by `bun %s`", async (command, out) => {
      await using app = await sourceSwitchProject();
      await app.publish({ name: "r", version: "1.0.0", dependencies: { q: "^1.0.0" } });
      await app.publish({ name: "q", version: "1.0.0", dependencies: { "dep-c": app.tarballUrl } });
      app.manifest({ dependencies: { r: "1.0.0" } });
      await app.run("install");
      expect(app.slot()).toEqual(fromTarball);

      await app.publish({ name: "q", version: "1.0.1", dependencies: { "dep-c": "^1.0.0" } });
      app.vulnerable.q = "<1.0.1";
      expect(await app.run(...command.split(" "))).toMatchObject({ out, exitCode: 0 });
      await expectSettled(app, "3 installs across 4 packages", ["dep-c: registry", "q: registry", "r: registry"]);
    });

    // `a` keeps `x@1.0.0` (which needs the tarball) until `bun dedupe` moves it to the `x@1.1.0`
    // that `b` brought in, which needs the registry package.
    it("replaced by `bun dedupe`", async () => {
      await using app = await sourceSwitchProject();
      await app.publish({ name: "a", version: "1.0.0", dependencies: { x: "^1.0.0" } });
      await app.publish({ name: "x", version: "1.0.0", dependencies: { "dep-c": app.tarballUrl } });
      app.manifest({ dependencies: { a: "1.0.0" } });
      await app.run("install");
      await app.publish({ name: "x", version: "1.1.0", dependencies: { "dep-c": "^1.0.0" } });
      await app.publish({ name: "b", version: "1.0.0", dependencies: { x: "^1.1.0" } });
      await app.forgetManifests();
      app.manifest({ dependencies: { a: "1.0.0", b: "1.0.0" } });
      await app.run("install");
      expect(app.slot()).toEqual(fromTarball);

      expect(await app.run("dedupe")).toMatchObject({
        out: expect.stringContaining("1 duplicate version removed, 2 packages installed"),
        exitCode: 0,
      });
      expect(app.tree()).toEqual(["a: registry", "b: registry", "dep-c: registry", "x: registry"]);
    });
  });

  describe("in the node_modules of a workspace", () => {
    // A self-contained workspace keeps its dependencies in its own node_modules. bun.lock saves
    // them at the root.
    it("a file: folder replaced by a registry range inside a self-contained workspace", async () => {
      await using app = await sourceSwitchProject();
      app.manifest({ workspaces: { packages: ["apps/*"], selfContained: ["desktop"] } });
      await app.workspace("apps/desktop", { dependencies: { "dep-c": "file:../../dep-c-folder" } });
      await app.run("install");
      expect(app.tree("apps/desktop")).toEqual(["dep-c: folder"]);

      await app.workspace("apps/desktop", { dependencies: { "dep-c": "^1.0.0" } });
      expect(await app.run("install")).toMatchObject({ ...relinked, out: "1 package installed" });
      await expectSettled(app, "2 installs across 3 packages", ["dep-c: registry"], "apps/desktop");
    });

    // The root holds `dep-c@2.0.0`, so `lib` has its own copy.
    it.each<[string, (app: Project) => Promise<Run>, string]>([
      [
        "`bun install --filter`",
        async app => {
          await app.workspace("libs/lib", { dependencies: { "dep-c": "^1.0.0" } });
          return app.run("install", "--filter", "lib");
        },
        "1 package installed",
      ],
      [
        "`bun add --filter`",
        app => app.run("add", "--filter", "lib", "dep-c@1.0.1"),
        "installed dep-c@1.0.1\n\n1 package installed",
      ],
    ])("a tarball URL replaced by the registry package through %s", async (_, replace, out) => {
      await using app = await sourceSwitchProject();
      await app.publish({ name: "dep-c", version: "2.0.0" });
      await app.workspace("libs/lib", { dependencies: { "dep-c": app.tarballUrl } });
      app.manifest({ workspaces: ["libs/*"], dependencies: { "dep-c": "2.0.0" } });
      await app.run("install");
      expect(app.tree("libs/lib")).toEqual(["dep-c: tarball"]);

      expect(await replace(app)).toMatchObject({ ...relinked, out });
      expect(app.tree("libs/lib")).toEqual(["dep-c: registry"]);
    });
  });

  describe("one dependency that fills two slots", () => {
    // `q@1.0.0` sits under both `b` and `c` (the root holds `q@2.0.0`), and its `dep-c` cannot
    // hoist (the root holds `dep-c@2.0.0`), so the one edge from `q` to `dep-c` fills two slots.
    it("replaces both when both held the tarball", async () => {
      await using app = await sourceSwitchProject();
      await app.publish({ name: "dep-c", version: "2.0.0" });
      await app.publish({ name: "q", version: "1.0.0", dependencies: { "dep-c": "^1.0.0" } });
      await app.publish({ name: "q", version: "2.0.0" });
      await app.publish({ name: "b", version: "1.0.0", dependencies: { q: "^1.0.0" } });
      await app.publish({ name: "c", version: "1.0.0", dependencies: { q: "^1.0.0" } });
      const dependencies = { b: "1.0.0", c: "1.0.0", q: "2.0.0", "dep-c": "2.0.0" };
      const slots = () =>
        ["b", "c"].map(parent => app.slot(`node_modules/${parent}/node_modules/q/node_modules/dep-c`));
      app.manifest({ dependencies, overrides: { q: { "dep-c": app.tarballUrl } } });
      await app.run("install");
      expect(slots()).toEqual([fromTarball, fromTarball]);

      app.manifest({ dependencies });
      expect(await app.run("install")).toMatchObject({ ...relinked, out: "1 package installed" });
      expect(slots()).toEqual([fromRegistry, fromRegistry]);
    });

    // In `apps/one` the slot already holds the registry copy that `p` needs. Only the slot in
    // `apps/two` held the tarball copy of `q`.
    it("replaces only the one that held the tarball", async () => {
      await using app = await sourceSwitchProject();
      await app.publish({ name: "q", version: "1.0.0", dependencies: { "dep-c": app.tarballUrl } });
      await app.publish({ name: "q", version: "1.0.1", dependencies: { "dep-c": "^1.0.0" } });
      app.manifest({ workspaces: { packages: ["apps/*"], selfContained: ["one", "two"] } });
      await app.workspace("apps/one", { dependencies: { p: "1.0.0", q: "1.0.0" } });
      await app.workspace("apps/two", { dependencies: { q: "1.0.0" } });
      await app.run("install");
      expect(app.slot("apps/one/node_modules/dep-c")).toEqual(fromRegistry);
      expect(app.slot("apps/two/node_modules/dep-c")).toEqual(fromTarball);
      app.mark("apps/one/node_modules/dep-c");

      await app.workspace("apps/one", { dependencies: { p: "1.0.0", q: "1.0.1" } });
      await app.workspace("apps/two", { dependencies: { q: "1.0.1" } });
      expect(await app.run("install")).toMatchObject({ ...relinked, out: "2 packages installed" });
      expect(app.slot("apps/two/node_modules/dep-c")).toEqual(fromRegistry);
      expect(app.kept("apps/one/node_modules/dep-c")).toBe(true);
    });
  });

  // The root depends on the registry's `lib@2.0.0`, and the workspace `lib@1.0.0` does not satisfy
  // that range. `node_modules/lib/node_modules` and `libs/lib/node_modules` then have one key in
  // the hoisted tree, so the two `dep-c` slots are told apart by what they hold.
  describe("a root dependency that has the name of a workspace", () => {
    const ofRegistryLib = "node_modules/lib/node_modules/dep-c";
    const ofWorkspace = "libs/lib/node_modules/dep-c";
    async function project() {
      const app = await sourceSwitchProject();
      await app.publish({ name: "dep-c", version: "2.0.0" });
      await app.publish({ name: "lib", version: "2.0.0", dependencies: { "dep-c": "^1.0.0" } });
      await app.workspace("libs/lib", { dependencies: { "dep-c": app.tarballUrl } });
      app.manifest({ workspaces: ["libs/*"], dependencies: { "dep-c": "2.0.0", lib: "2.0.0" } });
      await app.run("install");
      expect([app.slot(ofRegistryLib), app.slot(ofWorkspace)]).toEqual([fromRegistry, fromTarball]);
      app.mark(ofRegistryLib);
      app.mark(ofWorkspace);
      return app;
    }

    it("keeps both slots when neither changes source", async () => {
      await using app = await project();
      const out = "installed no-deps@1.0.0\n\n1 package installed";
      expect(await app.run("add", "no-deps")).toMatchObject({ ...relinked, out });
      expect([app.kept(ofRegistryLib), app.kept(ofWorkspace)]).toEqual([true, true]);
    });

    it("replaces the tarball of the workspace with the registry package", async () => {
      await using app = await project();
      await app.workspace("libs/lib", { dependencies: { "dep-c": "^1.0.0" } });
      expect(await app.run("install")).toMatchObject({ ...relinked, out: "1 package installed" });
      expect([app.slot(ofRegistryLib), app.slot(ofWorkspace)]).toEqual([fromRegistry, fromRegistry]);
    });
  });

  // No row of bun.lock has an identity on disk before or after these edits: the install takes any
  // directory for a `file:` folder of a dependent and for the root package.
  describe("a registry package", () => {
    it("replaced by a file: folder under its dependent when an override is added, and back", async () => {
      await using app = await sourceSwitchProject();
      await app.publish({ name: "dep-c", version: "2.0.0" });
      // The root pins `dep-c@2.0.0`, so the copy for `p` is nested.
      const dependencies = { p: "1.0.0", "dep-c": "2.0.0" };
      const nested = "node_modules/p/node_modules/dep-c";
      app.manifest({ dependencies });
      await app.run("install");
      expect(app.slot(nested)).toEqual(fromRegistry);

      app.manifest({ dependencies, overrides: { p: { "dep-c": "file:./dep-c-folder" } } });
      expect(await app.run("install")).toMatchObject({ ...relinked, out: "1 package installed" });
      expect(app.slot(nested)).toEqual({ kind: "directory", marker: "folder" });

      app.manifest({ dependencies });
      expect(await app.run("install")).toMatchObject({ ...relinked, out: "1 package installed" });
      expect(app.slot(nested)).toEqual(fromRegistry);
    });

    it("replaced by the root package", async () => {
      await using app = await sourceSwitchProject();
      await write(app.path("marker.txt"), "root");
      app.manifest({ dependencies: { "dep-c": "^1.0.0" } });
      await app.run("install");
      expect(app.slot()).toEqual(fromRegistry);

      app.manifest({ dependencies: { "dep-c": "file:." } });
      expect(await app.run("install")).toMatchObject({ exitCode: 0 });
      expect(app.slot()).toEqual({ kind: "link", marker: "root" });
    });
  });

  // `bun update` removes the copy under `p` once the root resolves the same row, so by then the
  // root slot has to hold the registry package.
  describe("`bun update` after the root's tarball URL is edited to a registry range", () => {
    const manifest = (spec: string) => ({ dependencies: { "dep-c": spec, p: "1.0.0" } });
    const before = ["dep-c: tarball", "p: registry", "p/node_modules/dep-c: registry"];

    it("links the registry package at the root and removes the copy under the dependent", async () => {
      await using app = await sourceSwitchProject();
      app.manifest(manifest(app.tarballUrl));
      await app.run("install");
      expect(app.tree()).toEqual(before);

      app.manifest(manifest("^1.0.0"));
      expect(await app.run("update")).toMatchObject({ exitCode: 0 });
      expect(app.tree()).toEqual(["dep-c: registry", "p: registry"]);
    });

    it("keeps the copy under the dependent when the registry package cannot be downloaded", async () => {
      await using app = await sourceSwitchProject();
      app.manifest(manifest(app.tarballUrl));
      await app.run("install");

      await app.forget();
      app.failRegistryTarballs();
      app.manifest(manifest("^1.0.0"));
      expect(await app.run("update")).toMatchObject({
        stderr: expect.stringContaining("GET <registry>/dep-c/-/dep-c-1.0.1.tgz - 404"),
        exitCode: 1,
      });
      expect(app.tree()).toEqual(before);
    });
  });

  // The walk over node_modules does not link the entry: a task that completes later does.
  describe("a slot that is linked when a task completes", () => {
    // `p` already has the registry row, so nothing is downloaded while the install resolves. The
    // cache no longer holds the package, so the link step downloads it.
    it.each<[string, (app: Project) => Promise<Run>, string]>([
      [
        "a spec edit",
        async app => (app.manifest({ dependencies: { "dep-c": "^1.0.0", p: "1.0.0" } }), app.run("install")),
        "+ dep-c@1.0.1\n\n1 package installed",
      ],
      ["bun remove", app => app.run("remove", "dep-c"), "1 package installed"],
    ])(
      "a tarball URL replaced through %s by a registry package that the link step downloads",
      async (_, replace, out) => {
        await using app = await sourceSwitchProject();
        app.manifest({ dependencies: { "dep-c": app.tarballUrl, p: "1.0.0" } });
        await app.run("install");
        expect(app.slot()).toEqual(fromTarball);

        await app.forget();
        app.requests.length = 0;
        expect(await replace(app)).toMatchObject({ ...relinked, out });
        expect(app.requests).toEqual(["/dep-c/-/dep-c-1.0.1.tgz"]);
        expect(app.slot()).toEqual(fromRegistry);
      },
    );

    // The root folder still waits for `no-deps` when the walk reaches the slot under `p`, so the
    // slot is linked once the root folder completes.
    it("a nested tarball URL replaced by a registry package while its parent folder waits for a download", async () => {
      await using app = await sourceSwitchProject();
      await app.publish({ name: "dep-c", version: "2.0.0" });
      const nested = "node_modules/p/node_modules/dep-c";
      const dependencies = { "dep-c": "2.0.0", p: "1.0.0", "no-deps": "1.0.0" };
      app.manifest({ dependencies, overrides: { p: { "dep-c": app.tarballUrl } } });
      await app.run("install");
      expect(app.slot(nested)).toEqual(fromTarball);

      await rm(app.path("node_modules", "no-deps"), { recursive: true });
      await app.forget("no-deps@1.0.0");
      app.manifest({ dependencies });
      expect(await app.run("install")).toMatchObject({ ...relinked, out: "+ no-deps@1.0.0\n\n2 packages installed" });
      expect(app.slot(nested)).toEqual(fromRegistry);
    });
  });

  // The install does not link the registry package, so the entry stays as it was.
  describe("keeps the old entry", () => {
    // The install fails and bun.lock is not saved: it still names the tarball URL.
    it.each<[string, Record<string, string>, (app: Project) => Promise<unknown>, string[], string]>([
      [
        // The registry row is new, so the resolve step downloads it.
        "the download of a required dependency fails while the new row resolves",
        {},
        async app => app.failRegistryTarballs(),
        ["install"],
        "error: GET <registry>/dep-c/-/dep-c-1.0.1.tgz - 404",
      ],
      [
        // `p` already has the registry row, so only the link step downloads it.
        "the download of a required dependency fails while the slot is linked",
        { p: "1.0.0" },
        async app => (app.failRegistryTarballs(), app.forget()),
        ["install"],
        "error: GET <registry>/dep-c/-/dep-c-1.0.1.tgz - 404",
      ],
      [
        "a required dependency is not in the cache under --offline",
        { p: "1.0.0" },
        app => app.forget(),
        ["install", "--offline"],
        'error: --offline: "dep-c" is not in the cache',
      ],
      [
        // The cache has the registry package. The run fails before it saves bun.lock all the same.
        "another dependency of the same edit does not resolve",
        { p: "1.0.0", "not-published": "1.0.0" },
        async () => {},
        ["install"],
        "error: not-published@1.0.0 failed to resolve",
      ],
    ])("when %s", async (_, others, breakRegistry, install, error) => {
      await using app = await sourceSwitchProject();
      const { "not-published": _missing, ...installed } = others;
      app.manifest({ dependencies: { "dep-c": app.tarballUrl, ...installed } });
      await app.run("install");
      const lockfile = await app.lockfile();
      const tree = app.tree();

      await breakRegistry(app);
      app.manifest({ dependencies: { "dep-c": "^1.0.0", ...others } });
      expect(await app.run(...install)).toMatchObject({ stderr: expect.stringContaining(error), exitCode: 1 });
      expect(app.tree()).toEqual(tree);
      expect(await app.lockfile()).toBe(lockfile);
    });

    // `q` needs `dep-c` only optionally, so the install saves bun.lock with the registry row for
    // both edges. The root slot still holds the tarball. The copy under `q` is the one registry copy.
    describe("and the registry copy under a dependent", () => {
      const before = ["dep-c: tarball", "q: registry", "q/node_modules/dep-c: registry"];
      const manifest = (spec: string) => ({ dependencies: { q: "1.0.0" }, optionalDependencies: { "dep-c": spec } });
      async function project() {
        const app = await sourceSwitchProject();
        await app.publish({ name: "q", version: "1.0.0", optionalDependencies: { "dep-c": "^1.0.0" } });
        app.manifest(manifest(app.tarballUrl));
        await app.run("install");
        expect(app.tree()).toEqual(before);
        return app;
      }

      it("when the download of the optional registry package fails", async () => {
        await using app = await project();
        await app.forget();
        app.failRegistryTarballs();
        app.manifest(manifest("^1.0.0"));
        expect(await app.run("install")).toMatchObject({
          stderr: expect.stringContaining("warn: GET <registry>/dep-c/-/dep-c-1.0.1.tgz - 404"),
          exitCode: 0,
        });
        expect(await app.lockfile()).toContain('"dep-c": ["dep-c@1.0.1", ');
        expect(app.tree()).toEqual(before);
      });

      it("when the install that saves the edit omits optional dependencies", async () => {
        await using app = await project();
        app.manifest(manifest("^1.0.0"));
        expect(await app.run("install", "--omit=optional")).toMatchObject({ exitCode: 0 });
        expect(await app.lockfile()).toContain('"dep-c": ["dep-c@1.0.1", ');
        expect(app.tree()).toEqual(before);
      });
    });

    it.skipIf(isWindows || isRoot)("and the folder it links when node_modules is not writable", async () => {
      await using app = await sourceSwitchProject();
      await app.link();
      app.manifest({ dependencies: { "dep-c": "link:dep-c" } });
      await app.run("install");
      chmodSync(app.path("node_modules"), 0o555);
      try {
        expect(await app.run("add", "dep-c")).toMatchObject({
          stderr: expect.stringContaining("EACCES"),
          exitCode: 1,
        });
      } finally {
        chmodSync(app.path("node_modules"), 0o755);
      }
      expect(app.tree()).toEqual(["dep-c -> link"]);
      expect(await readdirSorted(app.path("linked"))).toEqual(["marker.txt", "package.json"]);
    });
  });

  describe("does not relink", () => {
    // A tarball, a link, a workspace and a registry package, one of them under a dependent.
    it("a slot that keeps its source when other packages are added, removed and updated", async () => {
      await using app = await sourceSwitchProject();
      await app.link();
      await app.publish({ name: "t", version: "1.0.0", dependencies: { "dep-c": app.tarballUrl } });
      const dependencies = { t: "1.0.0", p: "1.0.0", "linked-c": "link:dep-c", "dep-c": "workspace:*" };
      app.manifest({ workspaces: ["packages/*"], dependencies });
      await app.run("install");
      const tree = ["dep-c -> workspace", "linked-c -> link", "p: registry", "t: registry"];
      expect(app.tree()).toEqual([...tree, "t/node_modules/dep-c: tarball"]);
      const copies = ["node_modules/p", "node_modules/t", "node_modules/t/node_modules/dep-c"];
      copies.forEach(app.mark);

      const runs = [await app.run("add", "no-deps"), await app.run("remove", "no-deps"), await app.run("update")];
      expect(runs.map(run => run.out)).toEqual([
        "installed no-deps@1.0.0\n\n1 package installed",
        "- no-deps\n1 package removed",
        "Checked 5 installs across 6 packages (no changes)",
      ]);
      expect(copies.map(app.kept)).toEqual([true, true, true]);
      expect(app.tree()).toEqual([...tree, "t/node_modules/dep-c: tarball"]);
    });

    // bun.lock saves the dependencies of the workspace at the root. They stay where the install linked them.
    it("a slot of a self-contained workspace when the root adds a package", async () => {
      await using app = await sourceSwitchProject();
      await app.publish({ name: "t", version: "1.0.0", dependencies: { "dep-c": app.tarballUrl } });
      app.manifest({ workspaces: { packages: ["apps/*"], selfContained: ["desktop"] } });
      await app.workspace("apps/desktop", { dependencies: { p: "1.0.0", t: "1.0.0" } });
      await app.run("install");
      const tree = ["dep-c: registry", "p: registry", "t: registry", "t/node_modules/dep-c: tarball"];
      expect(app.tree("apps/desktop")).toEqual(tree);
      const copies = ["dep-c", "t/node_modules/dep-c"].map(path => `apps/desktop/node_modules/${path}`);
      copies.forEach(app.mark);

      const out = "installed no-deps@1.0.0\n\n1 package installed";
      expect(await app.run("add", "no-deps")).toMatchObject({ ...relinked, out });
      expect(copies.map(app.kept)).toEqual([true, true]);
      expect(app.tree("apps/desktop")).toEqual(tree);
    });

    it("a slot that keeps its row when bun.lock is deleted", async () => {
      await using app = await sourceSwitchProject();
      app.manifest({ dependencies: { "dep-c": "^1.0.0", p: "1.0.0" } });
      await app.run("install");
      app.mark("node_modules/dep-c");

      await rm(app.path("bun.lock"));
      expect(await app.run("install")).toMatchObject({
        out: "Checked 2 installs across 3 packages (no changes)",
        exitCode: 0,
      });
      expect(app.kept("node_modules/dep-c")).toBe(true);
    });

    // bun.lock is restored to a version without `no-deps`. The loaded lockfile says nothing
    // about that slot, so its directory is judged by name and version, as before.
    it("a slot that has no row in the bun.lock this install loads", async () => {
      await using app = await sourceSwitchProject();
      app.manifest({ dependencies: { "dep-c": app.tarballUrl } });
      await app.run("install");
      const lockfile = await app.lockfile();
      await app.run("add", "no-deps");
      app.mark("node_modules/no-deps");

      await write(app.path("bun.lock"), lockfile);
      app.requests.length = 0;
      expect(await app.run("install")).toMatchObject({ exitCode: 0 });
      expect(app.requests).toEqual([]);
      expect(app.kept("node_modules/no-deps")).toBe(true);
    });

    // `--no-save` links `no-deps@1.0.1` and leaves bun.lock at 1.0.0. Each later install moves the
    // row again and finds the directory it wants there, by name and version.
    it("a registry slot that an install with --no-save already moved to the next version", async () => {
      await using app = await sourceSwitchProject();
      await app.publish({ name: "no-deps", version: "1.0.1" });
      const dependencies = { "dep-c": app.tarballUrl };
      app.manifest({ dependencies: { ...dependencies, "no-deps": "1.0.0" } });
      await app.run("install");
      app.manifest({ dependencies: { ...dependencies, "no-deps": "1.0.1" } });
      expect(await app.run("install", "--no-save")).toMatchObject({ out: "+ no-deps@1.0.1\n\n1 package installed" });
      expect(await app.lockfile()).toContain('"no-deps": ["no-deps@1.0.0", ');
      app.mark("node_modules/no-deps");

      const noChanges = { out: "Checked 2 installs across 3 packages (no changes)", exitCode: 0 };
      expect(await app.run("install", "--no-save")).toMatchObject(noChanges);
      expect(await app.run("install")).toMatchObject(noChanges);
      expect(await app.lockfile()).toContain('"no-deps": ["no-deps@1.0.1", ');
      expect(app.kept("node_modules/no-deps")).toBe(true);
    });
  });
});
