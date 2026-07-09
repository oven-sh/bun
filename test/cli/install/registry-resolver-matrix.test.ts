import { write } from "bun";
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { NpmRegistry, bunEnv, bunExe, isASAN, isLinux, tmpdirSync } from "harness";
import { rm } from "node:fs/promises";
import { join } from "node:path";

/**
 * A small `linker x manifest-cache` matrix over resolver scenarios that
 * have historically broken in exactly one cell.
 *
 * The two axes:
 *
 *  - `linker`: hoisted vs isolated. The same dependency graph, two very
 *    different installers.
 *
 *  - manifest cache: bun's warm-manifest gate is an on-disk cache
 *    entry younger than 300 s (`src/install/npm.rs` /
 *    `PackageManifestMap.rs`; independent of any server header). When
 *    it fires, every manifest load completes synchronously, which is a
 *    completely different (re-entrant) path through the resolver than
 *    the asynchronous network one. The one known bug of this class (a
 *    transitive peer dependency dropped by the isolated linker, the
 *    `fully synchronous` test in isolated-install.test.ts) reproduced
 *    only in the `isolated x warm` cell.
 *
 * Every cell of a scenario gets its own registry and project and must
 * produce byte-for-byte the same `bun.lock` (after normalizing the
 * registry's port): resolution may never depend on the linker or on
 * whether a manifest came from the network or the warm cache. Each cell
 * also resolves in two passes, must satisfy a `--frozen-lockfile`
 * re-install of its own output, and must actually make the packages
 * `require`able.
 */

// Mirrors what `scripts/runner.node.mjs` passes as `--timeout`, so running
// this file directly behaves like CI instead of taking bun's 5 s default.
setDefaultTimeout(isASAN ? 270_000 : 90_000);

interface Mode {
  linker: "hoisted" | "isolated";
  /**
   * `"warm"`: pass 1 and pass 2 share one `BUN_INSTALL_CACHE_DIR`, so
   * pass 2 hits the on-disk manifest cache pass 1 wrote (under the
   * 300 s window) and every manifest load is synchronous.
   *
   * `"cold"`: pass 2 points at a fresh empty cache dir, so it resolves
   * the same graph from the network again.
   */
  manifests: "warm" | "cold";
}

const MODES: Mode[] = [
  { linker: "hoisted", manifests: "cold" },
  { linker: "hoisted", manifests: "warm" },
  { linker: "isolated", manifests: "cold" },
  { linker: "isolated", manifests: "warm" },
];

interface Scenario {
  /** Puts the scenario's packages on a fresh registry. */
  define(registry: NpmRegistry): void;
  /** The project's package.json. */
  root: Record<string, unknown>;
  /** Extra project files (workspace members, …). */
  files?: Record<string, string>;
  /**
   * Where to run the probe from, relative to the project root. A
   * workspace scenario has to probe from inside a member: under the
   * isolated linker the root's `node_modules` only contains the root
   * package's own dependencies.
   */
  probeDir?: string;
  /**
   * Runs inside the installed project. It must only `require` the
   * root's own dependencies from the top, and reach everything
   * transitive through the package that depends on it (`fromPkg`
   * below): that is what "the edge exists" means under both linkers,
   * and the isolated linker deliberately hides everything else.
   */
  probe: string;
  /** The probe's expected stdout. */
  expected: string;
}

/**
 * Prepended to every probe: `v(name)` resolves from the project root,
 * `fromPkg(parent, name)` resolves `name` the way code inside `parent`
 * would, which is the only linker-agnostic way to reach a transitive
 * dependency.
 */
const PROBE_PRELUDE = `
  const { createRequire } = require("node:module");
  const v = name => require(name + "/package.json").version;
  const fromPkg = (parent, name) =>
    createRequire(require.resolve(parent + "/package.json"))(name + "/package.json").version;
`;

