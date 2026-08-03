// Deterministic resolution: the resolved tree must not depend on the order the
// registry's responses arrive in. A fake registry parks each manifest response
// and releases them in a controlled order, with real tarballs downloaded and
// extracted so their processing interleaves with the manifests still held.
//
// Each scenario is a specific edge case with the exact resolution it must
// produce, and every scenario also runs under several release orders,
// asserting the lockfile is byte-identical across all of them.
import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// ──────────────────────────────────────────────────────────────────────────
// Registry model
// ──────────────────────────────────────────────────────────────────────────

type VersionMeta = {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  optionalDependencies?: Record<string, string>;
};
type PackageSpec = { versions: Record<string, VersionMeta>; distTags?: Record<string, string> };
type RegistrySpec = Record<string, PackageSpec>;

/** Shorthand: `pkg({ "1.0.0": {...} })` or `pkg("1.0.0", "1.1.0")` for dep-less versions. */
function pkg(versions: Record<string, VersionMeta> | string[], distTags?: Record<string, string>): PackageSpec {
  const spec = Array.isArray(versions) ? Object.fromEntries(versions.map(v => [v, {} as VersionMeta])) : versions;
  return { versions: spec, ...(distTags ? { distTags } : {}) };
}

// Tarballs are `bun pm pack` output, built on demand and cached by content so
// the same package.json is only packed once across the whole suite.
const tarballCache = new Map<string, { bytes: Uint8Array; integrity: string }>();

async function tarballFor(name: string, version: string, meta: VersionMeta) {
  const manifest = JSON.stringify({ name, version, ...meta });
  const cached = tarballCache.get(manifest);
  if (cached) return cached;
  await using dir = tempDir("resolution-order-pack", { "package.json": manifest });
  await using pack = spawn({
    cmd: [bunExe(), "pm", "pack", "--destination", String(dir)],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, exitCode] = await Promise.all([pack.stdout.text(), pack.stderr.text(), pack.exited]);
  if (exitCode !== 0) throw new Error(`pack failed for ${name}@${version}: ${err}`);
  const tgz = new Bun.Glob("*.tgz").scanSync({ cwd: String(dir) }).next().value as string;
  const entry = {
    bytes: await Bun.file(join(String(dir), tgz)).bytes(),
    integrity: out.match(/Integrity[^:]*:\s*(\S+)/)?.[1] ?? "",
  };
  tarballCache.set(manifest, entry);
  return entry;
}

async function ensureTarballs(registry: RegistrySpec) {
  for (const [name, spec] of Object.entries(registry)) {
    for (const [version, meta] of Object.entries(spec.versions)) {
      await tarballFor(name, version, meta);
    }
  }
}

async function manifestJson(name: string, spec: PackageSpec, origin: string) {
  const versions: Record<string, unknown> = {};
  for (const [version, meta] of Object.entries(spec.versions)) {
    const { integrity } = await tarballFor(name, version, meta);
    versions[version] = {
      name,
      version,
      ...meta,
      dist: { tarball: `${origin}/${name}/-/${name}-${version}.tgz`, integrity },
    };
  }
  const latest = Object.keys(spec.versions).sort(Bun.semver.order).at(-1)!;
  return { name, "dist-tags": { latest, ...(spec.distTags ?? {}) }, versions };
}

// A registry that parks each manifest until released, releasing them in the
// given order: a name is released when it is the first name in `order` whose
// request has arrived, so every permutation is a distinct, well-defined
// completion order the resolver observes. Tarballs are served immediately so
// extraction interleaves with the manifests still held.
function orderedRegistry(registry: RegistrySpec, order: string[]) {
  const parked = new Map<string, () => void>();
  const responded = new Map<string, Promise<void>>();
  const requested = new Set<string>();
  let arrivals = Promise.withResolvers<void>();
  let stopped = false;

  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const path = decodeURIComponent(new URL(req.url).pathname.slice(1));
      const tarball = path.match(/^(.+)\/-\/(?:@[^/]+\/)?[^/]+-(\d+\.\d+\.\d+[^/]*)\.tgz$/);
      if (tarball) {
        const [, name, version] = tarball;
        const meta = registry[name]?.versions[version];
        if (!meta) return new Response("not found", { status: 404 });
        const { bytes } = await tarballFor(name, version, meta);
        return new Response(bytes, { headers: { "content-type": "application/octet-stream" } });
      }
      requested.add(path);
      const spec = registry[path];
      if (!spec) return new Response("not found", { status: 404 });
      // Only names in the release order are held; everything else answers at once.
      if (order.includes(path) && !stopped) {
        const gate = Promise.withResolvers<void>();
        const done = Promise.withResolvers<void>();
        responded.set(path, done.promise);
        parked.set(path, gate.resolve);
        arrivals.resolve();
        await gate.promise;
        const body = await manifestJson(path, spec, server.url.origin);
        done.resolve();
        return Response.json(body);
      }
      return Response.json(await manifestJson(path, spec, server.url.origin));
    },
  });

  // Names in `order` that are never requested (already cached, resolved
  // locally, or shadowed) must not stall the loop: `stop()` ends it.
  const releaseAll = (async () => {
    const remaining = order.filter(name => name in registry);
    while (remaining.length && !stopped) {
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
    // Names outside `order` (or requested again later) are never held.
    for (const [, release] of parked) release();
  })();

  const stop = async () => {
    stopped = true;
    arrivals.resolve();
    for (const [, release] of parked) release();
    server.stop(true);
    await releaseAll.catch(() => {});
  };

  return { server, requested, stop };
}

