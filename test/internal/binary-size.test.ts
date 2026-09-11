/**
 * scripts/binary-size.ts is the CI step that fails a PR build when a shipped
 * binary grew past the threshold compared with the newest main build that
 * recorded its sizes. Everything it talks to is replaced here: buildkite.com
 * (the public build list and per-build .json, reached through
 * BUILDKITE_BUILD_URL) by a local server, and buildkite-agent (meta-data of
 * this build, the binary-sizes.json artifacts of main builds, the annotation)
 * by a shell script on PATH that reads and writes files under FAKE_DIR.
 * Shell-script fakes don't resolve as executables on Windows, hence the skip;
 * the real step only runs on Linux anyway.
 *
 * Every run loads the script (and scripts/utils.mjs) in a fresh debug-build
 * process, which takes a couple of seconds, hence the per-test timeouts and
 * scenarios that each pack in as much as they can.
 */
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { chmodSync } from "node:fs";
import { join } from "node:path";

const script = join(import.meta.dir, "..", "..", "scripts", "binary-size.ts");

const fakeAgent = [
  "#!/bin/sh",
  'case "$1 $2" in',
  '  "meta-data get") cat "$FAKE_DIR/meta/$3" 2>/dev/null ;;',
  '  "artifact upload") exit 0 ;;',
  // artifact download binary-sizes.json <dir> --build <build uuid>
  '  "artifact download") [ "$5" = --build ] && cp "$FAKE_DIR/artifacts/$6.json" "$4/$3" 2>/dev/null ;;',
  '  "annotate "*) shift; echo "$*" > "$FAKE_DIR/annotation.args"; cat > "$FAKE_DIR/annotation.html" ;;',
  "  *) exit 1 ;;",
  "esac",
  "",
].join("\n");

type Sizes = Record<string, number>;

interface MainBuild {
  number: number;
  /** What that build's binary-size step uploaded; absent when the step never ran there. */
  record?: { release?: boolean; sizes: Sizes };
  /** `branch_name` in the build's .json. */
  branch?: string;
}

interface Scenario {
  /** `binary-size:<triplet>` meta-data of the build under test. */
  sizes: Sizes;
  /** Main builds in the order the build list shows them, 20 per page. */
  main: MainBuild[];
  /** Answer the build list with this status instead of a page. */
  listStatus?: number;
  args?: string[];
}

const TARGETS = ["bun-linux-x64", "bun-darwin-aarch64"];
const BASE: Sizes = { "bun-linux-x64": 80_000_000, "bun-darwin-aarch64": 60_000_000 };
const BUILD_NUMBER = "999";

