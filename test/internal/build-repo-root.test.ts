/**
 * The build scripts find the checkout from their own location, not from process.cwd(). ninja runs the `regen`
 * edge of build.ninja from the build directory, and an explicit `--build-dir` can put that directory anywhere.
 *
 * Each case runs from a build directory outside the checkout whose parent holds a package.json named "bun", the
 * way a build directory inside another checkout or worktree looks: a walk up from cwd would stop at that one.
 */
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..", "..");
const buildScript = join(repoRoot, "scripts", "build.ts");
const configureTs = join(repoRoot, "scripts", "build", "configure.ts");
const version = (JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { version: string }).version;
const esbuild = join(repoRoot, "node_modules", ".bin", process.platform === "win32" ? "esbuild.exe" : "esbuild");
const decoy = { "package.json": JSON.stringify({ name: "bun", version: "0.0.0" }) };

async function run(cwd: string, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    // GIT_SHA: configure takes the revision from it and runs no git, which could write to stderr.
    env: { ...bunEnv, BUN_BUILD_TRACE: undefined, GIT_SHA: "0".repeat(40) },
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test.concurrent("the config resolves the checkout from an external build directory", async () => {
  using dir = tempDir("build-repo-root", { out: {}, ...decoy });
  const buildDir = join(String(dir), "out");
  // What the regen replay resolves for `--config-file=configure.json` (codegenConfigOf in configure.ts).
  const script = `
    import { codegenConfigOf } from ${JSON.stringify(configureTs)};
    const cfg = codegenConfigOf({ profile: "debug", overrides: { mode: "codegen", buildDir: ${JSON.stringify(buildDir)} } });
    console.log(JSON.stringify({ cwd: cfg.cwd, buildDir: cfg.buildDir, esbuild: cfg.esbuild, version: cfg.version }));
  `;
  const { stdout, stderr, exitCode } = await run(buildDir, "-e", script);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({ cwd: repoRoot, buildDir, esbuild, version });
  expect(exitCode).toBe(0);
});

// The replay globs every source of the checkout: 0.4s under a release build, about 25s under debug ASAN.
// On Windows, build.ts re-executes itself in the Visual Studio shell first, which prints to stdout.
test.concurrent.skipIf(isDebug || isASAN || isWindows)(
  "the regen replay writes build.ninja for an external build directory",
  async () => {
    using dir = tempDir("build-repo-root", { out: {}, ...decoy });
    const buildDir = join(String(dir), "out");
    // What emitGeneratorRule() (configure.ts) persists for `--mode=codegen --build-dir=<buildDir>`, replayed the way
    // its `regen` rule runs: `<bun> <checkout>/scripts/build.ts --config-file=configure.json`, with cwd = buildDir.
    const input = { profile: "debug", overrides: { mode: "codegen", buildDir } };
    await Bun.write(join(buildDir, "configure.json"), JSON.stringify(input, null, 2) + "\n");

    const { stdout, stderr, exitCode } = await run(buildDir, buildScript, "--config-file=configure.json");
    expect(stderr).toBe("");
    expect(stdout).toBe("");
    expect(exitCode).toBe(0);

    // The `regen` rule names the checkout's build.ts (from cfg.cwd) and the codegen rules its esbuild.
    const manifest = readFileSync(join(buildDir, "build.ninja"), "utf8");
    expect(manifest).toContain(buildScript);
    expect(manifest).toContain(esbuild);
  },
);
