// https://github.com/oven-sh/bun/issues/36577
//
// `bun install --frozen-lockfile` rejected a lockfile that `bun install` had just
// written. The frozen check (`Lockfile::eql`) sorts hoisted placements by
// (tree path, package name) only, but npm: aliases can put several packages with
// the same real name into the same tree node. Those entries tie, and the unstable
// sort paired them differently between the freshly loaded lockfile and the
// re-hoisted one (whose optional-peer slots are re-derived in a different walk
// order), so identical trees compared as different.
//
// The graph below recreates that shape: a package name (`lib`) placed at the root
// three times via two npm: aliases plus a direct dependency, a satisfied optional
// peer (`carrier` -> `pdep`, held by `zz-late`) whose subtree is enqueued at a
// different time on the two sides, and enough filler packages that the sort does
// not fall back to a stable insertion sort.
import { expect, test } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { tmpdir } from "os";
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

async function serveGraph(pkgs: Graph) {
  const tarballs = new Map<string, Uint8Array>();
  const makeTarball = async (name: string, version: string) => {
    const key = `${name}@${version}`;
    const cached = tarballs.get(key);
    if (cached) return cached;
    const spec = pkgs[name][version];
    const pkgJson: any = { name, version };
    if (spec.dependencies) pkgJson.dependencies = spec.dependencies;
    if (spec.peerDependencies) {
      pkgJson.peerDependencies = spec.peerDependencies;
      if (spec.optionalPeers?.length) {
        pkgJson.peerDependenciesMeta = Object.fromEntries(spec.optionalPeers.map(p => [p, { optional: true }]));
      }
    }
    const tmp = join(tmpdir(), `i36577-${name}-${version}.tgz`);
    await Bun.Archive.write(tmp, { "package/package.json": JSON.stringify(pkgJson) }, { compress: "gzip" });
    const bytes = new Uint8Array(await Bun.file(tmp).arrayBuffer());
    rmSync(tmp, { force: true });
    tarballs.set(key, bytes);
    return bytes;
  };

  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const path = decodeURIComponent(new URL(req.url).pathname).replace(/^\//, "");
      const tbMatch = path.match(/^(.+)\/-\/.+-(\d[^/]*)\.tgz$/);
      if (tbMatch) {
        const [, name, version] = tbMatch;
        if (!pkgs[name]?.[version]) return new Response("not found", { status: 404 });
        return new Response((await makeTarball(name, version)) as any);
      }
      const versions = pkgs[path];
      if (!versions) return new Response("not found", { status: 404 });
      const out: any = { name: path, versions: {}, "dist-tags": {} };
      let latest = "";
      for (const [version, spec] of Object.entries(versions)) {
        const tb = await makeTarball(path, version);
        const sha512 = new Bun.CryptoHasher("sha512").update(tb).digest();
        const sha1 = new Bun.CryptoHasher("sha1").update(tb).digest();
        const v: any = { name: path, version };
        if (spec.dependencies) v.dependencies = spec.dependencies;
        if (spec.peerDependencies) {
          v.peerDependencies = spec.peerDependencies;
          if (spec.optionalPeers?.length) {
            v.peerDependenciesMeta = Object.fromEntries(spec.optionalPeers.map(p => [p, { optional: true }]));
          }
        }
        v.dist = {
          tarball: `http://localhost:${server.port}/${path}/-/${path}-${version}.tgz`,
          integrity: `sha512-${Buffer.from(sha512).toString("base64")}`,
          shasum: Buffer.from(sha1).toString("hex"),
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
    await using server = await serveGraph(pkgs);

    using dir = tempDir(`i36577-${fillerCount}`, {
      "package.json": JSON.stringify({ name: "root", version: "1.0.0", dependencies: root }),
      "bunfig.toml": `[install]\ncache = "cache"\nregistry = "http://localhost:${server.port}/"\nsaveTextLockfile = true\n`,
    });
    mkdirSync(join(String(dir), "cache"), { recursive: true });

    const run = async (args: string[]) => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), ...args],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [out, err, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { out, err, code };
    };

    let r = await run(["install"]);
    expect(r.err).not.toContain("error:");
    expect(r.code).toBe(0);

    r = await run(["install", "--frozen-lockfile"]);
    expect(r.err).not.toContain("lockfile had changes");
    expect(r.code).toBe(0);
  });
}
