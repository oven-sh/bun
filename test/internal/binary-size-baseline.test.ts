// Verifies that scripts/binary-size.ts does not fail a PR build when the only
// available main baseline predates the PR's merge-base. This is the scenario
// that trips every PR when a run of main builds gets canceled/timed out so the
// binary-size aggregator never runs, leaving a stale baseline that already
// carries several hundred KB of main's own growth.
//
// The test stands up a fake GitHub + Buildkite frontend and a fake
// buildkite-agent, then runs the real script against them.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { bunEnv, bunExe, isPosix, tempDir } from "harness";
import { chmodSync } from "node:fs";
import { join } from "node:path";

// The world:
//   main:  sha-old (build 100, full sizes)  →  sha-mid (build 150, +550KB;
//          its darwin build was canceled so only linux-x64 is recorded)
//          →  sha-base (build 200, partial sizes: only linux-x64)
//          →  sha-head (build 250, full sizes; main HEAD, landed AFTER the PR
//          branched)
//   PR:    branched from sha-base; adds ~16 KB on both targets.
// So the only darwin-aarch64 baseline at or before the merge-base is two
// commits behind it and predates a +550 KB main change the PR already contains.
const TRIPLETS = ["bun-linux-x64", "bun-darwin-aarch64"] as const;
const SHA2BUILD = { "sha-head": 250, "sha-base": 200, "sha-mid": 150, "sha-old": 100 } as const;

const META: Record<string, Record<string, number>> = {
  "100": { "bun-linux-x64": 75_000_000, "bun-darwin-aarch64": 60_000_000 },
  "150": { "bun-linux-x64": 75_560_000 },
  "200": { "bun-linux-x64": 75_560_000 },
  // main HEAD, one commit ahead of the PR's merge-base
  "250": { "bun-linux-x64": 76_000_000, "bun-darwin-aarch64": 60_700_000 },
  // the PR's own build
  "999": { "bun-linux-x64": 75_576_384, "bun-darwin-aarch64": 60_576_384 },
};
const UUID = Object.fromEntries(Object.values(SHA2BUILD).map(n => [String(n), `uuid-${n}`]));

// Per-build .json overrides: webhook canary by default; tests override to
// exercise the release filter in the meta-data fallback.
let buildJsonOverrides: Record<string, { message?: string; source?: string }> = {};

function githubHandler(url: URL): unknown {
  if (url.pathname === "/repos/oven-sh/bun/compare/main...sha-pr") {
    return { merge_base_commit: { sha: "sha-base" }, ahead_by: 1, behind_by: 1 };
  }
  if (url.pathname === "/repos/oven-sh/bun/commits") {
    const from = url.searchParams.get("sha");
    // History as returned by the list-commits endpoint, newest first.
    const chain = Object.keys(SHA2BUILD);
    const start = from === "main" ? 0 : chain.indexOf(from ?? "");
    return chain.slice(start < 0 ? 0 : start).map(sha => ({ sha }));
  }
  const mStatus = url.pathname.match(/^\/repos\/oven-sh\/bun\/commits\/(.+)\/status$/);
  if (mStatus) {
    const build = SHA2BUILD[mStatus[1] as keyof typeof SHA2BUILD];
    return {
      statuses: build ? [{ context: "buildkite/bun", target_url: `http://127.0.0.1/bun/bun/builds/${build}` }] : [],
    };
  }
  return { error: "not found" };
}

let server: ReturnType<typeof Bun.serve>;
let base: string;
beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      // buildkite.com public .json → build UUID + commit message + trigger source
      const mBuild = url.pathname.match(/^\/bun\/bun\/builds\/(\d+)\.json$/);
      if (mBuild)
        return Response.json({
          id: UUID[mBuild[1]] ?? "uuid-unknown",
          message: "commit",
          source: "webhook",
          ...buildJsonOverrides[mBuild[1]],
        });
      // everything else → GitHub API
      return Response.json(githubHandler(url));
    },
  });
  base = `http://127.0.0.1:${server.port}`;
});
afterAll(() => server?.stop(true));

// Flatten META into env vars so the bash shim can answer without spawning
// another interpreter (debug+ASAN bun startup would push this over the timeout).
function metaEnv(meta: typeof META): Record<string, string> {
  const out: Record<string, string> = {};
  const key = (num: string, triplet: string) => `M_${num}_${triplet.replaceAll("-", "_")}`;
  for (const [num, sizes] of Object.entries(meta))
    for (const [t, v] of Object.entries(sizes)) out[key(num, t)] = String(v);
  for (const [num, uuid] of Object.entries(UUID)) out[`UUID_${uuid.replaceAll("-", "_")}`] = num;
  return out;
}

const agentScript = `#!/usr/bin/env bash
set -eu
cmd="$1"; shift
case "$cmd" in
  secret) exit 1 ;;                      # no GITHUB_TOKEN secret
  annotate) cat > "$ANNOTATION_OUT"; exit 0 ;;
  artifact)
    [[ "$1" == "upload" ]] && exit 0
    exit 1                               # no binary-sizes.json artifact anywhere
    ;;
  meta-data)
    sub="$1"; shift
    key=""; build=""
    while (($#)); do
      case "$1" in --build) shift; build="$1" ;; *) key="$1" ;; esac; shift
    done
    [[ "$sub" == "get" ]] || exit 1
    if [[ -n "$build" ]]; then
      uvar="UUID_\${build//-/_}"; num="\${!uvar:-}"
    else
      num="$BUILDKITE_BUILD_NUMBER"
    fi
    triplet="\${key#binary-size:}"
    mvar="M_\${num}_\${triplet//-/_}"; val="\${!mvar:-}"
    [[ -n "$val" ]] || exit 1
    printf '%s' "$val"
    ;;
  *) exit 1 ;;
esac`;

