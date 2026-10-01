import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, tempDir } from "harness";
import { existsSync } from "node:fs";
import { join } from "node:path";

async function run(cmd: string[], cwd: string) {
  await using proc = Bun.spawn({ cmd, cwd, env: bunEnv, stdio: ["ignore", "inherit", "inherit"] });
  await proc.exited;
  return { exitCode: proc.exitCode, signalCode: proc.signalCode };
}

// Guards the napi ThreadSafeFunction finalizer (#24771). Bun ran it without the
// function's context as the hint, and rspack's native binding then crashed with
// "Segmentation fault at address 0x0" in the middle of a build.
//
// `app/` is what `bun create rsbuild@1 app --template solid-ts` generates, with
// every version pinned by `app/bun.lock`. Stay on rsbuild 1.x: in 2.x,
// @rspack/binding-win32-arm64-msvc bundles mimalloc v3, and two static mimalloc
// instances in one process segfault in ntdll during ExitProcess on Windows arm64.
test(
  "rsbuild build exits cleanly",
  async () => {
    using dir = tempDir("rspack-integration", join(import.meta.dir, "app"));
    const cwd = String(dir);

    expect(await run([bunExe(), "install", "--frozen-lockfile"], cwd)).toEqual({ exitCode: 0, signalCode: null });

    expect(await run([bunExe(), "--bun", "run", "build"], cwd)).toEqual({ exitCode: 0, signalCode: null });
    expect(existsSync(join(cwd, "dist", "index.html"))).toBe(true);
  },
  // The install downloads 89 tarballs (49 MB) from the npm registry. This is the
  // bound scripts/runner.node.ts gives each test of an integration file.
  150_000 * (isASAN ? 3 : 1),
);
