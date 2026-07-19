// Tests for scripts/lint-tests.ts (flake anti-pattern linter for test/).
//
// The script runs under the system bun and has no native dependencies, so
// this test exercises it directly with bunExe() rather than relying on any
// Bun build artifacts.

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, tempDir } from "harness";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..", "..");
const script = path.join(root, "scripts", "lint-tests.ts");

interface Finding {
  file: string;
  line: number;
  col: number;
  rule: string;
  error: boolean;
}

async function lint(files: Record<string, string>, extraArgs: string[] = []) {
  using dir = tempDir("lint-tests", files);
  const targets = Object.keys(files).map(f => path.join(String(dir), f));
  await using proc = Bun.spawn({
    cmd: [bunExe(), script, "--json", ...extraArgs, ...targets],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  let findings: Finding[] = [];
  try {
    findings = JSON.parse(stdout).findings;
  } catch {
    throw new Error(`lint-tests did not emit JSON:\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  }
  return { findings, exitCode, stderr };
}

function byRule(findings: Finding[]) {
  const m: Record<string, number[]> = {};
  for (const f of findings) (m[f.rule] ??= []).push(f.line);
  return m;
}

describe("scripts/lint-tests.ts", () => {
  test("flags each anti-pattern on the right line", async () => {
    const { findings, exitCode } = await lint({
      "bad.test.ts": [
        /* 1 */ `import { test } from "bun:test";`,
        /* 2 */ `test("x", async () => {`,
        /* 3 */ `  Bun.serve({ port: 4567, fetch: () => new Response("") });`,
        /* 4 */ `  await Bun.sleep(5000);`,
        /* 5 */ `  await new Promise(resolve => setTimeout(resolve, 2500));`,
        /* 6 */ `  setDefaultTimeout(1000 * 60 * 5);`,
        /* 7 */ `  await fetch("https://example.org/x");`,
        /* 8 */ `  const d = tmpdirSync();`,
        /* 9 */ `});`,
      ].join("\n"),
    });
    expect(byRule(findings)).toEqual({
      "hardcoded-port": [3],
      "long-sleep": [4, 5],
      "long-default-timeout": [6],
      "external-fetch": [7],
      "tmpdirSync": [8],
    });
    // default mode: warnings only
    expect(exitCode).toBe(0);
  });

  test("does not flag the safe forms", async () => {
    const { findings } = await lint({
      "ok.test.ts": [
        `Bun.serve({ port: 0, fetch: () => new Response("") });`,
        `await Bun.sleep(100);`,
        `setDefaultTimeout(30_000);`,
        `await fetch("http://localhost:1234/x");`,
        `await fetch("http://127.0.0.1/x");`,
        `await fetch(\`http://\${host}:\${port}/x\`);`,
        `await Promise.race([p, Bun.sleep(5000)]);`, // timeout guard, not wait-and-hope
        `using dir = tempDir("x", {});`,
      ].join("\n"),
    });
    expect(findings).toEqual([]);
  });

  test("ignores matches inside strings, comments and multiline template literals", async () => {
    const { findings } = await lint({
      "strings.test.ts": [
        `const cmd = [bunExe(), "-e", "await Bun.sleep(100000)"];`,
        `// port: 4567`,
        `/* await fetch("https://example.org") */`,
        "const yaml = `",
        "  port: 5432",
        "`;",
        `expect(obj).toEqual({ host: "x", port: 8080 });`, // assertion, not a bind
      ].join("\n"),
    });
    expect(findings).toEqual([]);
  });

  test("allow-comment on same line or line above suppresses", async () => {
    const { findings } = await lint({
      "allowed.test.ts": [
        `// lint-tests-allow: testing a privileged-port error path`,
        `Bun.serve({ port: 1003, fetch: () => new Response("") });`,
        `await Bun.sleep(5000); // lint-tests-allow: testing`,
      ].join("\n"),
    });
    expect(findings).toEqual([]);
  });

  test("--all-errors turns warnings into errors and exits 1", async () => {
    const { findings, exitCode } = await lint({ "bad.test.ts": `Bun.serve({ port: 4567 });` }, ["--all-errors"]);
    expect(findings.map(f => ({ rule: f.rule, error: f.error }))).toEqual([{ rule: "hardcoded-port", error: true }]);
    expect(exitCode).toBe(1);
  });

  // The full-tree scan is a CI smoke check run with a release bun; under the
  // debug/ASAN binary the per-char classifier is two orders of magnitude
  // slower, so skip there.
  test.skipIf(isDebug)(
    "full repo scan stays under 2s and reports warnings only",
    async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), script, "--json"],
        env: bunEnv,
        cwd: root,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const out = JSON.parse(stdout);
      // None of the existing baseline should be errors in default mode.
      expect(out.findings.some((f: Finding) => f.error)).toBe(false);
      expect(out.scanned).toBeGreaterThan(1000);
      expect(out.elapsed).toBeLessThan(5);
      expect(exitCode).toBe(0);
    },
    15_000,
  );
});
