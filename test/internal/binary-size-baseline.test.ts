// Verifies that scripts/binary-size.ts resolves baselines from the PR merge-base
// and only warns (never fails) on growth. The stale-baseline scenario is what
// tripped every PR when a run of main builds got canceled/timed out so the
// binary-size aggregator never ran, leaving a stale baseline that already
// carried several hundred KB of main's own growth.
//
// `run()` takes its buildkite-agent and HTTP calls through an `Io` object, so
// the tests drive it in-process with a fake agent and a fake GitHub/Buildkite.

import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { run, type Io, type Sizes } from "../../scripts/binary-size";

// The world:
//   main:  sha-old (build 100, full sizes)  →  sha-mid (build 150, +550KB;
//          its darwin build was canceled so only linux-x64 is recorded)
//          →  sha-base (build 200, partial sizes: only linux-x64)
//          →  sha-head (build 250, full sizes; main HEAD, landed AFTER the PR
//          branched)
//   PR:    branched from sha-base; adds ~16 KB on both targets.
// So the only darwin-aarch64 baseline at or before the merge-base is two
// commits behind it and predates a +550 KB main change the PR already contains.
const TRIPLETS = ["bun-linux-x64", "bun-darwin-aarch64"];
const SHA2BUILD: Record<string, number> = { "sha-head": 250, "sha-base": 200, "sha-mid": 150, "sha-old": 100 };

const META: Record<string, Sizes> = {
  "100": { "bun-linux-x64": 75_000_000, "bun-darwin-aarch64": 60_000_000 },
  "150": { "bun-linux-x64": 75_560_000 },
  "200": { "bun-linux-x64": 75_560_000 },
  // main HEAD, one commit ahead of the PR's merge-base
  "250": { "bun-linux-x64": 76_000_000, "bun-darwin-aarch64": 60_700_000 },
  // the PR's own build
  "999": { "bun-linux-x64": 75_576_384, "bun-darwin-aarch64": 60_576_384 },
};
const uuidOf = (n: string | number) => `uuid-${n}`;
const numOf = (uuid: string) => uuid.replace(/^uuid-/, "");

type BuildJson = { message?: string; source?: string };

function fakeGithub(url: URL): unknown {
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
    const build = SHA2BUILD[mStatus[1]];
    return {
      statuses: build
        ? [{ context: "buildkite/bun", target_url: `https://buildkite.com/bun/bun/builds/${build}` }]
        : [],
    };
  }
  throw new Error(`unexpected GitHub request: ${url.pathname}`);
}

function fakeIo(meta: Record<string, Sizes>, buildJson: Record<string, BuildJson>, workDir: string) {
  const log: string[] = [];
  let annotate: { args: string[]; stdin?: string } | undefined;
  const io: Io = {
    workDir,
    log: line => log.push(line),
    async fetch(url) {
      const u = new URL(url);
      const mBuild = u.pathname.match(/^\/bun\/bun\/builds\/(\d+)\.json$/);
      if (u.host === "buildkite.com" && mBuild) {
        return Response.json({ id: uuidOf(mBuild[1]), message: "commit", source: "webhook", ...buildJson[mBuild[1]] });
      }
      if (u.host === "api.github.com") return Response.json(fakeGithub(u));
      throw new Error(`unexpected request: ${url}`);
    },
    agent(args, opts) {
      const [cmd, sub, ...rest] = args;
      if (cmd === "annotate") {
        annotate = { args: args.slice(1), stdin: opts?.stdin };
        return "";
      }
      if (cmd === "artifact") return sub === "upload" ? "" : undefined; // no binary-sizes.json artifact anywhere
      if (cmd === "meta-data" && sub === "get") {
        const key = rest[0].replace(/^binary-size:/, "");
        const buildIdx = rest.indexOf("--build");
        const num = buildIdx >= 0 ? numOf(rest[buildIdx + 1]) : "999";
        const v = meta[num]?.[key];
        return v === undefined ? undefined : String(v);
      }
      return undefined;
    },
  };
  const style = () => annotate?.args[annotate.args.indexOf("--style") + 1];
  return { io, log, annotation: () => annotate?.stdin ?? "", style };
}

