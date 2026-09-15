import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, tempDir, VerdaccioRegistry } from "harness";
import { join } from "path";

// Issue #26657: pressing 'A' in `bun update --interactive` showed
// "Selected X packages to update" and then "No packages selected for update",
// because packages whose current version already equals the highest version
// allowed by their range were silently dropped instead of being bumped to latest.
//
// The local registry's `no-deps` has 1.0.0, 1.0.1, 1.1.0 and 2.0.0 (latest).
let registry: VerdaccioRegistry;

beforeAll(async () => {
  registry = new VerdaccioRegistry();
  await registry.start();
});

afterAll(() => {
  registry.stop();
});

function project(name: string, range: string) {
  return tempDir(name, {
    "bunfig.toml": `[install]\ncache = false\nregistry = "${registry.registryUrl()}"\n`,
    "package.json": JSON.stringify({
      name: "test-project",
      version: "1.0.0",
      dependencies: {
        "no-deps": range,
      },
    }),
  });
}

async function install(dir: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: dir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toMatchObject({ exitCode: 0 });
}

// Press 'A' to select every package, then Enter to confirm.
async function updateInteractiveSelectAll(dir: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "update", "--interactive"],
    cwd: dir,
    env: bunEnv,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  proc.stdin.write("A\r");
  proc.stdin.end();
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

function installedVersion(dir: string): string {
  return JSON.parse(readFileSync(join(dir, "node_modules", "no-deps", "package.json"), "utf8")).version;
}

function declaredRange(dir: string): string {
  return JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).dependencies["no-deps"];
}

describe.concurrent("bun update -i select all with 'A' key", () => {
  test("should update packages when 'A' is pressed to select all", async () => {
    // An exact pin: the current version is the only version the range allows,
    // so the only update on offer is the jump to latest.
    using dir = project("update-interactive-select-all", "1.0.0");
    await install(String(dir));
    expect(installedVersion(String(dir))).toBe("1.0.0");

    const { stdout, stderr, exitCode } = await updateInteractiveSelectAll(String(dir));

    expect(stdout).toContain("Selected 1 package to update");
    expect(stdout).not.toContain("No packages selected for update");
    expect(stderr).not.toContain("No packages selected for update");
    expect(exitCode).toBe(0);

    expect(declaredRange(String(dir))).toBe("2.0.0");
    expect(installedVersion(String(dir))).toBe("2.0.0");
  });

  test("should handle packages where current equals update version but not latest", async () => {
    // ^1.0.0 resolves to 1.1.0, the highest version inside the range, so the
    // "update" column already equals the current version while latest is 2.0.0.
    using dir = project("update-interactive-select-all-constrained", "^1.0.0");
    await install(String(dir));
    expect(installedVersion(String(dir))).toBe("1.1.0");

    const { stdout, stderr, exitCode } = await updateInteractiveSelectAll(String(dir));

    expect(stdout).toContain("Selected 1 package to update");
    expect(stdout).not.toContain("No packages selected for update");
    expect(stderr).not.toContain("No packages selected for update");
    expect(exitCode).toBe(0);

    expect(declaredRange(String(dir))).toBe("^2.0.0");
    expect(installedVersion(String(dir))).toBe("2.0.0");
  });
});