async function runBinarySize(meta: typeof META, overrides: typeof buildJsonOverrides = {}) {
  buildJsonOverrides = overrides;
  using dir = tempDir("binary-size-baseline", { ".keep": "" });
  const agentPath = join(String(dir), "buildkite-agent");
  await Bun.write(agentPath, agentScript);
  chmodSync(agentPath, 0o755);

  const annotationOut = join(String(dir), "annotation.html");
  const root = join(import.meta.dir, "..", "..");
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      join(root, "scripts", "binary-size.ts"),
      "--targets",
      JSON.stringify(TRIPLETS.map(t => ({ triplet: t }))),
      "--threshold-mb",
      "0.5",
    ],
    cwd: String(dir),
    env: {
      ...bunEnv,
      ...metaEnv(meta),
      GITHUB_TOKEN: "",
      PATH: `${dir}:${bunEnv.PATH ?? process.env.PATH}`,
      ANNOTATION_OUT: annotationOut,
      BUILDKITE_ORGANIZATION_SLUG: "bun",
      BUILDKITE_PIPELINE_SLUG: "bun",
      BUILDKITE_BUILD_NUMBER: "999",
      BUILDKITE_BRANCH: "pr/branch",
      BUILDKITE_COMMIT: "sha-pr",
      BUILDKITE_PULL_REQUEST_BASE_BRANCH: "main",
      // Route both GitHub and buildkite.com through the local server.
      BINARY_SIZE_GITHUB_API: base,
      BINARY_SIZE_BUILDKITE_WEB: base,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const annotation = await Bun.file(annotationOut)
    .text()
    .catch(() => "");
  return { stdout, stderr, exitCode, annotation };
}

// The fake buildkite-agent is a bash script. Tests share one mock server with a
// mutable commit-message map, so they run sequentially.
test.skipIf(!isPosix)(
  "PR is not failed when the only over-threshold rows have a baseline older than merge-base",
  async () => {
    const { stdout, stderr, exitCode, annotation } = await runBinarySize(META);
    // linux-x64 baseline is from the merge-base build (#200): delta = 16 KB, under threshold.
    // darwin-aarch64 has to fall back to #100: delta = +563 KB. That row is stale (baseline
    // predates merge-base) so it is shown as ⚠️ but does not fail the step. Before this fix
    // the walk used a single build for every target, so both rows compared against #100 and
    // both read "+550 KB" → the step hard-failed with "2 target(s) exceeded 0.50 MB".
    expect(stderr).not.toContain("error:");
    expect(stdout).toContain("main #200");
    expect(stdout).toMatch(/bun-linux-x64\s+.*\+16\.0 KB\s*$/m);
    expect(stdout).toMatch(/bun-darwin-aarch64\s+.*\+562\.9 KB\s+\(stale: #100\)/);
    expect(annotation).toContain("all within 0.50 MB (1 stale ignored)");
    expect(annotation).toContain("⚠️ <code>bun-darwin-aarch64</code>");
    expect(annotation).toContain('<sup><a href="https://buildkite.com/bun/bun/builds/100">#100</a></sup>');
    expect(annotation).not.toContain("❌");
    expect(exitCode).toBe(0);
  },
);

test.skipIf(!isPosix)("PR still fails when the merge-base baseline itself is over threshold", async () => {
  // Bump the PR's own linux-x64 size by 600 KB over merge-base. The baseline for
  // linux-x64 is the merge-base build (#200), so this row is fresh and must fail.
  const big = { ...META, "999": { ...META["999"], "bun-linux-x64": META["200"]["bun-linux-x64"] + 600_000 } };
  const { stderr, annotation, exitCode } = await runBinarySize(big);
  expect(stderr).toContain("error: 1 target(s) exceeded 0.50 MB");
  expect(annotation).toContain("❌ <code>bun-linux-x64</code>");
  expect(exitCode).toBe(1);
});

for (const [how, override] of [
  ["source:ui (real Bun releases are manual triggers with RELEASE=1)", { source: "ui" }],
  ["[release] in the commit message", { message: "bump [release]" }],
] as const) {
  test.skipIf(!isPosix)(
    `meta-data fallback does not enforce release-mode sizes from a merge-base build with ${how}`,
    async () => {
      // Merge-base #200's meta-data is from a release build (whose Windows sizes
      // differ from canary by several MB). The fallback cannot recover an
      // authoritative release flag from meta-data, so it declines the build
      // entirely; the walk claims the anchor with no sizes and every row resolves
      // stale from an older canary build. Even with the PR's linux-x64 +600 KB
      // over #150, the step annotates the growth but does not hard-fail on a
      // baseline it cannot prove is like-for-like.
      const big = { ...META, "999": { ...META["999"], "bun-linux-x64": META["150"]["bun-linux-x64"] + 600_000 } };
      const { stdout, stderr, annotation, exitCode } = await runBinarySize(big, { "200": override });
      expect(stderr).not.toContain("error:");
      expect(stdout).toContain("main #200");
      expect(stdout).toMatch(/bun-linux-x64\s+.*\+585\.9 KB\s+\(stale: #150\)/);
      expect(annotation).toContain("all within 0.50 MB (2 stale ignored)");
      expect(annotation).not.toContain("❌");
      expect(exitCode).toBe(0);
    },
  );
}
