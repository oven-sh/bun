// https://github.com/oven-sh/bun/issues/36577
//
// The graph recreates the shape the frozen-lockfile comparison mis-paired: a
// package name (`lib`) placed at the root three times via two npm: aliases plus
// a direct dependency, a satisfied optional peer (`carrier` -> `pdep`, held by
// `zz-late`) whose subtree is enqueued at a different time when the tree is
// rebuilt from the lockfile, and enough filler packages that the comparison's
// sort does not fall back to a stable insertion sort.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

type Ver = {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalPeers?: string[];
};
type Graph = Record<string, Record<string, Ver>>;

function makeGraph(fillerCount: number, shiftPrefix: string): { pkgs: Graph; root: Record<string, string> } {
  const pkgs: Graph = {
    lib: { "1.0.0": {}, "2.0.0": {}, "3.0.0": {} },
    carrier: { "1.0.0": { peerDependencies: { pdep: "*" }, optionalPeers: ["pdep"] } },
    pdep: { "1.0.0": { dependencies: { [`${shiftPrefix}one`]: "1.0.0", [`${shiftPrefix}two`]: "1.0.0" } } },
    [`${shiftPrefix}one`]: { "1.0.0": {} },
    [`${shiftPrefix}two`]: { "1.0.0": {} },
    "zz-late": { "1.0.0": { dependencies: { pdep: "1.0.0" } } },
  };
  const root: Record<string, string> = {
    carrier: "1.0.0",
    lib: "3.0.0",
    pv1: "npm:lib@1.0.0",
    pv2: "npm:lib@2.0.0",
    "zz-late": "1.0.0",
  };
  for (let i = 0; i < fillerCount; i++) {
    const f = `f${String(i).padStart(3, "0")}`;
    pkgs[f] = { "1.0.0": { dependencies: { [`${f}-d`]: "1.0.0" } } };
    pkgs[`${f}-d`] = { "1.0.0": { dependencies: { [`${f}-g`]: "1.0.0" } } };
    pkgs[`${f}-g`] = { "1.0.0": {} };
    root[f] = "1.0.0";
  }
  return { pkgs, root };
}

function serveGraph(pkgs: Graph) {
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const path = decodeURIComponent(new URL(req.url).pathname).replace(/^\//, "");
      const versions = pkgs[path];
      if (!versions) return new Response("not found", { status: 404 });
      const out: any = { name: path, versions: {}, "dist-tags": {} };
      let latest = "";
      for (const [version, spec] of Object.entries(versions)) {
        const v: any = { name: path, version };
        if (spec.dependencies) v.dependencies = spec.dependencies;
        if (spec.peerDependencies) {
          v.peerDependencies = spec.peerDependencies;
          if (spec.optionalPeers?.length) {
            v.peerDependenciesMeta = Object.fromEntries(spec.optionalPeers.map(p => [p, { optional: true }]));
          }
        }
        // The installs below are --lockfile-only, so no tarball is ever
        // fetched and integrity is never verified; the Lockfile::eql
        // comparison under test uses (tree path, name, resolution version).
        const sha512 = new Bun.CryptoHasher("sha512").update(`${path}@${version}`).digest("base64");
        v.dist = {
          tarball: `http://localhost:${server.port}/${path}/-/${path}-${version}.tgz`,
          integrity: `sha512-${sha512}`,
        };
        out.versions[version] = v;
        latest = version;
      }
      out["dist-tags"].latest = latest;
      return Response.json(out);
    },
  });
  return server;
}

// Two filler counts so the repro does not hinge on a single sort-partition layout.
for (const [fillerCount, shiftPrefix] of [
  [24, "aa-s"],
  [32, "libx"],
] as const) {
  test.concurrent(`frozen lockfile accepts a freshly generated lockfile (${fillerCount} fillers)`, async () => {
    const { pkgs, root } = makeGraph(fillerCount, shiftPrefix);
    await using server = serveGraph(pkgs);

    using dir = tempDir(`i36577-${fillerCount}`, {
      "package.json": JSON.stringify({ name: "root", version: "1.0.0", dependencies: root }),
      "bunfig.toml": `[install]\nregistry = "http://localhost:${server.port}/"\nsaveTextLockfile = true\n`,
    });
    // The two concurrent cases install overlapping package names, so each
    // needs its own cache. BUN_INSTALL_CACHE_DIR (set by the CI runner)
    // takes precedence over bunfig [install].cache, so override it here.
    const env = { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(String(dir), ".bun-cache") };

    const run = async (args: string[]) => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), ...args],
        cwd: String(dir),
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [out, err, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { out, err, code };
    };

    let r = await run(["install", "--lockfile-only"]);
    expect(r.err).not.toContain("error:");
    expect(r.code).toBe(0);

    r = await run(["install", "--frozen-lockfile", "--lockfile-only"]);
    expect(r.err).not.toContain("lockfile had changes");
    expect(r.code).toBe(0);
  });
}
