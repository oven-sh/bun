import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// match_tsconfig_paths used to do a linear key scan with eql_long for the
// exact-match pass and re-scan every key for '*' on every call. With a hash
// lookup for exact matches and the '*' position cached at parse time, the
// per-import cost is O(1) for the exact pass plus one cheap branch per key
// for the wildcard pass. Sizes below are chosen so the old per-import scan
// cannot finish within the spawn timeout on a debug build while the fixed
// path finishes in about a second.

test("tsconfig paths: exact-match resolution is hash-lookup, not a key scan", async () => {
  // 8000 exact-match keys (no '*'), all sharing a long common prefix so a
  // bytewise compare cannot short-circuit on the first word, plus one
  // wildcard entry at the end so the wildcard pass still runs.
  const N_KEYS = 8000;
  const N_RESOLVES = 6000;
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
      `for (let i = 0; i < ${N_RESOLVES}; i++) {\n` +
      `  const r = Bun.resolveSync(keyAt(i % ${N_KEYS}), dir);\n` +
      `  if (r !== target) throw new Error("exact-match resolved to " + r);\n` +
      `}\n` +
      `const wild = Bun.resolveSync("@wild/wild", dir);\n` +
      `if (wild !== Bun.resolveSync("./impl/wild.ts", dir)) throw new Error("wildcard resolved to " + wild);\n` +
      `console.log("ok");\n`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), join(String(dir), "bench.ts")],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    timeout: 15_000,
    killSignal: "SIGKILL",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout, stderr: /error|panic|assert|crash|abort/i.test(stderr) ? stderr : "", exitCode }).toEqual({
    stdout: "ok\n",
    stderr: "",
    exitCode: 0,
  });
}, 30_000);

test("tsconfig paths: many entries resolve correctly (exact, wildcard, longest-prefix)", async () => {
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