const SCENARIOS: Record<string, Scenario> = {
  "transitive peer chain": {
    // uses-strict-peer -> (peer) strict-peer-dep -> (peer) no-deps@^2.
    // The root's no-deps@1 cannot satisfy that ^2, so the transitive
    // peer has to be resolved and installed on its own.
    define(registry) {
      registry.define("no-deps", { "1.0.0": {}, "2.0.0": {} });
      registry.define("strict-peer-dep", { "1.0.0": { peerDependencies: { "no-deps": "^2.0.0" } } });
      registry.define("uses-strict-peer", { "1.0.0": { peerDependencies: { "strict-peer-dep": "1.0.0" } } });
    },
    root: { dependencies: { "no-deps": "1.0.0", "uses-strict-peer": "1.0.0" } },
    probe: `
      console.log(v("no-deps"));
      console.log(v("uses-strict-peer"));
      console.log(fromPkg("uses-strict-peer", "strict-peer-dep"));
    `,
    expected: "1.0.0\n1.0.0\n1.0.0\n",
  },

  "optional peer from multiple instances of one package": {
    // Two aliases of the same name@version, each with an optional peer
    // that is never provided. (hoist.test.ts's crash shape.)
    define(registry) {
      registry.define("one-dep", { "1.0.0": { dependencies: { "one-optional-peer-dep": "1.0.2" } } });
      registry.define("one-optional-peer-dep", {
        "1.0.2": {
          peerDependencies: { "no-deps": "*" },
          peerDependenciesMeta: { "no-deps": { optional: true } },
        },
      });
    },
    root: {
      dependencies: {
        "dep-1": "npm:one-optional-peer-dep@1.0.2",
        "dep-2": "npm:one-optional-peer-dep@1.0.2",
        "one-dep": "1.0.0",
      },
    },
    probe: `
      console.log(v("dep-1"));
      console.log(v("dep-2"));
      console.log(v("one-dep"));
      console.log(fromPkg("one-dep", "one-optional-peer-dep"));
    `,
    expected: "1.0.2\n1.0.2\n1.0.0\n1.0.2\n",
  },

  "workspace with a catalog": {
    define(registry) {
      registry.define("no-deps", { "1.0.0": {}, "1.1.0": {}, "2.0.0": {} });
    },
    root: {
      workspaces: ["packages/*"],
      catalog: { "no-deps": "^1.0.0" },
    },
    files: {
      "packages/a/package.json": JSON.stringify({
        name: "a",
        version: "1.0.0",
        dependencies: { "no-deps": "catalog:" },
      }),
      "packages/b/package.json": JSON.stringify({ name: "b", version: "1.0.0", dependencies: { a: "workspace:*" } }),
    },
    probeDir: "packages/b",
    probe: `
      console.log(v("a"));
      console.log(fromPkg("a", "no-deps"));
    `,
    expected: "1.0.0\n1.1.0\n",
  },

  "platform-filtered optional dependencies": {
    // One optional native dependency matches this platform, its
    // siblings never match anything. The filtered ones still appear in
    // the lockfile; only the install differs.
    define(registry) {
      registry.define("native", {
        "1.0.0": {
          optionalDependencies: {
            "native-here": "1.0.0",
            "native-nowhere": "1.0.0",
          },
        },
      });
      registry.define("native-here", { "1.0.0": { os: [process.platform], cpu: [process.arch] } });
      registry.define("native-nowhere", { "1.0.0": { os: ["!darwin", "!linux", "!win32"] } });
    },
    root: { dependencies: { native: "1.0.0" } },
    probe: `
      console.log(v("native"));
      console.log(fromPkg("native", "native-here"));
      let missing = false;
      try { fromPkg("native", "native-nowhere"); } catch { missing = true; }
      console.log("filtered:", missing);
    `,
    expected: "1.0.0\n1.0.0\nfiltered: true\n",
  },

  "aliases that point at each other": {
    define(registry) {
      registry.define("alias-loop-a", { "1.0.0": { dependencies: { b: "npm:alias-loop-b@1.0.0" } } });
      registry.define("alias-loop-b", { "1.0.0": { dependencies: { a: "npm:alias-loop-a@1.0.0" } } });
    },
    root: { dependencies: { a: "npm:alias-loop-a@1.0.0" } },
    probe: `
      console.log(require("a/package.json").name);
      console.log(fromPkg("a", "b"));
    `,
    expected: "alias-loop-a\n1.0.0\n",
  },
};

/** `bun.lock` with the one per-run value (the registry's port) removed. */
function normalizeLock(lock: string): string {
  return lock.replaceAll(/localhost:\d+/g, "localhost:4873");
}

