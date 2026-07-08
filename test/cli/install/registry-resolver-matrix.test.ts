import { write } from "bun";
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { NpmRegistry, bunEnv, bunExe, tmpdirSync } from "harness";
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
 *  - manifest cache: registry.npmjs.org sends `Cache-Control:
 *    max-age=300`, so on a second resolve within five minutes bun never
 *    touches the network and every manifest load completes
 *    synchronously, which drives a completely different (re-entrant)
 *    path through the resolver than the asynchronous cold-cache one.
 *    verdaccio sent no `Cache-Control`, so the warm, fully-synchronous
 *    path was almost never tested. The one known bug of this class (a
 *    transitive peer dependency dropped by the isolated linker, the
 *    `fully synchronous` test in isolated-install.test.ts) reproduced
 *    only in the `isolated x warm` cell.
 *
 * Every cell of a scenario gets its own registry and project and must
 * produce byte-for-byte the same `bun.lock` (after normalizing the
 * registry's port): resolution may never depend on the linker or on
 * whether a manifest came from the network or the cache. Each cell also
 * resolves in two passes (cold, then again from the warmed cache with
 * no lockfile), must satisfy a `--frozen-lockfile` re-install of its own
 * output, and must actually make the packages `require`able.
 */

setDefaultTimeout(1000 * 60 * 5);

interface Mode {
  linker: "hoisted" | "isolated";
  /**
   * `"warm"` serves `Cache-Control: public, max-age=300`; the second
   * install resolves synchronously from the fresh manifest cache.
   * `"revalidate"` serves no `Cache-Control`; the second install must
   * go back to the registry for every manifest.
   */
  manifests: "warm" | "revalidate";
}

const MODES: Mode[] = [
  { linker: "hoisted", manifests: "revalidate" },
  { linker: "hoisted", manifests: "warm" },
  { linker: "isolated", manifests: "revalidate" },
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

/** One cell: a fresh registry, a fresh project, two resolves, a probe. */
async function runCell(mode: Mode, scenario: Scenario): Promise<string> {
  await using registry = await new NpmRegistry(
    mode.manifests === "warm" ? { cacheControl: "public, max-age=300" } : {},
  ).start();
  scenario.define(registry);

  const dir = tmpdirSync();
  const env = { ...bunEnv, BUN_INSTALL_CACHE_DIR: undefined };
  await Promise.all([
    // A real manifest cache directory: `warm` vs `revalidate` is about
    // whether bun trusts what is in it, so it has to exist.
    write(
      join(dir, "bunfig.toml"),
      `
[install]
cache = "${join(dir, ".bun-cache").replaceAll("\\", "\\\\")}"
registry = "${registry.url}"
saveTextLockfile = true
linker = "${mode.linker}"
`,
    ),
    write(join(dir, "package.json"), JSON.stringify({ name: "matrix-root", version: "1.0.0", ...scenario.root })),
    write(join(dir, scenario.probeDir ?? ".", "probe.js"), PROBE_PRELUDE + scenario.probe),
    ...Object.entries(scenario.files ?? {}).map(([path, contents]) => write(join(dir, path), contents)),
  ]);

  const label = `[${mode.linker}, ${mode.manifests}]`;
  // Pass 1: cold. Populates the manifest cache and writes a lockfile.
  const first = await run(dir, ["install"], env);
  expect({ label, err: first.stderr, exitCode: first.exitCode }).toEqual({
    label,
    err: expect.not.stringContaining("error:"),
    exitCode: 0,
  });

  // Pass 2: resolve the same graph again from nothing but the warmed
  // manifest cache. With `Cache-Control: max-age`, no network at all.
  await Promise.all([
    rm(join(dir, "node_modules"), { recursive: true, force: true }),
    rm(join(dir, "bun.lock"), { force: true }),
  ]);
  const second = await run(dir, ["install"], env);
  expect({ label, err: second.stderr, exitCode: second.exitCode }).toEqual({
    label,
    err: expect.not.stringContaining("error:"),
    exitCode: 0,
  });

  // The tree it produced must be importable and complete.
  const probe = await run(join(dir, scenario.probeDir ?? "."), ["probe.js"], env);
  expect({ label, stdout: probe.stdout, stderr: probe.stderr, exitCode: probe.exitCode }).toEqual({
    label,
    stdout: scenario.expected,
    stderr: "",
    exitCode: 0,
  });

  // And its own lockfile must reproduce it exactly.
  const frozen = await run(dir, ["install", "--frozen-lockfile"], env);
  expect({ label, err: frozen.stderr, exitCode: frozen.exitCode }).toEqual({
    label,
    err: expect.not.stringContaining("error:"),
    exitCode: 0,
  });

  return normalizeLock(await Bun.file(join(dir, "bun.lock")).text());
}

describe.concurrent("resolver matrix", () => {
  for (const [name, scenario] of Object.entries(SCENARIOS)) {
    test(name, async () => {
      const cells = await Promise.all(
        MODES.map(async mode => [`${mode.linker}, ${mode.manifests} manifests`, await runCell(mode, scenario)]),
      );
      // Resolution is a pure function of package.json and the registry:
      // the linker and the manifest cache's freshness must not change
      // the lockfile. A mismatch names the cell that diverged.
      const lockfiles = Object.fromEntries(cells);
      const reference = cells[0]![1];
      // The comparison is only meaningful over a real lockfile.
      expect(reference).toContain(`"packages"`);
      expect(reference).toContain("localhost:4873/");
      expect(lockfiles).toEqual(Object.fromEntries(cells.map(([key]) => [key, reference])));
    });
  }
});