async function runBinarySize(meta: Record<string, Sizes>, buildJson: Record<string, BuildJson> = {}) {
  using dir = tempDir("binary-size-baseline", { ".keep": "" });
  const fake = fakeIo(meta, buildJson, String(dir));
  const result = await run({
    targets: TRIPLETS.map(triplet => ({ triplet })),
    thresholdBytes: 0.5 * 1024 * 1024,
    isRelease: false,
    env: {
      org: "bun",
      pipeline: "bun",
      buildNumber: "999",
      branch: "pr/branch",
      commit: "sha-pr",
      baseBranch: "main",
    },
    io: fake.io,
  });
  return { result, stdout: fake.log.join("\n"), annotation: fake.annotation(), style: fake.style() };
}

describe.concurrent("binary-size baseline", () => {
  test("rows whose only baseline predates the merge-base are shown but not warned on", async () => {
    const { result, stdout, annotation, style } = await runBinarySize(META);
    // linux-x64 baseline is from the merge-base build (#200): delta = 16 KB, under threshold.
    // darwin-aarch64 has to fall back to #100: delta = +563 KB. That row is stale (baseline
    // predates merge-base) so it is listed with its source build but raises no warning.
    // Before this change the walk used one build for every target, so both rows compared
    // against #100, both read "+550 KB", and the step failed the PR.
    expect(stdout).toContain("main #200");
    expect(stdout).toMatch(/bun-linux-x64\s+.*\+16\.0 KB\s*$/m);
    expect(stdout).toMatch(/bun-darwin-aarch64\s+.*\+562\.9 KB\s+\(stale: #100\)/);
    expect(stdout).not.toContain("warning:");
    expect(annotation).toContain("all within 0.50 MB (1 stale ignored)");
    expect(annotation).toContain('<sup><a href="https://buildkite.com/bun/bun/builds/100">#100</a></sup>');
    expect(annotation).not.toContain("⚠️");
    expect(style).toBe("info");
    expect(result.overThreshold).toEqual([]);
  });

  test("growth over the merge-base baseline is a warning, not a failure", async () => {
    // Bump the PR's own linux-x64 size by 600 KB over merge-base. The baseline for
    // linux-x64 is the merge-base build (#200), so this row is fresh: it gets the
    // warning annotation.
    const big = { ...META, "999": { ...META["999"], "bun-linux-x64": META["200"]["bun-linux-x64"] + 600_000 } };
    const { result, stdout, annotation, style } = await runBinarySize(big);
    expect(stdout).toContain("warning: 1 target(s) exceeded 0.50 MB");
    expect(annotation).toContain("<b>1</b> over 0.50 MB");
    expect(annotation).toContain("⚠️ <code>bun-linux-x64</code>");
    expect(annotation).toContain("<details open>");
    expect(style).toBe("warning");
    expect(result.overThreshold).toEqual(["bun-linux-x64"]);
  });

  for (const [how, override] of [
    ["source:ui (real Bun releases are manual triggers with RELEASE=1)", { source: "ui" }],
    ["[release] in the commit message", { message: "bump [release]" }],
  ] as const) {
    test(`meta-data fallback does not compare against release-mode sizes from a merge-base build with ${how}`, async () => {
      // Merge-base #200's meta-data is from a release build (whose Windows sizes
      // differ from canary by several MB). The fallback cannot recover an
      // authoritative release flag from meta-data, so it declines the build
      // entirely; the walk claims the anchor with no sizes and every row resolves
      // stale from an older canary build. Even with the PR's linux-x64 +600 KB
      // over #150, no warning is raised on a baseline that is not like-for-like.
      const big = { ...META, "999": { ...META["999"], "bun-linux-x64": META["150"]["bun-linux-x64"] + 600_000 } };
      const { result, stdout, annotation, style } = await runBinarySize(big, { "200": override });
      expect(stdout).toContain("main #200");
      expect(stdout).toMatch(/bun-linux-x64\s+.*\+585\.9 KB\s+\(stale: #150\)/);
      expect(annotation).toContain("all within 0.50 MB (2 stale ignored)");
      expect(annotation).not.toContain("⚠️");
      expect(style).toBe("info");
      expect(result.overThreshold).toEqual([]);
    });
  }
});
