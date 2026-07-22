import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

async function run(cmd: string[], cwd: string, extraEnv: Record<string, string> = {}) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...cmd],
    env: { ...bunEnv, ...extraEnv },
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, combined: stdout + stderr };
}

describe("unknown CLI flags", () => {
  describe("package manager: reject with did-you-mean", () => {
    test.concurrent("install --frozen-lockfil suggests --frozen-lockfile and exits 1", async () => {
      using dir = tempDir("unknown-flag-install", {
        "package.json": JSON.stringify({ name: "c", version: "1.0.0" }),
      });
      const { combined, exitCode } = await run(["install", "--frozen-lockfil"], String(dir));
      expect(combined).toContain("unknown option '--frozen-lockfil'");
      expect(combined).toContain("Did you mean '--frozen-lockfile'");
      expect(exitCode).toBe(1);
    });

    test.concurrent("install --prodution suggests --production and exits 1", async () => {
      using dir = tempDir("unknown-flag-prod", {
        "package.json": JSON.stringify({ name: "c", version: "1.0.0" }),
      });
      const { combined, exitCode } = await run(["install", "--prodution"], String(dir));
      expect(combined).toContain("unknown option '--prodution'");
      expect(combined).toContain("Did you mean '--production'");
      expect(exitCode).toBe(1);
    });

    test.concurrent("install --ignore-script suggests --ignore-scripts and exits 1", async () => {
      using dir = tempDir("unknown-flag-scripts", {
        "package.json": JSON.stringify({ name: "c", version: "1.0.0" }),
      });
      const { combined, exitCode } = await run(["install", "--ignore-script"], String(dir));
      expect(combined).toContain("unknown option '--ignore-script'");
      expect(combined).toContain("Did you mean '--ignore-scripts'");
      expect(exitCode).toBe(1);
    });

    test.concurrent("install with an unrelated flag has no suggestion but still exits 1", async () => {
      using dir = tempDir("unknown-flag-none", {
        "package.json": JSON.stringify({ name: "c", version: "1.0.0" }),
      });
      const { combined, exitCode } = await run(["install", "--totally-fake-flag"], String(dir));
      expect(combined).toContain("unknown option '--totally-fake-flag'");
      expect(combined).not.toContain("Did you mean");
      expect(combined).toContain("bun install --help");
      expect(exitCode).toBe(1);
    });

    test.concurrent("install --regitry=url strips =value in the message", async () => {
      using dir = tempDir("unknown-flag-eq", {
        "package.json": JSON.stringify({ name: "c", version: "1.0.0" }),
      });
      const { combined, exitCode } = await run(["install", "--regitry=https://example.com"], String(dir));
      expect(combined).toContain("unknown option '--regitry'");
      expect(combined).not.toContain("example.com");
      expect(combined).toContain("Did you mean '--registry'");
      expect(exitCode).toBe(1);
    });

    // Point the registry at an unreachable port so an un-fixed build cannot
    // fall through to a real network request.
    const offlineEnv = { NPM_CONFIG_REGISTRY: "http://127.0.0.1:0/" };

    for (const sub of ["add", "remove", "update", "outdated", "audit", "link", "why"] as const) {
      test.concurrent(`${sub} rejects unknown flags`, async () => {
        using dir = tempDir(`unknown-flag-${sub}`, {
          "package.json": JSON.stringify({ name: "c", version: "1.0.0" }),
        });
        const { combined, exitCode } = await run([sub, "--totally-fake-flag"], String(dir), offlineEnv);
        expect(combined).toContain("unknown option '--totally-fake-flag'");
        expect(combined).toContain(`bun ${sub} --help`);
        expect(exitCode).toBe(1);
      });
    }

    test.concurrent("pm ls rejects unknown flags", async () => {
      using dir = tempDir("unknown-flag-pm", {
        "package.json": JSON.stringify({ name: "c", version: "1.0.0" }),
      });
      const { combined, exitCode } = await run(["pm", "ls", "--totally-fake-flag"], String(dir));
      expect(combined).toContain("unknown option '--totally-fake-flag'");
      expect(exitCode).toBe(1);
    });
  });

  describe("build / test: reject", () => {
    test.concurrent("build --minif suggests --minify and exits 1", async () => {
      using dir = tempDir("unknown-flag-build", {
        "in.ts": "export const x = 1;\n",
      });
      const { combined, exitCode } = await run(["build", "in.ts", "--minif"], String(dir));
      expect(combined).toContain("unknown option '--minif'");
      expect(combined).toContain("Did you mean '--minify'");
      expect(combined).toContain("bun build --help");
      expect(exitCode).toBe(1);
    });

    test.concurrent("test --coverag suggests --coverage and exits 1", async () => {
      using dir = tempDir("unknown-flag-test", {
        "a.test.ts": "import {test,expect} from 'bun:test'; test('x',()=>expect(1).toBe(1));\n",
      });
      const { combined, exitCode } = await run(["test", "--coverag", "a.test.ts"], String(dir));
      expect(combined).toContain("unknown option '--coverag'");
      expect(combined).toContain("Did you mean '--coverage'");
      expect(combined).toContain("bun test --help");
      expect(exitCode).toBe(1);
    });
  });

  describe("upgrade: reject", () => {
    // `bun upgrade` has no --dry-run; before this change the flag was
    // silently swallowed and a real self-upgrade began. It must now refuse
    // before any network I/O. HTTPS_PROXY points at an unreachable address so
    // an un-fixed build cannot complete a download and swap out the binary
    // under test.
    test.concurrent("upgrade --dry-run exits 1", async () => {
      using dir = tempDir("unknown-flag-upgrade", {});
      const { combined, exitCode } = await run(["upgrade", "--dry-run"], String(dir), {
        HTTPS_PROXY: "http://127.0.0.1:0/",
        HTTP_PROXY: "http://127.0.0.1:0/",
      });
      expect(combined).toContain("unknown option '--dry-run'");
      expect(combined).toContain("bun upgrade --help");
      expect(exitCode).toBe(1);
    });
  });

  describe("run / auto: warn but proceed", () => {
    test.concurrent("bun --totally-fake-flag <file> warns and still runs", async () => {
      using dir = tempDir("unknown-flag-auto", {
        "script.js": "console.log('RAN')\n",
      });
      const { stdout, stderr, exitCode } = await run(["--totally-fake-flag", "script.js"], String(dir));
      expect(stderr).toContain("unknown option '--totally-fake-flag'");
      expect(stdout).toContain("RAN");
      expect(exitCode).toBe(0);
    });

    test.concurrent("bun run --silnt <script> warns with suggestion and still runs", async () => {
      using dir = tempDir("unknown-flag-run", {
        "package.json": JSON.stringify({ name: "c", version: "1.0.0", scripts: { go: "echo RAN" } }),
      });
      const { combined, exitCode } = await run(["run", "--silnt", "go"], String(dir));
      expect(combined).toContain("unknown option '--silnt'");
      expect(combined).toContain("Did you mean '--silent'");
      expect(combined).toContain("RAN");
      expect(exitCode).toBe(0);
    });

    // Flags after the script name are the script's argv, not Bun's.
    test.concurrent("bun <file> --user-flag is passed through without warning", async () => {
      using dir = tempDir("unknown-flag-passthrough", {
        "script.js": "console.log(JSON.stringify(process.argv.slice(2)))\n",
      });
      const { stdout, stderr, exitCode } = await run(["script.js", "--user-flag"], String(dir));
      expect(stderr).not.toContain("unknown option");
      expect(JSON.parse(stdout.trim())).toEqual(["--user-flag"]);
      expect(exitCode).toBe(0);
    });

    test.concurrent("bun run <file> --user-flag is passed through without warning", async () => {
      using dir = tempDir("unknown-flag-passthrough-run", {
        "script.js": "console.log(JSON.stringify(process.argv.slice(2)))\n",
      });
      const { stdout, stderr, exitCode } = await run(["run", "script.js", "--user-flag"], String(dir));
      expect(stderr).not.toContain("unknown option");
      expect(JSON.parse(stdout.trim())).toEqual(["--user-flag"]);
      expect(exitCode).toBe(0);
    });
  });

  test.concurrent("valid flags are unaffected", async () => {
    using dir = tempDir("unknown-flag-valid", {
      "package.json": JSON.stringify({ name: "c", version: "1.0.0" }),
    });
    const { combined, exitCode } = await run(["install", "--frozen-lockfile", "--production"], String(dir));
    expect(combined).not.toContain("unknown option");
    expect(exitCode).toBe(0);
  });
});