// ──────────────────────────────────────────────────────────────────────────
// Project runner
// ──────────────────────────────────────────────────────────────────────────

type LockPackages = Record<string, string>; // path -> "name@version"

/** bun.lock is JSONC: strip trailing commas, then parse. */
function parseLockfile(text: string): { packages: Record<string, unknown[]>; workspaces: Record<string, any> } {
  return JSON.parse(text.replace(/,(\s*[}\]])/g, "$1"));
}

/** Every resolved package as `path -> name@version`, path being the tree location. */
function resolvedVersions(lockfileText: string): LockPackages {
  const { packages } = parseLockfile(lockfileText);
  return Object.fromEntries(Object.entries(packages).map(([path, entry]) => [path, String(entry[0])]));
}

type RunResult = {
  lockfile: string;
  versions: LockPackages;
  out: string;
  err: string;
  exitCode: number;
  requested: Set<string>;
};

async function runInstall(
  dir: string,
  registry: RegistrySpec,
  order: string[],
  args: string[] = [],
): Promise<RunResult> {
  const { server, requested, stop } = orderedRegistry(registry, order);
  try {
    await Bun.write(
      join(dir, "bunfig.toml"),
      `[install]\ncache = "${join(dir, ".cache").replaceAll("\\", "\\\\")}"\nregistry = "${server.url.origin}/"\n`,
    );
    await using proc = spawn({
      cmd: [bunExe(), "install", "--ignore-scripts", ...args],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const lockText = await Bun.file(join(dir, "bun.lock")).text();
    // Each run gets its own port; the origin is not part of the outcome.
    const lockfile = lockText.replaceAll(server.url.origin, "http://registry");
    return { lockfile, versions: resolvedVersions(lockfile), out, err, exitCode, requested };
  } finally {
    await stop();
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

function releaseOrders(names: string[]): string[][] {
  return [names, [...names].reverse(), shuffled(names, 7)];
}

/**
 * Run one project under every release order. Asserts each install succeeds and
 * that every order produced the byte-identical lockfile, then returns the
 * (identical) result for scenario-specific expectations.
 */
async function resolveUnderOrders(
  files: Record<string, string>,
  registry: RegistrySpec,
  args: string[] = [],
): Promise<RunResult> {
  await ensureTarballs(registry);
  const results: RunResult[] = [];
  for (const order of releaseOrders(Object.keys(registry))) {
    await using dir = tempDir("resolution-order", files);
    const result = await runInstall(String(dir), registry, order, args);
    expect({ order, err: result.err }).toEqual({ order, err: expect.stringContaining("Saved lockfile") });
    expect({ order, exitCode: result.exitCode }).toEqual({ order, exitCode: 0 });
    results.push(result);
  }
  expect(results.map(r => r.lockfile)).toEqual(Array(results.length).fill(results[0].lockfile));
  return results[0];
}

const project = (deps: Record<string, unknown>) =>
  ({ "package.json": JSON.stringify({ name: "root", version: "0.0.0", ...deps }) }) as Record<string, string>;

// Every scenario runs several full installs (one per release order), so the
// default per-test budget does not fit; give each an explicit ceiling.
const SCENARIO_TIMEOUT = 60_000;
const scenario = (name: string, fn: () => Promise<void>) => test(name, fn, SCENARIO_TIMEOUT);

// ──────────────────────────────────────────────────────────────────────────
// Peers
// ──────────────────────────────────────────────────────────────────────────

describe.concurrent("peers", () => {
  // Ten packages each pin a-dep exactly; one peers `a-dep ^1.0.2`. The best
  // satisfying version wins the top level and the pins nest — which manifest
  // landed first must not decide it.
  scenario("a ranged peer takes the best version at top level; exact pins nest", async () => {
    const registry: RegistrySpec = {
      "a-dep": pkg(Array.from({ length: 10 }, (_, i) => `1.0.${i + 1}`)),
      "peer-a-dep": pkg({ "1.0.0": { peerDependencies: { "a-dep": "^1.0.2" } } }),
      ...Object.fromEntries(
        Array.from({ length: 10 }, (_, i) => [
          `uses-a-dep-${i + 1}`,
          pkg({ "1.0.0": { dependencies: { "a-dep": `1.0.${i + 1}` } } }),
        ]),
      ),
    };
    const { versions } = await resolveUnderOrders(
      project({
        dependencies: {
          "peer-a-dep": "1.0.0",
          ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`uses-a-dep-${i + 1}`, "1.0.0"])),
        },
      }),
      registry,
    );
    expect(versions["a-dep"]).toBe("a-dep@1.0.10");
    // 1.0.10's own pin shares the top level; every other pin gets its own copy.
    expect(versions["uses-a-dep-10/a-dep"]).toBeUndefined();
    for (let i = 1; i <= 9; i++) {
      expect(versions[`uses-a-dep-${i}/a-dep`]).toBe(`a-dep@1.0.${i}`);
    }
  });

  // A peer already provided in the parent scope binds to that copy: no second
  // install, no warning.
  scenario("a peer satisfied by the parent scope binds without another copy or a warning", async () => {
    const registry: RegistrySpec = {
      provider: pkg(["1.2.0", "1.9.0"]),
      plugin: pkg({ "1.0.0": { peerDependencies: { provider: "^1.0.0" } } }),
    };
    const { versions, err } = await resolveUnderOrders(
      project({ dependencies: { provider: "1.2.0", plugin: "1.0.0" } }),
      registry,
    );
    expect(versions).toEqual({ provider: "provider@1.2.0", plugin: "plugin@1.0.0" });
    expect(err).not.toContain("incorrect peer dependency");
  });

  // A peer whose parent scope holds a same-named package that does not
  // satisfy binds to it anyway, with a warning — never a second copy.
  scenario("a peer conflicting with the parent scope binds to it with a warning", async () => {
    const registry: RegistrySpec = {
      react: pkg(["17.0.2", "18.2.0"]),
      widget: pkg({ "1.0.0": { peerDependencies: { react: ">=18" } } }),
    };
    const { versions, err } = await resolveUnderOrders(
      project({ dependencies: { react: "17.0.2", widget: "1.0.0" } }),
      registry,
    );
    expect(versions).toEqual({ react: "react@17.0.2", widget: "widget@1.0.0" });
    expect(err).toContain("incorrect peer dependency");
    expect(err).toContain("react@17.0.2");
  });

  // With no provider anywhere, a required peer is auto-installed at the
  // manifest's best satisfying version and shared at the top level.
  scenario("a peer with no provider is auto-installed at the top level", async () => {
    const registry: RegistrySpec = {
      provider: pkg(["1.0.0", "2.3.4", "3.0.0"]),
      plugin: pkg({ "1.0.0": { peerDependencies: { provider: "^2.0.0" } } }),
    };
    const { versions, err } = await resolveUnderOrders(project({ dependencies: { plugin: "1.0.0" } }), registry);
    expect(versions).toEqual({ plugin: "plugin@1.0.0", provider: "provider@2.3.4" });
    expect(err).not.toContain("incorrect peer dependency");
  });

  // A peer that no published version satisfies stays quietly unresolved: the
  // install succeeds and nothing is installed for it.
  scenario("a peer no version satisfies is left unresolved without failing", async () => {
    const registry: RegistrySpec = {
      provider: pkg(["1.0.0", "1.1.0"]),
      plugin: pkg({ "1.0.0": { peerDependencies: { provider: ">=9.0.0" } } }),
    };
    const { versions } = await resolveUnderOrders(project({ dependencies: { plugin: "1.0.0" } }), registry);
    expect(versions).toEqual({ plugin: "plugin@1.0.0" });
  });

  // Several packages peer the same provider that the root already declares:
  // all bind to the one root copy — no warnings, no extra installs.
  scenario("many peers of one provided package all bind to the single copy", async () => {
    const registry: RegistrySpec = {
      provider: pkg(["4.0.0"]),
      p1: pkg({ "1.0.0": { peerDependencies: { provider: "^4" } } }),
      p2: pkg({ "1.0.0": { peerDependencies: { provider: ">=3" } } }),
      p3: pkg({ "1.0.0": { peerDependencies: { provider: "*" } } }),
    };
    const { versions, err } = await resolveUnderOrders(
      project({ dependencies: { provider: "4.0.0", p1: "1.0.0", p2: "1.0.0", p3: "1.0.0" } }),
      registry,
    );
    expect(versions).toEqual({
      provider: "provider@4.0.0",
      p1: "p1@1.0.0",
      p2: "p2@1.0.0",
      p3: "p3@1.0.0",
    });
    expect(err).not.toContain("incorrect peer dependency");
  });

  // A peer chain: A peers B, B peers C. The root provides only C, so B is
  // auto-installed and B's own peer C binds to the root's copy.
  scenario("a peer's own peers resolve against the scope it was placed in", async () => {
    const registry: RegistrySpec = {
      c: pkg(["1.0.0"]),
      b: pkg({ "2.0.0": { peerDependencies: { c: "^1.0.0" } } }),
      a: pkg({ "1.0.0": { peerDependencies: { b: "^2.0.0" } } }),
    };
    const { versions, err } = await resolveUnderOrders(project({ dependencies: { a: "1.0.0", c: "1.0.0" } }), registry);
    expect(versions).toEqual({ a: "a@1.0.0", b: "b@2.0.0", c: "c@1.0.0" });
    expect(err).not.toContain("incorrect peer dependency");
  });

  // A dist-tag peer whose parent scope holds the tagged version binds silently.
  scenario("a dist-tag peer already satisfied by the parent scope does not warn", async () => {
    const registry: RegistrySpec = {
      tool: pkg(["5.0.0", "5.6.2"], { latest: "5.6.2" }),
      user: pkg({ "1.0.0": { peerDependencies: { tool: "latest" } } }),
    };
    const { versions, err } = await resolveUnderOrders(
      project({ dependencies: { tool: "5.6.2", user: "1.0.0" } }),
      registry,
    );
    expect(versions).toEqual({ tool: "tool@5.6.2", user: "user@1.0.0" });
    expect(err).not.toContain("incorrect peer dependency");
  });

  // A dist-tag peer whose parent scope holds a different version binds to it
  // with a warning rather than installing the tagged version as a second copy.
  scenario("a dist-tag peer conflicting with the parent scope warns and binds, not duplicates", async () => {
    const registry: RegistrySpec = {
      tool: pkg(["5.0.0", "5.6.2"], { latest: "5.6.2" }),
      user: pkg({ "1.0.0": { peerDependencies: { tool: "latest" } } }),
    };
    const { versions, err } = await resolveUnderOrders(
      project({ dependencies: { tool: "5.0.0", user: "1.0.0" } }),
      registry,
    );
    expect(versions).toEqual({ tool: "tool@5.0.0", user: "user@1.0.0" });
    expect(err).toContain("incorrect peer dependency");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Hoisting and conflicts
// ──────────────────────────────────────────────────────────────────────────

describe.concurrent("hoisting", () => {
  // Two dependencies need different majors of one package. The first in the
  // cursor's fixed order (name-ascending) claims the top level; the second
  // nests under its dependent — a stable rule, never an arrival race.
  scenario("conflicting ranges: cursor order, not arrival order, decides the top level", async () => {
    const registry: RegistrySpec = {
      shared: pkg(["3.5.0", "4.2.0"]),
      alpha: pkg({ "1.0.0": { dependencies: { shared: "^3.0.0" } } }),
      beta: pkg({ "1.0.0": { dependencies: { shared: "^4.0.0" } } }),
    };
    const { versions } = await resolveUnderOrders(
      project({ dependencies: { beta: "1.0.0", alpha: "1.0.0" } }),
      registry,
    );
    // `alpha` sorts before `beta`, so alpha's ^3 range claims node_modules/shared.
    expect(versions).toEqual({
      alpha: "alpha@1.0.0",
      beta: "beta@1.0.0",
      shared: "shared@3.5.0",
      "beta/shared": "shared@4.2.0",
    });
  });

  // A diamond: both sides accept the same version, so one copy is shared.
  scenario("a diamond whose ranges overlap shares one copy", async () => {
    const registry: RegistrySpec = {
      shared: pkg(["1.2.0", "1.9.0", "2.0.0"]),
      left: pkg({ "1.0.0": { dependencies: { shared: "^1.2.0" } } }),
      right: pkg({ "1.0.0": { dependencies: { shared: "1.x" } } }),
    };
    const { versions } = await resolveUnderOrders(
      project({ dependencies: { left: "1.0.0", right: "1.0.0" } }),
      registry,
    );
    expect(versions).toEqual({ left: "left@1.0.0", right: "right@1.0.0", shared: "shared@1.9.0" });
  });

  // `inner` is not shadowed at the root, so it hoists to the top level; its
  // dependency conflicting with the root's copy then nests at the highest
  // free scope below the conflict — inner's own node_modules — matching the
  // npm/yarn layout.
  scenario("a deep conflict nests at the highest free scope below it", async () => {
    const registry: RegistrySpec = {
      shared: pkg(["1.0.0", "2.0.0"]),
      inner: pkg({ "1.0.0": { dependencies: { shared: "^2.0.0" } } }),
      outer: pkg({ "1.0.0": { dependencies: { inner: "1.0.0" } } }),
    };
    const { versions } = await resolveUnderOrders(
      project({ dependencies: { shared: "1.0.0", outer: "1.0.0" } }),
      registry,
    );
    expect(versions).toEqual({
      shared: "shared@1.0.0",
      outer: "outer@1.0.0",
      inner: "inner@1.0.0",
      "inner/shared": "shared@2.0.0",
    });
  });

  // An exact edge and a range edge that its version satisfies collapse onto
  // one package.
  scenario("an exact edge and a range it satisfies dedupe to one package", async () => {
    const registry: RegistrySpec = {
      shared: pkg(["1.2.3", "1.2.9"]),
      exact: pkg({ "1.0.0": { dependencies: { shared: "1.2.3" } } }),
      ranged: pkg({ "1.0.0": { dependencies: { shared: "^1.2.0" } } }),
    };
    const { versions } = await resolveUnderOrders(
      project({ dependencies: { exact: "1.0.0", ranged: "1.0.0" } }),
      registry,
    );
    // `exact` sorts before `ranged`: 1.2.3 claims the top level and satisfies ^1.2.0.
    expect(versions).toEqual({ exact: "exact@1.0.0", ranged: "ranged@1.0.0", shared: "shared@1.2.3" });
  });

  // A package that satisfies its own dependency (self-cycle) resolves to a
  // single copy.
  scenario("a package depending on itself resolves to one copy", async () => {
    const registry: RegistrySpec = {
      loops: pkg({ "1.0.0": { dependencies: { loops: "^1.0.0" } } }),
    };
    const { versions } = await resolveUnderOrders(project({ dependencies: { loops: "1.0.0" } }), registry);
    expect(versions).toEqual({ loops: "loops@1.0.0" });
  });

  // A cross-version cycle (a@1 needs a@2 needs a@1) no layout can satisfy:
  // it must terminate with a bounded tree, not nest forever. Resolution
  // completes with both packages; the hoister (`Tree::process_subtree` ->
  // `hoist_dependency`) then re-walks the cycle forever. That loop predates
  // this suite and reproduces on released builds, so the scenario stays
  // recorded but disabled until the tree builder is fixed.
  test.todo("a version-conflict cycle terminates instead of nesting forever", async () => {
    const registry: RegistrySpec = {
      knot: pkg({
        "1.0.0": { dependencies: { knot: "2.0.0" } },
        "2.0.0": { dependencies: { knot: "1.0.0" } },
      }),
    };
    const { versions } = await resolveUnderOrders(project({ dependencies: { knot: "1.0.0" } }), registry);
    expect(versions["knot"]).toBe("knot@1.0.0");
    expect(versions["knot/knot"]).toBe("knot@2.0.0");
    // The cycle closes there: no third level.
    expect(versions["knot/knot/knot"]).toBeUndefined();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// dist-tags and aliases
// ──────────────────────────────────────────────────────────────────────────

describe.concurrent("dist-tags and aliases", () => {
  // A dist-tag names one version; a range edge it satisfies shares the copy.
  scenario("a dist-tag edge and a satisfied range share one copy", async () => {
    const registry: RegistrySpec = {
      shared: pkg(["1.0.0", "2.4.0"], { latest: "2.4.0" }),
      "wants-range": pkg({ "1.0.0": { dependencies: { shared: "^2.0.0" } } }),
    };
    const { versions } = await resolveUnderOrders(
      project({ dependencies: { shared: "latest", "wants-range": "1.0.0" } }),
      registry,
    );
    expect(versions).toEqual({ shared: "shared@2.4.0", "wants-range": "wants-range@1.0.0" });
  });

  // A root npm alias occupies node_modules/<alias>. A same-named dependency
  // elsewhere in the tree whose range the alias target's version satisfies
  // binds to the alias — and the shadowed name is never requested.
  scenario("a root npm alias satisfies a same-named transitive dependency and shadows its name", async () => {
    const registry: RegistrySpec = {
      target: pkg(["0.0.5", "1.0.0"]),
      consumer: pkg({ "1.0.0": { dependencies: { shadowed: ">=0.0.3" } } }),
      // Deliberately absent from the registry: requesting it would 404.
    };
    const { versions, requested } = await resolveUnderOrders(
      project({ dependencies: { shadowed: "npm:target@0.0.5", consumer: "1.0.0" } }),
      registry,
    );
    expect(versions).toEqual({ shadowed: "target@0.0.5", consumer: "consumer@1.0.0" });
    expect(requested.has("shadowed")).toBeFalse();
  });

  // When the alias target's version does not satisfy the same-named
  // dependency's range, the dependency resolves its own real package and
  // nests below the alias — it never binds past it.
  scenario("an npm alias whose version does not satisfy leaves the real package to nest", async () => {
    const registry: RegistrySpec = {
      target: pkg(["0.0.5"]),
      real: pkg(["3.0.0"]),
      consumer: pkg({ "1.0.0": { dependencies: { real: "^3.0.0" } } }),
    };
    const { versions } = await resolveUnderOrders(
      project({ dependencies: { real: "npm:target@0.0.5", consumer: "1.0.0" } }),
      registry,
    );
    expect(versions).toEqual({
      real: "target@0.0.5",
      consumer: "consumer@1.0.0",
      "consumer/real": "real@3.0.0",
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Workspaces and catalogs
// ──────────────────────────────────────────────────────────────────────────

describe.concurrent("workspaces", () => {
  // Two workspaces need different majors of a package. Workspaces are decided
  // in name order, so the first claims the top level and the second nests
  // under itself — stable regardless of arrival.
  scenario("workspaces with conflicting ranges resolve in workspace-name order", async () => {
    const registry: RegistrySpec = { shared: pkg(["1.4.0", "2.6.0"]) };
    const files = {
      "package.json": JSON.stringify({ name: "root", version: "0.0.0", workspaces: ["packages/*"] }),
      "packages/api/package.json": JSON.stringify({
        name: "api",
        version: "1.0.0",
        dependencies: { shared: "^1.0.0" },
      }),
      "packages/web/package.json": JSON.stringify({
        name: "web",
        version: "1.0.0",
        dependencies: { shared: "^2.0.0" },
      }),
    };
    const { versions } = await resolveUnderOrders(files, registry);
    expect(versions["shared"]).toBe("shared@1.4.0");
    expect(versions["web/shared"]).toBe("shared@2.6.0");
    expect(versions["api"]).toBe("api@workspace:packages/api");
    expect(versions["web"]).toBe("web@workspace:packages/web");
  });

  // A root npm alias satisfies a workspace's same-named plain dependency
  // when its version fits, so only the alias is installed and the shadowed
  // name is never requested.
  scenario("a root npm alias satisfies a workspace's same-named dependency", async () => {
    const registry: RegistrySpec = { target: pkg(["0.0.5"]) };
    const files = {
      "package.json": JSON.stringify({
        name: "root",
        version: "0.0.0",
        workspaces: ["packages/*"],
        dependencies: { shadowed: "npm:target@0.0.5" },
      }),
      "packages/app/package.json": JSON.stringify({
        name: "app",
        version: "1.0.0",
        dependencies: { shadowed: ">=0.0.3" },
      }),
    };
    const { versions, requested } = await resolveUnderOrders(files, registry);
    expect(versions["shadowed"]).toBe("target@0.0.5");
    expect(versions["app/shadowed"]).toBeUndefined();
    expect(requested.has("shadowed")).toBe(false);
  });

  // A `workspace:` reference resolves to the local package even when the
  // registry publishes the same name.
  scenario("a workspace protocol dependency resolves locally, not from the registry", async () => {
    const registry: RegistrySpec = { core: pkg(["9.9.9"]) };
    const files = {
      "package.json": JSON.stringify({ name: "root", version: "0.0.0", workspaces: ["packages/*"] }),
      "packages/core/package.json": JSON.stringify({ name: "core", version: "1.0.0" }),
      "packages/app/package.json": JSON.stringify({
        name: "app",
        version: "1.0.0",
        dependencies: { core: "workspace:*" },
      }),
    };
    const { versions, requested } = await resolveUnderOrders(files, registry);
    expect(versions["core"]).toBe("core@workspace:packages/core");
    expect(versions["app"]).toBe("app@workspace:packages/app");
    expect(requested.has("core")).toBe(false);
  });

  // A catalog names one version for the whole workspace: every catalog
  // reference resolves to it, one shared copy.
  scenario("catalog references across workspaces resolve to one shared version", async () => {
    const registry: RegistrySpec = { shared: pkg(["1.0.0", "1.5.0", "2.0.0"]) };
    const files = {
      "package.json": JSON.stringify({
        name: "root",
        version: "0.0.0",
        workspaces: ["packages/*"],
        catalog: { shared: "^1.0.0" },
      }),
      "packages/a/package.json": JSON.stringify({ name: "a", version: "1.0.0", dependencies: { shared: "catalog:" } }),
      "packages/b/package.json": JSON.stringify({ name: "b", version: "1.0.0", dependencies: { shared: "catalog:" } }),
    };
    const { versions } = await resolveUnderOrders(files, registry);
    expect(versions["shared"]).toBe("shared@1.5.0");
    expect(versions["a/shared"]).toBeUndefined();
    expect(versions["b/shared"]).toBeUndefined();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Lockfile fidelity across commands
// ──────────────────────────────────────────────────────────────────────────

describe.concurrent("lockfile fidelity", () => {
  // An in-sync install decides nothing: the lockfile is byte-identical and
  // no changes are reported. Both installs use one registry, as a real
  // reinstall does, so the recorded URLs are directly comparable.
  scenario("reinstalling with nothing changed leaves the lockfile byte-identical", async () => {
    const registry: RegistrySpec = {
      shared: pkg(["1.0.0", "1.1.0"]),
      user: pkg({ "1.0.0": { dependencies: { shared: "^1.0.0" } } }),
    };
    await ensureTarballs(registry);
    await using dir = tempDir("resolution-order", project({ dependencies: { user: "1.0.0" } }));
    const { server, stop } = orderedRegistry(registry, []);
    try {
      await Bun.write(
        join(String(dir), "bunfig.toml"),
        `[install]\ncache = "${join(String(dir), ".cache").replaceAll("\\", "\\\\")}"\nregistry = "${server.url.origin}/"\n`,
      );
      const install = async () => {
        await using proc = spawn({
          cmd: [bunExe(), "install", "--ignore-scripts"],
          cwd: String(dir),
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        return { out, err, exitCode, lockfile: await Bun.file(join(String(dir), "bun.lock")).text() };
      };
      const first = await install();
      expect(first.exitCode).toBe(0);
      const second = await install();
      expect(second.exitCode).toBe(0);
      expect(second.out + second.err).toContain("no changes");
      expect(second.lockfile).toBe(first.lockfile);
    } finally {
      await stop();
    }
  });

  // Adding one dependency reuses the version the lockfile already carries for
  // a name (a present satisfying copy) instead of pulling a newer one — the
  // change's lockfile diff stays scoped to the change.
  scenario("adding a dependency reuses a satisfying version already in the lockfile", async () => {
    const registry: RegistrySpec = {
      shared: pkg(["1.5.0", "1.9.0", "2.0.0"]),
      owner: pkg({ "1.0.0": { dependencies: { shared: "1.5.0" } } }),
      newcomer: pkg({ "1.0.0": { dependencies: { shared: "^1.4.0" } } }),
    };
    await ensureTarballs(registry);
    // The root pins shared@2.0.0 so 1.5.0 is nested under `owner`, not visible
    // up-tree from `newcomer`: reuse must come from preferring the present
    // 1.5.0 over the manifest's newer 1.9.0.
    await using dir = tempDir("resolution-order", project({ dependencies: { shared: "2.0.0", owner: "1.0.0" } }));
    const first = await runInstall(String(dir), registry, Object.keys(registry));
    expect(first.exitCode).toBe(0);
    expect(first.versions["owner/shared"]).toBe("shared@1.5.0");

    await Bun.write(
      join(String(dir), "package.json"),
      JSON.stringify({
        name: "root",
        version: "0.0.0",
        dependencies: { shared: "2.0.0", owner: "1.0.0", newcomer: "1.0.0" },
      }),
    );
    const second = await runInstall(String(dir), registry, Object.keys(registry));
    expect(second.exitCode).toBe(0);
    expect(second.versions["newcomer/shared"]).toBe("shared@1.5.0");
    expect(Object.values(second.versions)).not.toContain("shared@1.9.0");
  });
});
