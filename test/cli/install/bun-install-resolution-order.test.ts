// Resolution must not depend on the order registry responses arrive in. A fake
// registry holds each manifest response until the test releases it, so every
// run resolves the same graph under a different completion order — with real
// tarballs downloaded and extracted so their processing interleaves with the
// manifest arrivals. The resulting lockfile must be byte-identical every time.
import { spawn } from "bun";
import { beforeAll, expect, test } from "bun:test";
import { mkdir, rm } from "fs/promises";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

type PackageVersion = { dependencies?: Record<string, string>; peerDependencies?: Record<string, string> };
type Packages = Record<string, Record<string, PackageVersion>>;

// The historically flaky shape: many exact pins of one package plus a ranged
// peer on it. The top-level version depended on which manifests landed first.
const packages: Packages = {
  "a-dep": Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`1.0.${i + 1}`, {} satisfies PackageVersion])),
  "peer-a-dep-caret": { "1.0.0": { peerDependencies: { "a-dep": "^1.0.2" } } },
  ...Object.fromEntries(
    Array.from({ length: 10 }, (_, i) => [
      `uses-a-dep-${i + 1}`,
      { "1.0.0": { dependencies: { "a-dep": `1.0.${i + 1}` } } },
    ]),
  ),
};

const rootDependencies: Record<string, string> = {
  "peer-a-dep-caret": "1.0.0",
  ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`uses-a-dep-${i + 1}`, "1.0.0"])),
};

// name -> version -> packed tarball bytes, built once with `bun pm pack`.
const tarballs = new Map<string, Map<string, Uint8Array>>();
const integrities = new Map<string, string>();

beforeAll(async () => {
  await using dir = tempDir("resolution-order-pack", {});
  for (const [name, versions] of Object.entries(packages)) {
    tarballs.set(name, new Map());
    for (const [version, meta] of Object.entries(versions)) {
      const pkgDir = join(String(dir), `${name}-${version}`);
      await mkdir(pkgDir, { recursive: true });
      await Bun.write(join(pkgDir, "package.json"), JSON.stringify({ name, version, ...meta }, null, 2));
      await using pack = spawn({
        cmd: [bunExe(), "pm", "pack", "--destination", pkgDir],
        cwd: pkgDir,
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [out, , exitCode] = await Promise.all([pack.stdout.text(), pack.stderr.text(), pack.exited]);
      expect(exitCode).toBe(0);
      integrities.set(`${name}@${version}`, out.match(/Integrity[^:]*:\s*(\S+)/)?.[1] ?? "");
      const tgz = new Bun.Glob("*.tgz").scanSync({ cwd: pkgDir }).next().value as string;
      tarballs.get(name)!.set(version, await Bun.file(join(pkgDir, tgz)).bytes());
    }
  }
});

function manifest(name: string, versions: Record<string, PackageVersion>, registryUrl: string) {
  const versionEntries = Object.entries(versions).map(([version, { dependencies, peerDependencies }]) => [
    version,
    {
      name,
      version,
      ...(dependencies ? { dependencies } : {}),
      ...(peerDependencies ? { peerDependencies } : {}),
      dist: {
        tarball: `${registryUrl}/${name}/-/${name}-${version}.tgz`,
        integrity: integrities.get(`${name}@${version}`),
      },
    },
  ]);
  const latest = Object.keys(versions).sort(Bun.semver.order).at(-1)!;
  return { name, "dist-tags": { latest }, versions: Object.fromEntries(versionEntries) };
}

// A registry that parks each manifest request until released, releasing them
// in the given order. A name is released when it is the first name in `order`
// whose request has arrived, so every permutation is a distinct, well-defined
// completion order the resolver observes. Tarball requests are served at
// once so extraction interleaves with the still-held manifests.
function orderedRegistry(order: string[]) {
  const parked = new Map<string, () => void>();
  const responded = new Map<string, Promise<void>>();
  let arrivals = Promise.withResolvers<void>();

  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const path = decodeURIComponent(new URL(req.url).pathname.slice(1));
      const tarball = path.match(/^(.+)\/-\/\1-(\d+\.\d+\.\d+)\.tgz$/);
      if (tarball) {
        const bytes = tarballs.get(tarball[1])?.get(tarball[2]);
        return bytes
          ? new Response(bytes, { headers: { "content-type": "application/octet-stream" } })
          : new Response("not found", { status: 404 });
      }
      const versions = packages[path];
      if (!versions) return new Response("not found", { status: 404 });
      const gate = Promise.withResolvers<void>();
      const done = Promise.withResolvers<void>();
      responded.set(path, done.promise);
      parked.set(path, gate.resolve);
      arrivals.resolve();
      await gate.promise;
      const body = manifest(path, versions, server.url.origin);
      done.resolve();
      return Response.json(body);
    },
  });

  const releaseAll = (async () => {
    const remaining = [...order];
    while (remaining.length) {
      const index = remaining.findIndex(name => parked.has(name));
      if (index === -1) {
        await arrivals.promise;
        arrivals = Promise.withResolvers<void>();
        continue;
      }
      const [name] = remaining.splice(index, 1);
      parked.get(name)!();
      parked.delete(name);
      await responded.get(name);
    }
  })();

  return { server, releaseAll };
}

async function resolveOnce(order: string[]): Promise<string> {
  const { server, releaseAll } = orderedRegistry(order);
  await using dir = tempDir("resolution-order", {
    "package.json": JSON.stringify({ name: "root", version: "0.0.0", dependencies: rootDependencies }),
    "bunfig.toml": `[install]\ncache = "${join("cache").replaceAll("\\", "\\\\")}"\nregistry = "${server.url.origin}/"\n`,
  });
  try {
    await using proc = spawn({
      cmd: [bunExe(), "install", "--ignore-scripts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    await releaseAll;
    expect({ out, err }).toEqual(expect.objectContaining({ err: expect.stringContaining("Saved lockfile") }));
    expect(exitCode).toBe(0);
    // Each run gets its own port; the origin is not part of the outcome.
    return (await Bun.file(join(String(dir), "bun.lock")).text()).replaceAll(server.url.origin, "http://registry");
  } finally {
    server.stop(true);
    await rm(String(dir), { recursive: true, force: true });
  }
}

// Deterministic shuffles so a failure reproduces.
function shuffled(names: string[], seed: number): string[] {
  const copy = [...names];
  let state = seed;
  for (let i = copy.length - 1; i > 0; i--) {
    state = (state * 1103515245 + 12345) >>> 0;
    const j = state % (i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

test("registry response arrival order does not change the resolved lockfile", async () => {
  const names = Object.keys(packages);
  const orders = [names, [...names].reverse(), ...Array.from({ length: 4 }, (_, seed) => shuffled(names, seed + 1))];

  const lockfiles: string[] = [];
  for (const order of orders) {
    lockfiles.push(await resolveOnce(order));
  }

  // The best version satisfying the ranged peer wins the top level; the pins
  // nest. Which manifest landed first must not decide it.
  expect(lockfiles[0]).toContain(`"a-dep": ["a-dep@1.0.10"`);
  expect(lockfiles).toEqual(Array(orders.length).fill(lockfiles[0]));
});
