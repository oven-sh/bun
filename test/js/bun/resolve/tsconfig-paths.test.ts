import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// match_tsconfig_paths used to do a linear key scan with eql_long for the
// exact-match pass and re-scan every key for '*' on every call. With a hash
// lookup for exact matches and the '*' position cached at parse time, the
// per-import cost for the exact pass is O(1) independent of the key count.

describe.concurrent("tsconfig compilerOptions.paths", () => {
  test("exact-match resolution is O(1), not a scan over keys", async () => {
    // Self-calibrating complexity check: with 3000 exact-match keys (all the
    // same length, sharing a long prefix so a bytewise compare cannot exit on
    // the first word), resolving the last inserted key must not be materially
    // slower than resolving the first. On the linear scan the measured ratio
    // is ~27x (release) / ~53x (debug); on a hash lookup it is ~1x.
    const N_KEYS = 3000;
    const PREFIX = "monorepo-internal-workspace-package-alias-name-slot";
    const keyAt = (i: number) => PREFIX + String(i).padStart(60 - PREFIX.length, "0");

    const paths: Record<string, string[]> = {};
    for (let i = 0; i < N_KEYS; i++) paths[keyAt(i)] = ["./impl/target.ts"];
    paths["@wild/*"] = ["./impl/*"];

    using dir = tempDir("tsconfig-paths-scan", {
      "tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths } }),
      "impl/target.ts": "export const x = 1;\n",
      "impl/wild.ts": "export const y = 2;\n",
      "bench.ts":
        `const dir = import.meta.dir;\n` +
        `const PREFIX = ${JSON.stringify(PREFIX)};\n` +
        `const keyAt = i => PREFIX + String(i).padStart(${60 - PREFIX.length}, "0");\n` +
        `const target = Bun.resolveSync("./impl/target.ts", dir);\n` +
        `const ITERS = 400;\n` +
        `const bench = k => {\n` +
        `  const t0 = Bun.nanoseconds();\n` +
        `  for (let i = 0; i < ITERS; i++)\n` +
        `    if (Bun.resolveSync(k, dir) !== target) throw new Error("resolved to wrong target: " + k);\n` +
        `  return Bun.nanoseconds() - t0;\n` +
        `};\n` +
        `for (let i = 0; i < 20; i++) Bun.resolveSync(keyAt(0), dir);\n` +
        `for (let i = 0; i < 20; i++) Bun.resolveSync(keyAt(${N_KEYS - 1}), dir);\n` +
        `let first = Infinity, last = Infinity;\n` +
        `for (let r = 0; r < 3; r++) {\n` +
        `  first = Math.min(first, bench(keyAt(0)));\n` +
        `  last = Math.min(last, bench(keyAt(${N_KEYS - 1})));\n` +
        `}\n` +
        `const wild = Bun.resolveSync("@wild/wild", dir);\n` +
        `if (wild !== Bun.resolveSync("./impl/wild.ts", dir)) throw new Error("wildcard resolved to " + wild);\n` +
        `console.log(JSON.stringify({ first, last, ratio: last / first }));\n`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), join(String(dir), "bench.ts")],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const { first, last, ratio } = JSON.parse(stdout);
    expect({ first, last, ratio }).toEqual({
      first: expect.any(Number),
      last: expect.any(Number),
      ratio: expect.any(Number),
    });
    // Linear scan gives >=27x here; hash lookup gives ~1x. 5x leaves >5x
    // headroom on both sides across release, debug, and ASAN.
    expect(ratio).toBeLessThan(5);
  });

  test("many entries resolve correctly (exact, wildcard, longest-prefix)", async () => {
    const paths: Record<string, string[]> = {};
    // Interleave exact and wildcard entries so iteration order is mixed.
    for (let i = 0; i < 150; i++) {
      paths[`exact-key-${i}`] = [`./exact/${i}.ts`];
      paths[`wild${i}/*`] = [`./w/${i}/*`];
    }
    // Overlapping wildcards: longest prefix must win.
    paths["@scope/*"] = ["./scope-short/*"];
    paths["@scope/pkg/*"] = ["./scope-long/*"];

    const files: Record<string, string> = {
      "tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths } }),
      "scope-short/fallback.ts": "export {};\n",
      "scope-long/main.ts": "export {};\n",
      "main.ts":
        `const dir = import.meta.dir;\n` +
        `const out: string[] = [];\n` +
        `const rel = p => p.slice(dir.length + 1).replace(/\\\\/g, "/");\n` +
        `out.push(rel(Bun.resolveSync("exact-key-0", dir)));\n` +
        `out.push(rel(Bun.resolveSync("exact-key-149", dir)));\n` +
        `out.push(rel(Bun.resolveSync("wild7/hit", dir)));\n` +
        `out.push(rel(Bun.resolveSync("wild149/hit", dir)));\n` +
        `out.push(rel(Bun.resolveSync("@scope/pkg/main", dir)));\n` +
        `out.push(rel(Bun.resolveSync("@scope/fallback", dir)));\n` +
        `try { Bun.resolveSync("no-such-key", dir); out.push("BAD"); }\n` +
        `catch (e) { out.push("notfound:" + e.code); }\n` +
        `console.log(out.join("\\n"));\n`,
    };
    files["exact/0.ts"] = "export {};\n";
    files["exact/149.ts"] = "export {};\n";
    files["w/7/hit.ts"] = "export {};\n";
    files["w/149/hit.ts"] = "export {};\n";

    using dir = tempDir("tsconfig-paths-many", files);

    await using proc = Bun.spawn({
      cmd: [bunExe(), join(String(dir), "main.ts")],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim().split("\n")).toEqual([
      "exact/0.ts",
      "exact/149.ts",
      "w/7/hit.ts",
      "w/149/hit.ts",
      "scope-long/main.ts",
      "scope-short/fallback.ts",
      "notfound:ERR_MODULE_NOT_FOUND",
    ]);
    expect(exitCode).toBe(0);
  });
});