async function runBinarySize({ sizes, main, listStatus, args = [] }: Scenario) {
  using server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/bun/bun/builds" && url.searchParams.get("branch") === "main") {
        if (listStatus) return new Response("", { status: listStatus });
        const page = Number(url.searchParams.get("page") ?? 1);
        // Like buildkite.com, every row links to its build and lazy-loads the
        // build's steps from a sub-path, so each number appears twice.
        const rows = main
          .slice((page - 1) * 20, page * 20)
          .map(
            ({ number }) =>
              `<a href="/bun/bun/builds/${number}">#${number}</a>` +
              `<turbo-frame src="/bun/bun/builds/${number}/steps_turbo"></turbo-frame>`,
          );
        return new Response(`<html><body>${rows.join("\n")}</body></html>`, {
          headers: { "content-type": "text/html" },
        });
      }
      const build = main.find(b => url.pathname === `/bun/bun/builds/${b.number}.json`);
      if (build) return Response.json({ id: `uuid-${build.number}`, branch_name: build.branch ?? "main" });
      return new Response("", { status: 404 });
    },
  });
  const pipelineUrl = `http://127.0.0.1:${server.port}/bun/bun`;

  const files: Record<string, string> = { "fake/bin/buildkite-agent": fakeAgent };
  for (const [triplet, bytes] of Object.entries(sizes)) files[`fake/meta/binary-size:${triplet}`] = String(bytes);
  for (const { number, record } of main)
    if (record) files[`fake/artifacts/uuid-${number}.json`] = JSON.stringify(record);
  using dir = tempDir("binary-size", files);
  const fake = join(String(dir), "fake");
  chmodSync(join(fake, "bin", "buildkite-agent"), 0o755);

  await using proc = Bun.spawn({
    cmd: [bunExe(), script, "--targets", JSON.stringify(TARGETS.map(triplet => ({ triplet }))), ...args],
    cwd: String(dir),
    env: {
      ...bunEnv,
      PATH: `${join(fake, "bin")}:${bunEnv.PATH}`,
      FAKE_DIR: fake,
      BUILDKITE_BUILD_URL: `${pipelineUrl}/builds/${BUILD_NUMBER}`,
      BUILDKITE_BUILD_NUMBER: BUILD_NUMBER,
      BUILDKITE_BRANCH: "some-pr-branch",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const [annotation, annotateArgs] = await Promise.all([
    Bun.file(join(fake, "annotation.html")).text(),
    Bun.file(join(fake, "annotation.args")).text(),
  ]);
  return {
    stdout,
    stderr,
    exitCode,
    pipelineUrl,
    /** The `main #<n> ...` log lines: which main builds were tried, in order, and why each was skipped. */
    tried: stdout.split("\n").filter(line => line.startsWith("  main #")),
    summary: annotation.match(/<summary>(.*)<\/summary>/)![1],
    annotation,
    annotateArgs: annotateArgs.trim(),
  };
}

describe.skipIf(isWindows)("scripts/binary-size.ts", () => {
  test.concurrent(
    "compares against the newest usable main build and fails a target over the threshold",
    async () => {
      const r = await runBinarySize({
        sizes: {
          "bun-linux-x64": BASE["bun-linux-x64"] + 600_000,
          "bun-darwin-aarch64": BASE["bun-darwin-aarch64"] - 2048,
        },
        // Deliberately not newest-first: the script must try builds by number.
        main: [
          { number: 280, record: { sizes: {} } },
          { number: 300 },
          { number: 265, record: { sizes: BASE } },
          { number: 290, record: { release: true, sizes: BASE } },
          { number: 270, record: { sizes: BASE } },
        ],
      });
      expect(r.tried).toEqual([
        "  main #300 has no binary-sizes.json (its binary-size step did not run)",
        "  main #290 is a release build",
        "  main #280 recorded no sizes for these targets",
        `  main #270: ${r.pipelineUrl}/builds/270`,
      ]);
      expect(r.summary).toBe("📦 Binary size — <b>1</b> over 0.50 MB");
      expect(r.annotation).toContain(`<a href="${r.pipelineUrl}/builds/270">main #270</a>`);
      expect(r.annotation).toContain(`❌ <code>bun-linux-x64</code></td><td align="right">76.87 MB</td>`);
      expect(r.annotation).toContain(`<td align="right">76.29 MB</td><td align="right"><b>+585.9 KB</b></td>`);
      expect(r.annotation).toContain(`<code>bun-darwin-aarch64</code></td><td align="right">57.22 MB</td>`);
      expect(r.annotation).toContain(`<td align="right">57.22 MB</td><td align="right">-2.0 KB</td>`);
      expect(r.annotation).toContain("[skip size check]");
      expect(r.annotateArgs).toBe("--style error --context binary-size --priority 5");
      expect(r.stderr).toBe("\nerror: 1 target(s) exceeded 0.50 MB vs canary\n");
      expect(r.exitCode).toBe(1);
    },
    30_000,
  );

  test.concurrent(
    "looks past a whole page of builds that recorded nothing and passes a build within the threshold",
    async () => {
      // A merge burst: main builds canceled by the next push before their
      // build-bun jobs finished. One entry claims to be main in the list but its
      // .json says otherwise; it must be ignored even though it has sizes.
      const burst: MainBuild[] = Array.from({ length: 19 }, (_, i) => ({ number: 500 - i }));
      const r = await runBinarySize({
        sizes: { "bun-linux-x64": BASE["bun-linux-x64"] + 16_384, "bun-darwin-aarch64": BASE["bun-darwin-aarch64"] },
        main: [
          ...burst,
          { number: 481, branch: "gh-readonly-queue/main/pr-1", record: { sizes: { "bun-linux-x64": 1 } } },
          { number: 470, record: { sizes: BASE } },
        ],
      });
      expect(r.tried).toHaveLength(21);
      expect(r.tried).toContain("  main #481 is not a main build (branch: gh-readonly-queue/main/pr-1)");
      expect(r.tried.at(-1)).toBe(`  main #470: ${r.pipelineUrl}/builds/470`);
      expect(r.summary).toBe("📦 Binary size — all within 0.50 MB");
      expect(r.annotation).toContain(`<a href="${r.pipelineUrl}/builds/470">main #470</a>`);
      expect(r.annotation).toContain(`<td align="right">+16.0 KB</td>`);
      expect(r.annotateArgs).toBe("--style info --context binary-size --priority 2");
      expect(r.stderr).toBe("");
      expect(r.exitCode).toBe(0);
    },
    30_000,
  );

  // The bug this guards against: the baseline lookup failed (the GitHub API
  // this used to go through was rate limited about half the time) and the step
  // passed with nothing compared, letting +2 MB through the 0.5 MB gate.
  const noBaseline: [how: string, scenario: Partial<Scenario>, note: string][] = [
    ["the build list cannot be fetched", { listStatus: 503 }, "builds?branch=main&amp;page=1: HTTP 503"],
    [
      "no listed main build recorded sizes",
      { main: [{ number: 300 }, { number: 290 }] },
      "the last 2 main build(s) recorded no canary sizes",
    ],
    ["the build list is empty", { main: [] }, "no main builds listed at "],
  ];
  for (const [how, scenario, note] of noBaseline) {
    test.concurrent(
      `fails a PR build instead of passing without a comparison when ${how}`,
      async () => {
        const r = await runBinarySize({ sizes: BASE, main: [], ...scenario });
        expect(r.summary).toStartWith("📦 Binary size — no canary baseline, nothing compared (");
        expect(r.summary).toContain(note);
        expect(r.annotation).toContain("This step fails rather than pass without comparing anything.");
        expect(r.annotation).toContain(`<code>bun-linux-x64</code></td><td align="right">76.29 MB</td>`);
        expect(r.annotateArgs).toBe("--style error --context binary-size --priority 5");
        expect(r.stderr).toStartWith("\nerror: nothing to compare against: ");
        expect(r.exitCode).toBe(1);
      },
      30_000,
    );
  }

  test.concurrent(
    "--no-fail (main) reports a missing baseline as a warning and still exits 0",
    async () => {
      // On main the list includes the build under test itself (#999), which is
      // never a baseline for itself.
      const r = await runBinarySize({
        sizes: BASE,
        main: [{ number: Number(BUILD_NUMBER), record: { sizes: BASE } }, { number: 300 }],
        args: ["--no-fail"],
      });
      expect(r.tried).toEqual(["  main #300 has no binary-sizes.json (its binary-size step did not run)"]);
      expect(r.summary).toBe(
        "📦 Binary size — no canary baseline, nothing compared (the last 1 main build(s) recorded no canary sizes)",
      );
      expect(r.annotateArgs).toBe("--style warning --context binary-size --priority 2");
      expect(r.stderr).toBe("");
      expect(r.exitCode).toBe(0);
    },
    30_000,
  );

  test.concurrent(
    "--release compares only against release builds and stays informational without one",
    async () => {
      const r = await runBinarySize({
        sizes: BASE,
        main: [{ number: 300, record: { sizes: BASE } }],
        args: ["--release"],
      });
      expect(r.tried).toEqual(["  main #300 is a canary build"]);
      expect(r.summary).toBe(
        "📦 Binary size — no release baseline, nothing compared (the last 1 main build(s) recorded no release sizes)",
      );
      expect(r.annotateArgs).toBe("--style warning --context binary-size --priority 2");
      expect(r.stderr).toBe("");
      expect(r.exitCode).toBe(0);
    },
    30_000,
  );

  test.concurrent(
    "a build whose build-bun jobs recorded nothing has nothing to gate and only warns",
    async () => {
      const r = await runBinarySize({ sizes: {}, main: [{ number: 300, record: { sizes: BASE } }] });
      expect(r.summary).toBe("📦 Binary size — nothing to measure, no build-bun job recorded a size");
      expect(r.annotateArgs).toBe("--style warning --context binary-size --priority 2");
      expect(r.stderr).toBe("");
      expect(r.exitCode).toBe(0);
    },
    30_000,
  );
});
