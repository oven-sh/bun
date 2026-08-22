import { write } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { lstatSync, lutimesSync, mkdirSync, readlinkSync, symlinkSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, VerdaccioRegistry } from "harness";
import { join } from "path";

// `what-bin@1.0.0` declares `bin: { "what-bin": "what-bin.js" }`. Both linkers
// link it from the root `node_modules/.bin`, so the link target is the same.
const EXPECTED_TARGET = "../what-bin/what-bin.js";

// Any fixed time in the past: a link that `bun install` unlinks and recreates
// comes back with the current time as its mtime, whatever inode number the
// filesystem hands out for it.
const STAMP = new Date("2000-01-01T00:00:00Z");

const LINKERS = ["hoisted", "isolated"] as const;

const STALE_BIN_ENTRIES = {
  "a symlink to another file": (entry: string) => symlinkSync(join("..", "..", "package.json"), entry),
  "a regular file": (entry: string) => writeFileSync(entry, "#!/bin/sh\n"),
};

// `.bin/<name>` is a symlink on POSIX. Windows writes `<name>.exe` and
// `<name>.bunx` shims instead.
describe.skipIf(isWindows)("node_modules/.bin links", () => {
  const registry = new VerdaccioRegistry();

  beforeAll(async () => {
    await registry.start();
  });

  afterAll(() => {
    registry.stop();
  });

  async function createProject(linker: (typeof LINKERS)[number]) {
    const { packageDir, packageJson } = await registry.createTestDir({ bunfigOpts: { linker } });
    await write(packageJson, JSON.stringify({ name: "bin-link-test", dependencies: { "what-bin": "1.0.0" } }));
    return { packageDir, binLink: join(packageDir, "node_modules", ".bin", "what-bin") };
  }

  async function install(packageDir: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      env: bunEnv,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  function linkIdentity(link: string) {
    const { ino, mtimeMs } = lstatSync(link);
    return { ino, mtimeMs, target: readlinkSync(link) };
  }

  for (const linker of LINKERS) {
    test.concurrent(`${linker}: a repeat install keeps the existing link instead of recreating it`, async () => {
      const { packageDir, binLink } = await createProject(linker);

      const first = await install(packageDir);
      expect(first.stderr).not.toContain("error:");
      expect(first.stdout).toContain("1 package installed");
      expect(first.exitCode).toBe(0);

      lutimesSync(binLink, STAMP, STAMP);
      const before = linkIdentity(binLink);
      expect(before).toEqual({ ino: expect.any(Number), mtimeMs: STAMP.getTime(), target: EXPECTED_TARGET });

      const second = await install(packageDir);
      expect(second.stderr).not.toContain("error:");
      expect(second.stdout).toContain("(no changes)");
      expect(second.exitCode).toBe(0);

      expect(linkIdentity(binLink)).toEqual(before);
    });
  }

  // Only a link that already points at the right target is kept. `create_symlink`
  // is shared by both linkers, so one linker is enough for the replacement cases.
  for (const [kind, createStaleEntry] of Object.entries(STALE_BIN_ENTRIES)) {
    test.concurrent(`hoisted: replaces ${kind} left at the link's path`, async () => {
      const { packageDir, binLink } = await createProject("hoisted");
      mkdirSync(join(packageDir, "node_modules", ".bin"), { recursive: true });
      createStaleEntry(binLink);

      const { stdout, stderr, exitCode } = await install(packageDir);
      expect(stderr).not.toContain("error:");
      expect(stdout).toContain("1 package installed");
      expect(exitCode).toBe(0);

      expect(lstatSync(binLink).isSymbolicLink()).toBe(true);
      expect(readlinkSync(binLink)).toBe(EXPECTED_TARGET);
    });
  }
});