async function run(cwd: string, args: string[], env: Record<string, string | undefined>) {
  await using proc = Bun.spawn({ cmd: [bunExe(), ...args], cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

interface CellResult {
  lock: string;
  /** Packument requests issued during pass 2. */
  packuments2: number;
  /** Whether pass 2 ran against pass 1's cache dir. This is the axis. */
  reusedCacheDir: boolean;
}

/** One cell: a fresh registry, a fresh project, two resolves, a probe. */
async function runCell(mode: Mode, scenario: Scenario): Promise<CellResult> {
  await using registry = await new NpmRegistry().start();
  scenario.define(registry);

  const dir = tmpdirSync();
  const cache1 = join(dir, ".bun-cache-1");
  // The second axis is the install cache directory: the warm cell
  // reuses pass 1's (on-disk manifests under the 300 s window, so
  // pass 2 never hits the network for them); the cold cell points
  // pass 2 at a fresh empty dir, isolating the manifest-cache variable.
  const cache2 = mode.manifests === "warm" ? cache1 : join(dir, ".bun-cache-2");
  // Set via bunfig `cache` and the env var together so neither a CI-
  // exported BUN_INSTALL_CACHE_DIR nor a bunfig default can win.
  const bunfig = (cacheDir: string) => `
[install]
cache = "${cacheDir.replaceAll("\\", "\\\\")}"
registry = "${registry.url}"
saveTextLockfile = true
linker = "${mode.linker}"
`;
  const env = (cacheDir: string) => ({ ...bunEnv, BUN_INSTALL_CACHE_DIR: cacheDir });
  await Promise.all([
    write(join(dir, "bunfig.toml"), bunfig(cache1)),
    write(join(dir, "package.json"), JSON.stringify({ name: "matrix-root", version: "1.0.0", ...scenario.root })),
    write(join(dir, scenario.probeDir ?? ".", "probe.js"), PROBE_PRELUDE + scenario.probe),
    ...Object.entries(scenario.files ?? {}).map(([path, contents]) => write(join(dir, path), contents)),
  ]);

  const label = `[${mode.linker}, ${mode.manifests}]`;
  // Pass 1: cold. Populates cache1's manifest cache and writes a lockfile.
  const first = await run(dir, ["install"], env(cache1));
  expect({ label, err: first.stderr, exitCode: first.exitCode }).toEqual({
    label,
    err: expect.not.stringContaining("error:"),
    exitCode: 0,
  });
  const requestsAfterFirst = registry.requestCount;

  // Pass 2: the same graph again with no lockfile, warm or cold on disk.
  await Promise.all([
    rm(join(dir, "node_modules"), { recursive: true, force: true }),
    rm(join(dir, "bun.lock"), { force: true }),
    write(join(dir, "bunfig.toml"), bunfig(cache2)),
  ]);
  const second = await run(dir, ["install"], env(cache2));
  expect({ label, err: second.stderr, exitCode: second.exitCode }).toEqual({
    label,
    err: expect.not.stringContaining("error:"),
    exitCode: 0,
  });
  const packuments2 = registry.requests.slice(requestsAfterFirst).filter(r => !r.path.includes(".tgz")).length;

  // The tree it produced must be importable and complete.
  const probe = await run(join(dir, scenario.probeDir ?? "."), ["probe.js"], env(cache2));
  expect({ label, stdout: probe.stdout, stderr: probe.stderr, exitCode: probe.exitCode }).toEqual({
    label,
    stdout: scenario.expected,
    stderr: "",
    exitCode: 0,
  });

  // And its own lockfile must reproduce it exactly.
  const frozen = await run(dir, ["install", "--frozen-lockfile"], env(cache2));
  expect({ label, err: frozen.stderr, exitCode: frozen.exitCode }).toEqual({
    label,
    err: expect.not.stringContaining("error:"),
    exitCode: 0,
  });

  return {
    lock: normalizeLock(await Bun.file(join(dir, "bun.lock")).text()),
    packuments2,
    reusedCacheDir: cache2 === cache1,
  };
}

describe.concurrent("resolver matrix", () => {
  for (const [name, scenario] of Object.entries(SCENARIOS)) {
    test(name, async () => {
      // Run the cells one at a time. `describe.concurrent` already puts one
      // `bun install` per scenario in flight, and the ASAN lane caps test
      // concurrency at 5 (`src/options_types/context.rs`) precisely to bound
      // live children; a `Promise.all` here would quadruple it behind the
      // governor's back.
      const cells: (readonly [string, CellResult])[] = [];
      for (const mode of MODES) {
        cells.push([`${mode.linker}, ${mode.manifests}`, await runCell(mode, scenario)] as const);
      }
      const by = Object.fromEntries(cells) as Record<`${Mode["linker"]}, ${Mode["manifests"]}`, CellResult>;
      // A warm pass 2's packument count is not a deterministic observable:
      // bun writes the manifest cache fire-and-forget across process exit on
      // purpose (`src/install/npm.rs`: "It's an optional cache. Therefore, we
      // choose to not increment the pending task count"), so pass 1 drops an
      // arbitrary subset of its writes and pass 2 refetches those. Every
      // platform loses that race, Linux least often — the only reason
      // `warm < cold` is asserted there and only `warm <= cold` everywhere.
      for (const linker of ["hoisted", "isolated"] as const) {
        const { packuments2: warm, reusedCacheDir: warmReused } = by[`${linker}, warm`];
        const { packuments2: cold, reusedCacheDir: coldReused } = by[`${linker}, cold`];
        expect({ linker, warmReused, coldReused, coldRefetched: cold > 0, warmNoWorse: warm <= cold }) //
          .toEqual({ linker, warmReused: true, coldReused: false, coldRefetched: true, warmNoWorse: true });
        if (isLinux) expect({ linker, warm, cold, warmFewer: warm < cold }).toMatchObject({ warmFewer: true });
      }
      // Resolution is a pure function of package.json and the registry:
      // the linker and the manifest cache's freshness must not change
      // the lockfile. A mismatch names the cell that diverged.
      const lockfiles = Object.fromEntries(cells.map(([k, v]) => [k, v.lock]));
      const reference = cells[0]![1].lock;
      // The comparison is only meaningful over a real lockfile.
      expect(reference).toContain(`"packages"`);
      expect(reference).toContain("localhost:4873/");
      expect(lockfiles).toEqual(Object.fromEntries(cells.map(([k]) => [k, reference])));
    });
  }
});
